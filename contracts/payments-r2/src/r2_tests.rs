//! R-2 candidate: adversarial unit tests for settle-first / debit-first delivery.
//! Every test states the double-payment or false-status property it guards.
use super::*;
use near_sdk::test_utils::{VMContextBuilder, get_created_receipts};
use near_sdk::{PromiseResult, testing_env};
use std::collections::HashMap;
use std::panic::{AssertUnwindSafe, catch_unwind};

const NOW: u64 = 1_793_520_000_000_000_000;
const SECOND: u64 = 1_000_000_000;
const DURATION: u64 = 60 * SECOND;
const CONTRACT: &str = "payments.fixture.testnet";

fn ctx_gas(
    caller: &str,
    deposit: u128,
    time: u64,
    results: Vec<PromiseResult>,
    gas: Gas,
    balance: u128,
) {
    let mut b = VMContextBuilder::new();
    b.storage_usage(env::storage_usage());
    b.current_account_id(CONTRACT.parse().unwrap())
        .predecessor_account_id(caller.parse().unwrap())
        .signer_account_id(caller.parse().unwrap())
        .block_timestamp(time)
        .block_height(time / SECOND)
        .account_balance(NearToken::from_yoctonear(balance))
        .attached_deposit(NearToken::from_yoctonear(deposit))
        .prepaid_gas(gas);
    testing_env!(
        b.build(),
        near_sdk::test_vm_config(),
        near_sdk::RuntimeFeesConfig::test(),
        Default::default(),
        results
    );
}
fn ctx(caller: &str, deposit: u128, time: u64, results: Vec<PromiseResult>) {
    ctx_gas(
        caller,
        deposit,
        time,
        results,
        Gas::from_tgas(300),
        1000 * 10u128.pow(24),
    );
}
fn rejects_with(code: &str, f: impl FnOnce()) {
    let err = catch_unwind(AssertUnwindSafe(f)).expect_err("call must fail");
    let msg = err
        .downcast_ref::<String>()
        .cloned()
        .or_else(|| err.downcast_ref::<&str>().map(|s| s.to_string()))
        .unwrap_or_default();
    assert!(msg.contains(code), "expected {code}, got {msg}");
}
fn terms(n: u64, mode: &str) -> IntentTerms {
    let mut t: IntentTerms = near_sdk::serde_json::from_str(include_str!(
        "../../../packages/shared/test-vectors/intent-a.json"
    ))
    .unwrap();
    t.creation_nonce = format!("{n:064x}");
    t.merchant_account_id = None;
    t.session_binding = None;
    t.mode = mode.into();
    t.cancel_duration_ns = (mode == "protected").then(|| DURATION.to_string());
    t.id = t.request_id();
    t
}
fn amount(t: &IntentTerms) -> u128 {
    decimal128(&t.amount_base_units)
}
fn contract() -> Payments {
    ctx(CONTRACT, 0, NOW, vec![]);
    Payments::new(vec![])
}
fn create(c: &mut Payments, t: &IntentTerms) {
    ctx("alice.testnet", 0, NOW, vec![]);
    let q = c.quote_create_request(t.clone());
    ctx(
        "alice.testnet",
        decimal128(q["depositYocto"].as_str().unwrap()),
        NOW,
        vec![],
    );
    c.create_request(t.clone(), "1".into());
}
fn pay(c: &mut Payments, t: &IntentTerms) {
    ctx("bob.testnet", amount(t), NOW + 1, vec![]);
    drop(c.pay_instant_native(t.id.clone(), t.terms_hash()));
}
fn lock(c: &mut Payments, t: &IntentTerms) {
    ctx("bob.testnet", amount(t), NOW + 1, vec![]);
    c.fund_protected_native(
        t.id.clone(),
        t.terms_hash(),
        DURATION.to_string(),
        CONSENT_VERSION.into(),
    );
}
fn cb(c: &mut Payments, t: &IntentTerms, nonce: &str, result: PromiseResult) -> bool {
    ctx(CONTRACT, 0, NOW + 2 * DURATION, vec![result]);
    c.on_delivery_complete(t.id.clone(), nonce.into())
}
fn resend(c: &mut Payments, t: &IntentTerms, who: &str, nonce: &str) {
    ctx(who, 1, NOW + 2 * DURATION, vec![]);
    drop(c.retry_native_transfer(t.id.clone(), nonce.into()));
}
fn rec(t: &IntentTerms) -> Record {
    load(&t.id)
}
/// Native transfers scheduled since the last context reset: (receiver, amount).
fn transfers() -> Vec<(String, u128)> {
    get_created_receipts()
        .iter()
        .flat_map(|r| {
            r.actions.iter().filter_map(move |a| match a {
                near_sdk::mock::MockAction::Transfer { deposit, .. } => {
                    Some((r.receiver_id.to_string(), deposit.as_yoctonear()))
                }
                _ => None,
            })
        })
        .collect()
}

/// R-2 core: transfer applied, callback never runs successfully. The request is
/// already settled; the delivery is unconfirmed and can NEVER be resent.
#[test]
fn callback_that_never_completes_leaves_a_settled_request_and_no_resend() {
    let mut c = contract();
    let t = terms(1, "instant");
    create(&mut c, &t);
    pay(&mut c, &t);
    assert_eq!(transfers(), vec![("alice.testnet".into(), amount(&t))]);
    // No callback at all (it panicked or ran out of gas on chain).
    assert_eq!(rec(&t).status, Status::Paid);
    assert_eq!(rec(&t).view()["status"], "FINAL_PAID");
    assert_eq!(rec(&t).delivery, Delivery::Sent);
    assert_eq!((c.owed, c.sending, c.delivered_paid), (0, amount(&t), 0));
    for who in ["alice.testnet", "bob.testnet", "mallory.testnet"] {
        ctx(who, 1, NOW + 2 * DURATION, vec![]);
        rejects_with("NO_RETURNED_DELIVERY", || {
            drop(c.retry_native_transfer(t.id.clone(), "1".into()));
        });
        assert!(transfers().is_empty(), "nothing may be sent again");
    }
    ctx("x.testnet", 0, NOW, vec![]);
    let d = c.get_delivery(t.id.clone()).unwrap();
    assert_eq!(d["delivery"], "SENT_UNCONFIRMED");
    assert_eq!(d["resendAllowed"], false);
    assert_eq!(
        c.get_receipt(t.id.clone()).unwrap()["payoutConfirmed"],
        false
    );
}

/// Only an explicit Failed result re-credits. A success with a return value
/// (or one too long to read) is still a success: never owed again.
#[test]
fn only_an_explicit_failed_result_returns_the_amount() {
    for (n, result, delivered) in [
        (10, PromiseResult::Successful(vec![]), true),
        (11, PromiseResult::Successful(vec![1, 2, 3]), true),
        (12, PromiseResult::Successful(vec![7; 1000]), true),
        (13, PromiseResult::Failed, false),
    ] {
        let mut c = contract();
        let t = terms(n, "instant");
        create(&mut c, &t);
        pay(&mut c, &t);
        assert_eq!(cb(&mut c, &t, "1", result), delivered);
        if delivered {
            assert_eq!(rec(&t).delivery, Delivery::Delivered);
            assert_eq!((c.owed, c.sending, c.delivered_paid), (0, 0, amount(&t)));
        } else {
            assert_eq!(rec(&t).delivery, Delivery::Returned);
            assert_eq!((c.owed, c.sending, c.delivered_paid), (amount(&t), 0, 0));
        }
        assert_eq!(rec(&t).status, Status::Paid);
        c.conservation();
    }
}

/// Duplicate, stale, unknown-request and malformed-nonce callbacks change nothing
/// and never panic (a panic would only mean "unconfirmed", but they must not
/// re-credit or confirm the wrong attempt either).
#[test]
fn stale_duplicate_and_mismatched_callbacks_are_inert() {
    let mut c = contract();
    let t = terms(20, "instant");
    let other = terms(21, "instant");
    create(&mut c, &t);
    create(&mut c, &other);
    pay(&mut c, &t);
    let before = rec(&t).view();
    for nonce in ["0", "2", "01", "-1", "1x", "18446744073709551616"] {
        assert!(
            !cb(&mut c, &t, nonce, PromiseResult::Failed),
            "nonce {nonce}"
        );
        assert_eq!(rec(&t).view(), before);
    }
    ctx(CONTRACT, 0, NOW + 2, vec![PromiseResult::Failed]);
    assert!(!c.on_delivery_complete("f".repeat(64), "1".into()));
    // A callback for a request that was never sent (still OPEN) is inert.
    assert!(!cb(&mut c, &other, "1", PromiseResult::Failed));
    assert_eq!(rec(&other).status, Status::Open);
    assert_eq!(c.owed, 0);
    // The real one, then its duplicate.
    assert!(!cb(&mut c, &t, "1", PromiseResult::Failed));
    assert!(!cb(&mut c, &t, "1", PromiseResult::Failed));
    assert_eq!(c.owed, amount(&t), "re-credited exactly once");
    c.conservation();
}

/// Forged callbacks: other callers, no promise result, two results.
#[test]
fn forged_callbacks_are_refused_and_change_nothing() {
    let mut c = contract();
    let t = terms(30, "instant");
    create(&mut c, &t);
    pay(&mut c, &t);
    let before = rec(&t).view();
    for caller in ["alice.testnet", "bob.testnet", "mallory.testnet"] {
        ctx(caller, 0, NOW + 2, vec![PromiseResult::Failed]);
        rejects_with("PRIVATE_CALLBACK", || {
            c.on_delivery_complete(t.id.clone(), "1".into());
        });
    }
    for results in [vec![], vec![PromiseResult::Failed, PromiseResult::Failed]] {
        ctx(CONTRACT, 0, NOW + 2, results);
        rejects_with("UNKNOWN_PROMISE_RESULT", || {
            c.on_delivery_complete(t.id.clone(), "1".into());
        });
    }
    assert_eq!(rec(&t).view(), before);
    assert_eq!((c.owed, c.sending), (0, amount(&t)));
}

/// Resend after an explicit failure: beneficiary only, same destination, latest
/// nonce only, exactly once per failure; never across requests.
#[test]
fn resend_is_beneficiary_only_once_per_failure_and_never_cross_request() {
    let mut c = contract();
    let a = terms(40, "instant");
    let b = terms(41, "instant");
    create(&mut c, &a);
    create(&mut c, &b);
    pay(&mut c, &a);
    pay(&mut c, &b);
    assert!(!cb(&mut c, &a, "1", PromiseResult::Failed));
    // b's delivery is unconfirmed: a's failure can never be used to resend b.
    for who in ["bob.testnet", "mallory.testnet"] {
        ctx(who, 1, NOW + 2 * DURATION, vec![]);
        rejects_with("RECIPIENT_ONLY", || {
            drop(c.retry_native_transfer(a.id.clone(), "1".into()));
        });
    }
    // Not even the contract's own key may resend on a beneficiary's behalf.
    ctx(CONTRACT, 1, NOW + 2 * DURATION, vec![]);
    rejects_with("DIRECT_WALLET_ONLY", || {
        drop(c.retry_native_transfer(a.id.clone(), "1".into()));
    });
    ctx("alice.testnet", 1, NOW + 2 * DURATION, vec![]);
    rejects_with("NO_RETURNED_DELIVERY", || {
        drop(c.retry_native_transfer(b.id.clone(), "1".into()));
    });
    rejects_with("OPERATION_NONCE_MISMATCH", || {
        drop(c.retry_native_transfer(a.id.clone(), "2".into()));
    });
    ctx("alice.testnet", 0, NOW + 2 * DURATION, vec![]);
    rejects_with("ONE_YOCTO_REQUIRED", || {
        drop(c.retry_native_transfer(a.id.clone(), "1".into()));
    });
    resend(&mut c, &a, "alice.testnet", "1");
    assert_eq!(transfers(), vec![("alice.testnet".into(), amount(&a))]);
    assert_eq!(rec(&a).nonce, 2);
    // Replaying the same resend is refused: the delivery is in transit again.
    ctx("alice.testnet", 1, NOW + 2 * DURATION, vec![]);
    rejects_with("NO_RETURNED_DELIVERY", || {
        drop(c.retry_native_transfer(a.id.clone(), "1".into()));
    });
    assert!(transfers().is_empty());
    assert!(cb(&mut c, &a, "2", PromiseResult::Successful(vec![])));
    assert_eq!(c.delivered_paid, amount(&a));
    assert_eq!(c.sending, amount(&b));
    c.conservation();
}

/// Settlement is irreversible and branch-exclusive: after a refund settles, no
/// release (and vice versa), whatever the delivery state.
#[test]
fn cancel_and_release_cannot_both_settle() {
    let mut c = contract();
    let t = terms(50, "protected");
    create(&mut c, &t);
    lock(&mut c, &t);
    let cutoff = rec(&t).cancel_until;
    ctx("bob.testnet", 1, cutoff - 1, vec![]);
    drop(c.cancel_protected(t.id.clone(), t.terms_hash()));
    assert_eq!(rec(&t).status, Status::Refunded);
    for result in [
        None,
        Some(PromiseResult::Failed),
        Some(PromiseResult::Successful(vec![])),
    ] {
        if let Some(r) = result {
            cb(&mut c, &t, &rec(&t).nonce.to_string(), r);
        }
        ctx("carol.testnet", 1, cutoff + 1, vec![]);
        rejects_with("NOT_LOCKED", || {
            drop(c.release_protected(t.id.clone()));
        });
        ctx("bob.testnet", 1, cutoff - 1, vec![]);
        rejects_with("NOT_LOCKED", || {
            drop(c.cancel_protected(t.id.clone(), t.terms_hash()));
        });
    }
    assert_eq!(c.settled_paid, 0);
    assert_eq!(c.settled_refunded, amount(&t));
    c.conservation();
}

/// Too little unspent gas to schedule the transfer AND its callback: refused.
/// Every entry point checks this before any state change (settle/deliver), and
/// the entry gas floors (PAY_GAS, SETTLE_GAS, FT_ON_TRANSFER_GAS) already exceed it.
#[test]
fn delivery_requires_gas_for_transfer_and_callback() {
    let native = rec_for(terms(60, "instant"));
    let mut token_terms = terms(61, "instant");
    token_terms.asset_id = "nep141:tusd.fixture.testnet".into();
    token_terms.id = token_terms.request_id();
    let token = rec_for(token_terms);
    let reserve_native = CALLBACK_GAS.as_tgas() + DELIVERY_GAS_MARGIN.as_tgas();
    let reserve_token = reserve_native + FT_TRANSFER_GAS.as_tgas();
    for (r, reserve) in [(&native, reserve_native), (&token, reserve_token)] {
        ctx_gas(
            "bob.testnet",
            0,
            NOW,
            vec![],
            Gas::from_tgas(reserve - 1),
            10u128.pow(27),
        );
        rejects_with("INSUFFICIENT_GAS_FOR_DELIVERY", || require_delivery_gas(r));
        ctx_gas(
            "bob.testnet",
            0,
            NOW,
            vec![],
            Gas::from_tgas(reserve + 1),
            10u128.pow(27),
        );
        require_delivery_gas(r);
    }
    assert!(PAY_GAS.as_tgas() > reserve_native && SETTLE_GAS.as_tgas() > reserve_native);
    assert!(FT_ON_TRANSFER_GAS.as_tgas() > reserve_token);
}
fn rec_for(t: IntentTerms) -> Record {
    ctx("x.testnet", 0, NOW, vec![]);
    Record::new(t)
}

/// Reserved funds of one obligation can never pay another: a returned (owed)
/// amount and locked escrow must stay covered before anything leaves.
#[test]
fn owed_and_locked_funds_are_never_spent_on_another_obligation() {
    let mut c = contract();
    let held = terms(70, "instant");
    let escrow = terms(71, "protected");
    let fresh = terms(72, "instant");
    for t in [&held, &escrow, &fresh] {
        create(&mut c, t);
    }
    pay(&mut c, &held);
    assert!(!cb(&mut c, &held, "1", PromiseResult::Failed));
    lock(&mut c, &escrow);
    assert_eq!((c.owed, c.locked), (amount(&held), amount(&escrow)));
    // Balance (incl. the new deposit) one yocto short of storage + owed + locked + new.
    let required = storage_cost(env::storage_usage()) + c.owed + c.locked + amount(&fresh);
    ctx_gas(
        "bob.testnet",
        amount(&fresh),
        NOW + 1,
        vec![],
        Gas::from_tgas(300),
        required - amount(&fresh) - 1,
    );
    rejects_with("INSUFFICIENT_OPERATIONAL_LIQUIDITY", || {
        drop(c.pay_instant_native(fresh.id.clone(), fresh.terms_hash()));
    });
    assert_eq!(rec(&fresh).status, Status::Open);
    assert!(transfers().is_empty());
    // The beneficiary's resend is refused too while the account cannot cover
    // the escrow plus the owed amount (e.g. the failed transfer's NEAR has not
    // come back yet): it waits instead of spending the escrow.
    // (The mock adds the 1 yoctoNEAR authentication deposit to the balance.)
    let short = storage_cost(env::storage_usage()) + c.owed + c.locked - 2;
    ctx_gas(
        "alice.testnet",
        1,
        NOW + 2,
        vec![],
        Gas::from_tgas(300),
        short,
    );
    rejects_with("INSUFFICIENT_OPERATIONAL_LIQUIDITY", || {
        drop(c.retry_native_transfer(held.id.clone(), "1".into()));
    });
    assert_eq!(rec(&held).delivery, Delivery::Returned);
    assert_eq!(
        (c.owed, c.locked, c.sending),
        (amount(&held), amount(&escrow), 0)
    );
    c.conservation();
}

/// No path but an explicit Failed result for the CURRENT attempt moves money
/// back to "owed"; every other method refuses a settled request.
#[test]
fn a_settled_request_admits_no_other_transition() {
    let mut c = contract();
    let t = terms(80, "instant");
    create(&mut c, &t);
    pay(&mut c, &t);
    ctx("alice.testnet", 1, NOW + 2, vec![]);
    rejects_with("NOT_OPEN", || {
        c.cancel_unfunded(t.id.clone(), t.terms_hash());
    });
    ctx("bob.testnet", amount(&t), NOW + 2, vec![]);
    rejects_with("NOT_OPEN", || {
        drop(c.pay_instant_native(t.id.clone(), t.terms_hash()));
    });
    ctx("bob.testnet", 1, NOW + 2, vec![]);
    rejects_with("NOT_LOCKED", || {
        drop(c.cancel_protected(t.id.clone(), t.terms_hash()));
    });
    rejects_with("NOT_LOCKED", || {
        drop(c.release_protected(t.id.clone()));
    });
    assert_eq!(rec(&t).delivery, Delivery::Sent);
    assert!(transfers().is_empty());
}

/// Deterministic pseudo-random interleaving of payments, escrow settlements,
/// callback results (success, failure, never), stale callbacks and resends.
/// Invariants after every step:
///  - conservation of every bucket;
///  - per request: transfers scheduled == explicit failures (+1 unless the last
///    attempt came back and waits for a resend), so money only leaves when owed
///    and reaches the beneficiary at most once more than it came back;
///  - delivered + owed + sending for a request is exactly one amount.
#[test]
fn randomized_interleavings_never_pay_twice() {
    let mut c = contract();
    let mut seed: u64 = 0x5eed_1234_abcd_ef01;
    let mut next = || {
        seed ^= seed << 13;
        seed ^= seed >> 7;
        seed ^= seed << 17;
        seed
    };
    let ts: Vec<IntentTerms> = (100..124)
        .map(|n| terms(n, if n % 2 == 0 { "instant" } else { "protected" }))
        .collect();
    for t in &ts {
        create(&mut c, t);
    }
    let mut sent: HashMap<String, u32> = HashMap::new();
    let mut failed: HashMap<String, u32> = HashMap::new();
    let check = |c: &Payments, sent: &HashMap<String, u32>, failed: &HashMap<String, u32>| {
        c.conservation();
        for t in &ts {
            let s = *sent.get(&t.id).unwrap_or(&0);
            let f = *failed.get(&t.id).unwrap_or(&0);
            assert!(
                s <= f + 1,
                "request {} paid out more than once net of failures",
                &t.id[..8]
            );
            let r = load(&t.id);
            // Exact accounting of sends: one per failure, plus one unless the
            // latest attempt came back and awaits the beneficiary's resend.
            match r.delivery {
                Delivery::None => assert_eq!(s, 0),
                Delivery::Returned => assert_eq!(s, f, "returned: nothing in transit"),
                Delivery::Sent | Delivery::Delivered => assert_eq!(s, f + 1),
            }
        }
    };
    for _ in 0..600 {
        let t = &ts[(next() % ts.len() as u64) as usize];
        let r = load(&t.id);
        match (r.status, r.delivery, next() % 6) {
            (Status::Open, _, _) if t.mode == "instant" => pay(&mut c, t),
            (Status::Open, _, _) => lock(&mut c, t),
            (Status::Locked, _, k) => {
                if k % 2 == 0 {
                    ctx("bob.testnet", 1, r.cancel_until - 1, vec![]);
                    drop(c.cancel_protected(t.id.clone(), t.terms_hash()));
                } else {
                    ctx("eve.testnet", 1, r.cancel_until, vec![]);
                    drop(c.release_protected(t.id.clone()));
                }
            }
            (_, Delivery::Sent, 0) => {
                cb(&mut c, t, &r.nonce.to_string(), PromiseResult::Failed);
                *failed.entry(t.id.clone()).or_default() += 1;
            }
            (_, Delivery::Sent, 1 | 2) => {
                cb(
                    &mut c,
                    t,
                    &r.nonce.to_string(),
                    PromiseResult::Successful(vec![]),
                );
            }
            (_, _, 3) => {
                // Stale or duplicate callback with any result: inert.
                let stale = r.nonce.saturating_sub(1).to_string();
                cb(&mut c, t, &stale, PromiseResult::Failed);
            }
            (_, Delivery::Returned, _) => {
                let who = if r.branch == Branch::Payer {
                    "bob.testnet"
                } else {
                    "alice.testnet"
                };
                resend(&mut c, t, who, &r.nonce.to_string());
            }
            // Callback never arrives (R-2): stays SENT_UNCONFIRMED. Time passes.
            _ => ctx("x.testnet", 0, NOW + 3 * DURATION, vec![]),
        }
        let now = transfers();
        assert!(now.len() <= 1);
        for (to, amt) in now {
            assert_eq!(amt, amount(t));
            let r = load(&t.id);
            assert_eq!(to, r.destination().to_string(), "never to anyone else");
            *sent.entry(t.id.clone()).or_default() += 1;
        }
        check(&c, &sent, &failed);
    }
    // Every request is in exactly one bucket.
    for t in &ts {
        let r = load(&t.id);
        if r.branch != Branch::None {
            assert!(matches!(r.status, Status::Paid | Status::Refunded));
        }
    }
}
