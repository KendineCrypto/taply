//! R-2 candidate: adversarial unit tests. Two families of properties:
//!  - NO FALSE PAID: FINAL_PAID / CANCELLED_REFUNDED (and get_receipt) appear
//!    only after the contract's own callback confirmed the transfer; a pending,
//!    failed, unsupported or never-arriving callback never yields them;
//!  - NO DOUBLE PAYMENT: money leaves only when owed, and is owed again only
//!    after an explicit Failed result for the current attempt.
use super::*;
use near_sdk::test_utils::{VMContextBuilder, get_created_receipts};
use near_sdk::{PromiseResult, testing_env};
use std::collections::HashMap;
use std::panic::{AssertUnwindSafe, catch_unwind};

const NOW: u64 = 1_793_520_000_000_000_000;
const SECOND: u64 = 1_000_000_000;
const DURATION: u64 = 60 * SECOND;
const CONTRACT: &str = "payments.fixture.testnet";
const TOKEN: &str = "tusd.fixture.testnet";
const BIG: u128 = 1000 * 10u128.pow(24);

fn ctx_full(
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
    ctx_full(caller, deposit, time, results, Gas::from_tgas(300), BIG);
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
fn token_terms(n: u64) -> IntentTerms {
    let mut t = terms(n, "instant");
    t.asset_id = format!("nep141:{TOKEN}");
    t.amount_base_units = "1000000".into();
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
fn token_contract() -> Payments {
    ctx(CONTRACT, 0, NOW, vec![]);
    Payments::new(vec![TokenSpec {
        account_id: TOKEN.parse().unwrap(),
        decimals: 6,
        symbol: "tUSD-TEST".into(),
    }])
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
fn pay_token(c: &mut Payments, t: &IntentTerms) {
    ctx(TOKEN, 0, NOW + 1, vec![]);
    let msg = near_sdk::serde_json::json!({"id": t.id, "expectedTermsHash": t.terms_hash(), "action": "pay_instant"});
    let _ = c.ft_on_transfer(
        "bob.testnet".parse().unwrap(),
        near_sdk::json_types::U128(amount(t)),
        msg.to_string(),
    );
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
fn kind_of(t: &IntentTerms) -> String {
    let r = load(&t.id);
    if r.branch == Branch::None {
        "INSTANT_PAYOUT".into()
    } else {
        r.branch.kind(&r.terms.mode).into()
    }
}
fn cb(c: &mut Payments, t: &IntentTerms, nonce: &str, result: PromiseResult) -> bool {
    let kind = kind_of(t);
    ctx(CONTRACT, 0, NOW + 2 * DURATION, vec![result]);
    c.on_native_transfer_complete(t.id.clone(), nonce.into(), kind)
}
fn resend(c: &mut Payments, t: &IntentTerms, who: &str, nonce: &str) {
    ctx(who, 1, NOW + 2 * DURATION, vec![]);
    drop(c.retry_native_transfer(t.id.clone(), nonce.into()));
}
fn rec(t: &IntentTerms) -> Record {
    load(&t.id)
}
/// Native transfers scheduled in the current context: (receiver, amount).
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
/// Every signal a client could read as "paid": request status, terminal facts,
/// payoutConfirmed and the delivery view's `received`.
fn paid_signals(c: &Payments, t: &IntentTerms) -> (String, bool, bool, bool) {
    ctx("observer.testnet", 0, NOW + 3 * DURATION, vec![]);
    let status = c.get_request(t.id.clone()).unwrap()["status"]
        .as_str()
        .unwrap()
        .to_string();
    let receipt = c.get_receipt(t.id.clone());
    let confirmed = receipt
        .as_ref()
        .is_some_and(|r| r["payoutConfirmed"] == true);
    let received = c.get_delivery(t.id.clone()).unwrap()["received"] == true;
    (status, receipt.is_some(), confirmed, received)
}
fn assert_not_paid(c: &Payments, t: &IntentTerms, expect_status: &str) {
    let (status, receipt, confirmed, received) = paid_signals(c, t);
    assert_eq!(status, expect_status);
    assert!(
        status != "FINAL_PAID" && status != "CANCELLED_REFUNDED",
        "false final status {status}"
    );
    assert!(!receipt, "terminal facts exist for a non-final request");
    assert!(!confirmed && !received, "a paid signal leaked");
}

/// R-2 core, both variants: the callback never records the outcome, whether
/// the transfer arrived (callback panicked / ran out of gas) or failed (and the
/// callback failed too). The contract cannot tell them apart, so it shows
/// neither as paid: PAYOUT_IN_FLIGHT, no terminal facts, no resend.
#[test]
fn a_callback_that_never_completes_never_shows_paid_and_never_resends() {
    let mut c = contract();
    let t = terms(1, "instant");
    create(&mut c, &t);
    pay(&mut c, &t);
    assert_eq!(transfers(), vec![("alice.testnet".into(), amount(&t))]);
    assert_not_paid(&c, &t, "PAYOUT_IN_FLIGHT");
    ctx("x.testnet", 0, NOW, vec![]);
    let d = c.get_delivery(t.id.clone()).unwrap();
    assert_eq!(d["settlement"], "COMMITTED");
    assert_eq!(d["delivery"], "PENDING_UNCONFIRMED");
    assert_eq!(d["resendAllowed"], false);
    for who in ["alice.testnet", "bob.testnet", "mallory.testnet"] {
        ctx(who, 1, NOW + 2 * DURATION, vec![]);
        rejects_with("NO_RECORDED_TRANSFER_FAILURE", || {
            drop(c.retry_native_transfer(t.id.clone(), "1".into()));
        });
        assert!(transfers().is_empty(), "nothing may be sent again");
    }
    assert_eq!((c.owed, c.sending, c.delivered_paid), (0, amount(&t), 0));
}

/// The same for Protected release and refund: never FINAL_PAID / CANCELLED_REFUNDED
/// while unconfirmed.
#[test]
fn protected_settlements_are_not_final_until_confirmed() {
    for (n, refund) in [(2, false), (3, true)] {
        let mut c = contract();
        let t = terms(n, "protected");
        create(&mut c, &t);
        lock(&mut c, &t);
        let cutoff = rec(&t).cancel_until;
        if refund {
            ctx("bob.testnet", 1, cutoff - 1, vec![]);
            drop(c.cancel_protected(t.id.clone(), t.terms_hash()));
            assert_not_paid(&c, &t, "REFUND_IN_FLIGHT");
        } else {
            ctx("carol.testnet", 1, cutoff, vec![]);
            drop(c.release_protected(t.id.clone()));
            assert_not_paid(&c, &t, "RELEASE_IN_FLIGHT");
        }
        // Explicit failure: recoverable, still not final.
        assert!(!cb(&mut c, &t, "1", PromiseResult::Failed));
        assert_not_paid(
            &c,
            &t,
            if refund {
                "REFUND_FAILED_RECOVERABLE"
            } else {
                "RELEASE_FAILED_RECOVERABLE"
            },
        );
        // Confirmed resend: final now.
        resend(
            &mut c,
            &t,
            if refund {
                "bob.testnet"
            } else {
                "alice.testnet"
            },
            "1",
        );
        assert!(cb(&mut c, &t, "2", PromiseResult::Successful(vec![])));
        let (status, receipt, confirmed, received) = paid_signals(&c, &t);
        assert_eq!(
            status,
            if refund {
                "CANCELLED_REFUNDED"
            } else {
                "FINAL_PAID"
            }
        );
        assert!(receipt && received);
        assert_eq!(confirmed, !refund, "a refund is never a payout");
    }
}

/// Promise result classification. Only a runtime success confirms; only a
/// runtime failure returns the amount; an unsupported success (a native
/// Transfer returning bytes, a token returning more than 256 bytes) changes
/// nothing and is never treated as delivered.
#[test]
fn promise_results_are_classified_conservatively() {
    // Native.
    for (n, result, expect) in [
        (10, PromiseResult::Successful(vec![]), "FINAL_PAID"),
        (11, PromiseResult::Failed, "PAYOUT_FAILED_RECOVERABLE"),
        (12, PromiseResult::Successful(vec![1]), "PAYOUT_IN_FLIGHT"),
        (
            13,
            PromiseResult::Successful(vec![7; 1000]),
            "PAYOUT_IN_FLIGHT",
        ),
    ] {
        let mut c = contract();
        let t = terms(n, "instant");
        create(&mut c, &t);
        pay(&mut c, &t);
        let before = rec(&t).view();
        let confirmed = cb(&mut c, &t, "1", result);
        assert_eq!(confirmed, expect == "FINAL_PAID");
        assert_eq!(paid_signals(&c, &t).0, expect);
        if expect == "PAYOUT_IN_FLIGHT" {
            assert_eq!(rec(&t).view(), before, "unsupported result changed state");
            assert_eq!((c.owed, c.sending, c.delivered_paid), (0, amount(&t), 0));
        }
        c.conservation();
    }
    // NEP-141: up to 256 bytes is a supported success (R-1), more is unsupported.
    for (n, result, expect) in [
        (20, PromiseResult::Successful(vec![]), "FINAL_PAID"),
        (
            21,
            PromiseResult::Successful(b"\"ok\"".to_vec()),
            "FINAL_PAID",
        ),
        (
            22,
            PromiseResult::Successful(vec![b'x'; 257]),
            "PAYOUT_IN_FLIGHT",
        ),
        (23, PromiseResult::Failed, "PAYOUT_FAILED_RECOVERABLE"),
    ] {
        let mut c = token_contract();
        let t = token_terms(n);
        create(&mut c, &t);
        pay_token(&mut c, &t);
        assert_eq!(paid_signals(&c, &t).0, "PAYOUT_IN_FLIGHT");
        cb(&mut c, &t, "1", result);
        assert_eq!(paid_signals(&c, &t).0, expect);
        c.conservation();
    }
}

/// Stale, duplicate, mismatched and malformed callbacks are inert: they never
/// confirm, never return money, never panic.
#[test]
fn stale_duplicate_and_mismatched_callbacks_are_inert() {
    let mut c = contract();
    let t = terms(30, "instant");
    let other = terms(31, "instant");
    create(&mut c, &t);
    create(&mut c, &other);
    pay(&mut c, &t);
    let before = rec(&t).view();
    for nonce in ["0", "2", "01", "-1", "1x", "18446744073709551616", ""] {
        for result in [PromiseResult::Failed, PromiseResult::Successful(vec![])] {
            assert!(!cb(&mut c, &t, nonce, result), "nonce {nonce:?}");
            assert_eq!(rec(&t).view(), before);
        }
    }
    for kind in [
        "PROTECTED_RELEASE",
        "PROTECTED_REFUND",
        "",
        "INSTANT_PAYOUT ",
    ] {
        ctx(
            CONTRACT,
            0,
            NOW + 2,
            vec![PromiseResult::Successful(vec![])],
        );
        assert!(!c.on_native_transfer_complete(t.id.clone(), "1".into(), kind.into()));
        assert_eq!(rec(&t).view(), before);
    }
    ctx(CONTRACT, 0, NOW + 2, vec![PromiseResult::Failed]);
    assert!(!c.on_native_transfer_complete("f".repeat(64), "1".into(), "INSTANT_PAYOUT".into()));
    // A request never sent (still OPEN) is inert.
    assert!(!cb(&mut c, &other, "1", PromiseResult::Successful(vec![])));
    assert_eq!(rec(&other).status, Status::Open);
    // The real one, then its duplicate.
    assert!(cb(&mut c, &t, "1", PromiseResult::Successful(vec![])));
    let done = rec(&t).view();
    assert!(!cb(&mut c, &t, "1", PromiseResult::Failed));
    assert_eq!(
        rec(&t).view(),
        done,
        "a later Failed cannot undo a confirmation"
    );
    assert_eq!((c.owed, c.delivered_paid), (0, amount(&t)));
    c.conservation();
}

/// Forged callbacks: other callers, no promise result, two results.
#[test]
fn forged_callbacks_are_refused_and_change_nothing() {
    let mut c = contract();
    let t = terms(40, "instant");
    create(&mut c, &t);
    pay(&mut c, &t);
    let before = rec(&t).view();
    for caller in ["alice.testnet", "bob.testnet", "mallory.testnet"] {
        ctx(caller, 0, NOW + 2, vec![PromiseResult::Successful(vec![])]);
        rejects_with("PRIVATE_CALLBACK", || {
            c.on_native_transfer_complete(t.id.clone(), "1".into(), "INSTANT_PAYOUT".into());
        });
    }
    for results in [
        vec![],
        vec![
            PromiseResult::Successful(vec![]),
            PromiseResult::Successful(vec![]),
        ],
    ] {
        ctx(CONTRACT, 0, NOW + 2, results);
        rejects_with("UNKNOWN_PROMISE_RESULT", || {
            c.on_native_transfer_complete(t.id.clone(), "1".into(), "INSTANT_PAYOUT".into());
        });
    }
    assert_eq!(rec(&t).view(), before);
    assert_not_paid(&c, &t, "PAYOUT_IN_FLIGHT");
}

/// Resend after an explicit failure: beneficiary only, same destination, latest
/// nonce only, exactly once per failure; never across requests.
#[test]
fn resend_is_beneficiary_only_once_per_failure_and_never_cross_request() {
    let mut c = contract();
    let a = terms(50, "instant");
    let b = terms(51, "instant");
    create(&mut c, &a);
    create(&mut c, &b);
    pay(&mut c, &a);
    pay(&mut c, &b);
    assert!(!cb(&mut c, &a, "1", PromiseResult::Failed));
    for who in ["bob.testnet", "mallory.testnet"] {
        ctx(who, 1, NOW + 2 * DURATION, vec![]);
        rejects_with("RECIPIENT_ONLY", || {
            drop(c.retry_native_transfer(a.id.clone(), "1".into()));
        });
    }
    ctx(CONTRACT, 1, NOW + 2 * DURATION, vec![]);
    rejects_with("DIRECT_WALLET_ONLY", || {
        drop(c.retry_native_transfer(a.id.clone(), "1".into()));
    });
    ctx("alice.testnet", 1, NOW + 2 * DURATION, vec![]);
    // b is unconfirmed: a's failure can never be used to resend b.
    rejects_with("NO_RECORDED_TRANSFER_FAILURE", || {
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
    assert_not_paid(&c, &a, "PAYOUT_IN_FLIGHT");
    ctx("alice.testnet", 1, NOW + 2 * DURATION, vec![]);
    rejects_with("NO_RECORDED_TRANSFER_FAILURE", || {
        drop(c.retry_native_transfer(a.id.clone(), "1".into()));
    });
    assert!(transfers().is_empty());
    assert!(cb(&mut c, &a, "2", PromiseResult::Successful(vec![])));
    assert_eq!(c.delivered_paid, amount(&a));
    assert_eq!(c.sending, amount(&b));
    c.conservation();
}

/// Branch exclusivity: once a refund is committed no release (and vice versa),
/// whatever the delivery outcome.
#[test]
fn cancel_and_release_cannot_both_settle() {
    let mut c = contract();
    let t = terms(60, "protected");
    create(&mut c, &t);
    lock(&mut c, &t);
    let cutoff = rec(&t).cancel_until;
    ctx("bob.testnet", 1, cutoff - 1, vec![]);
    drop(c.cancel_protected(t.id.clone(), t.terms_hash()));
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
    assert_eq!((c.settled_paid, c.settled_refunded), (0, amount(&t)));
    c.conservation();
}

/// Too little unspent gas to schedule the transfer AND its callback: refused.
#[test]
fn delivery_requires_gas_for_transfer_and_callback() {
    let native = rec_for(terms(70, "instant"));
    let token = rec_for(token_terms(71));
    let reserve_native = CALLBACK_GAS.as_tgas() + DELIVERY_GAS_MARGIN.as_tgas();
    let reserve_token = reserve_native + FT_TRANSFER_GAS.as_tgas();
    for (r, reserve) in [(&native, reserve_native), (&token, reserve_token)] {
        ctx_full(
            "bob.testnet",
            0,
            NOW,
            vec![],
            Gas::from_tgas(reserve - 1),
            BIG,
        );
        rejects_with("INSUFFICIENT_GAS_FOR_DELIVERY", || require_delivery_gas(r));
        ctx_full(
            "bob.testnet",
            0,
            NOW,
            vec![],
            Gas::from_tgas(reserve + 1),
            BIG,
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

/// Reserved funds of one obligation can never pay another.
#[test]
fn owed_and_locked_funds_are_never_spent_on_another_obligation() {
    let mut c = contract();
    let held = terms(80, "instant");
    let escrow = terms(81, "protected");
    let fresh = terms(82, "instant");
    for t in [&held, &escrow, &fresh] {
        create(&mut c, t);
    }
    pay(&mut c, &held);
    assert!(!cb(&mut c, &held, "1", PromiseResult::Failed));
    lock(&mut c, &escrow);
    let required = storage_cost(env::storage_usage()) + c.owed + c.locked + amount(&fresh);
    ctx_full(
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
    // (The mock adds the 1 yoctoNEAR authentication deposit to the balance.)
    let short = storage_cost(env::storage_usage()) + c.owed + c.locked - 2;
    ctx_full(
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

/// Deterministic pseudo-random interleaving of payments, escrow settlements,
/// callback results (success, failure, unsupported, never), stale callbacks and
/// resends. After every step:
///  - conservation of every bucket;
///  - transfers scheduled per request == explicit failures (+1 unless the last
///    attempt came back and awaits a resend): nothing is ever paid twice;
///  - FINAL_PAID / CANCELLED_REFUNDED, terminal facts, payoutConfirmed and
///    `received` hold exactly when the callback confirmed delivery.
#[test]
fn randomized_interleavings_never_pay_twice_and_never_show_false_paid() {
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
    let check = |c: &Payments,
                 sent: &HashMap<String, u32>,
                 failed: &HashMap<String, u32>,
                 only: Option<&IntentTerms>| {
        c.conservation();
        for t in ts.iter().filter(|t| only.is_none_or(|o| o.id == t.id)) {
            let s = *sent.get(&t.id).unwrap_or(&0);
            let f = *failed.get(&t.id).unwrap_or(&0);
            let r = load(&t.id);
            match r.delivery {
                Delivery::None => assert_eq!(s, 0),
                Delivery::Returned => assert_eq!(s, f, "returned: nothing in transit"),
                Delivery::Sent | Delivery::Delivered => assert_eq!(s, f + 1, "paid at most once"),
            }
            let (status, receipt, confirmed, received) = paid_signals(c, t);
            let delivered = r.delivery == Delivery::Delivered;
            let is_final = status == "FINAL_PAID" || status == "CANCELLED_REFUNDED";
            assert_eq!(
                is_final, delivered,
                "final status without confirmed delivery: {status}"
            );
            assert_eq!(receipt, delivered);
            assert_eq!(received, delivered);
            assert_eq!(confirmed, delivered && r.branch == Branch::Recipient);
        }
    };
    let mut step = 0u32;
    for _ in 0..600 {
        let t = &ts[(next() % ts.len() as u64) as usize];
        let r = load(&t.id);
        match (r.status, r.delivery, next() % 7) {
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
            (_, Delivery::Sent, 3) => {
                // Unsupported result: nothing changes.
                cb(
                    &mut c,
                    t,
                    &r.nonce.to_string(),
                    PromiseResult::Successful(vec![9]),
                );
            }
            (_, _, 4) => {
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
            // The callback never arrives (R-2): stays in flight. Time passes.
            _ => ctx("x.testnet", 0, NOW + 3 * DURATION, vec![]),
        }
        let now = transfers();
        assert!(now.len() <= 1);
        for (to, amt) in now {
            assert_eq!(amt, amount(t));
            assert_eq!(
                to,
                load(&t.id).destination().to_string(),
                "never to anyone else"
            );
            *sent.entry(t.id.clone()).or_default() += 1;
        }
        check(&c, &sent, &failed, Some(t));
        step += 1;
        if step.is_multiple_of(50) {
            check(&c, &sent, &failed, None);
        }
    }
    check(&c, &sent, &failed, None);
}
