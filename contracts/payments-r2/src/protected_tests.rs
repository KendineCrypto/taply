//! G3 candidate tests: Protected Pay escrow. Every transition, guard, race,
//! retry and conservation rule from docs/PAYMENT_STATE_MACHINE.md.
use super::*;
use near_sdk::test_utils::{VMContextBuilder, get_created_receipts};
use near_sdk::{PromiseResult, testing_env};
use std::panic::{AssertUnwindSafe, catch_unwind};

const NOW: u64 = 1_793_520_000_000_000_000;
const SECOND: u64 = 1_000_000_000;
const DURATION: u64 = 60 * SECOND;
const CONTRACT: &str = "payments.fixture.testnet";

fn context(caller: &str, deposit: u128, time: u64, results: Vec<PromiseResult>) {
    let mut b = VMContextBuilder::new();
    b.storage_usage(env::storage_usage());
    b.current_account_id(CONTRACT.parse().unwrap())
        .predecessor_account_id(caller.parse().unwrap())
        .signer_account_id(caller.parse().unwrap())
        .block_timestamp(time)
        .block_height(time / SECOND)
        .account_balance(NearToken::from_near(1000))
        .attached_deposit(NearToken::from_yoctonear(deposit))
        .prepaid_gas(Gas::from_tgas(300));
    testing_env!(
        b.build(),
        near_sdk::test_vm_config(),
        near_sdk::RuntimeFeesConfig::test(),
        Default::default(),
        results
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
fn base_terms(n: u64) -> IntentTerms {
    let mut t: IntentTerms = near_sdk::serde_json::from_str(include_str!(
        "../../../packages/shared/test-vectors/intent-a.json"
    ))
    .unwrap();
    t.creation_nonce = format!("{n:064x}");
    t.merchant_account_id = None;
    t.session_binding = None;
    t
}
fn protected_terms(n: u64, duration: u64) -> IntentTerms {
    let mut t = base_terms(n);
    t.mode = "protected".into();
    t.cancel_duration_ns = Some(duration.to_string());
    t.id = t.request_id();
    t
}
fn instant_terms(n: u64) -> IntentTerms {
    let mut t = base_terms(n);
    t.mode = "instant".into();
    t.cancel_duration_ns = None;
    t.id = t.request_id();
    t
}
fn contract() -> Payments {
    context(CONTRACT, 0, NOW, vec![]);
    Payments::new(vec![])
}
fn amount(t: &IntentTerms) -> u128 {
    decimal128(&t.amount_base_units)
}
fn create(c: &mut Payments, t: &IntentTerms) {
    context("alice.testnet", 0, NOW, vec![]);
    let q = c.quote_create_request(t.clone());
    context(
        "alice.testnet",
        decimal128(q["depositYocto"].as_str().unwrap()),
        NOW,
        vec![],
    );
    c.create_request(t.clone(), "1".into());
}
fn lock(c: &mut Payments, t: &IntentTerms, at: u64) -> Value {
    context("bob.testnet", amount(t), at, vec![]);
    c.fund_protected_native(
        t.id.clone(),
        t.terms_hash(),
        t.cancel_duration_ns.clone().unwrap(),
        CONSENT_VERSION.into(),
    )
}
fn cancel(c: &mut Payments, t: &IntentTerms, who: &str, at: u64) {
    context(who, 1, at, vec![]);
    drop(c.cancel_protected(t.id.clone(), t.terms_hash()));
}
fn release(c: &mut Payments, t: &IntentTerms, who: &str, at: u64) {
    context(who, 1, at, vec![]);
    drop(c.release_protected(t.id.clone()));
}
fn callback(c: &mut Payments, t: &IntentTerms, nonce: &str, kind: &str, at: u64, ok: bool) -> bool {
    let result = if ok {
        PromiseResult::Successful(vec![])
    } else {
        PromiseResult::Failed
    };
    context(CONTRACT, 0, at, vec![result]);
    c.on_native_transfer_complete(t.id.clone(), nonce.into(), kind.into())
}
fn status(t: &IntentTerms) -> Status {
    load(&t.id).status
}
/// Latest outgoing transfer receipt: (receiver, amount).
fn last_transfer() -> (String, u128) {
    let receipts = get_created_receipts();
    let r = receipts
        .iter()
        .rev()
        .find(|r| {
            r.actions
                .iter()
                .any(|a| matches!(a, near_sdk::mock::MockAction::Transfer { .. }))
        })
        .expect("transfer receipt");
    let amount = r
        .actions
        .iter()
        .find_map(|a| match a {
            near_sdk::mock::MockAction::Transfer { deposit, .. } => Some(deposit.as_yoctonear()),
            _ => None,
        })
        .unwrap();
    (r.receiver_id.to_string(), amount)
}
/// Writes a contract view for the cross-language wire check (scripts/check-wire.mjs).
fn snapshot(name: &str, view: &Value) {
    let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("artifacts/requests");
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(
        dir.join(format!("{name}.json")),
        near_sdk::serde_json::to_string_pretty(view).unwrap(),
    )
    .unwrap();
}
fn view(t: &IntentTerms) -> Value {
    load(&t.id).view()
}

#[test]
fn protected_terms_validate_duration_bounds_and_mode_pairing() {
    let c = contract();
    for d in [DURATION, 3_600 * SECOND] {
        context("alice.testnet", 0, NOW, vec![]);
        c.quote_create_request(protected_terms(d, d));
    }
    for d in [0, DURATION - 1, 3_600 * SECOND + 1] {
        context("alice.testnet", 0, NOW, vec![]);
        rejects_with("INVALID_CANCEL_DURATION", || {
            c.quote_create_request(protected_terms(d + 7, d));
        });
    }
    let mut no_duration = protected_terms(9, DURATION);
    no_duration.cancel_duration_ns = None;
    rejects_with("INVALID_CANCEL_DURATION", || {
        c.quote_create_request(no_duration);
    });
    let mut instant_with_duration = instant_terms(10);
    instant_with_duration.cancel_duration_ns = Some(DURATION.to_string());
    rejects_with("INVALID_CANCEL_DURATION", || {
        c.quote_create_request(instant_with_duration);
    });
    let mut milestone = protected_terms(11, DURATION);
    milestone.mode = "milestone".into();
    rejects_with("UNSUPPORTED_MODE", || {
        c.quote_create_request(milestone);
    });
    let mut token = protected_terms(12, DURATION);
    token.asset_id = "ft:usdc.fakes.testnet".into();
    rejects_with("TOKEN_DISABLED", || {
        c.quote_create_request(token);
    });
    let cfg = c.get_config();
    let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("artifacts/config");
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(
        dir.join("protected-config.json"),
        near_sdk::serde_json::to_string_pretty(&cfg).unwrap(),
    )
    .unwrap();
    assert_eq!(cfg["capabilities"]["protectedPay"], true);
    assert_eq!(cfg["capabilities"]["nep141"], false);
    assert_eq!(
        cfg["protected"]["reviewStatus"],
        "UNREVIEWED_NOT_FOR_REAL_FUNDS"
    );
}

#[test]
fn locked_is_not_paid_and_release_needs_chain_cutoff() {
    let mut c = contract();
    let t = protected_terms(1, DURATION);
    create(&mut c, &t);
    snapshot("protected-open", &view(&t));
    let funded_at = NOW + SECOND;
    let v = lock(&mut c, &t, funded_at);
    snapshot("protected-locked", &v);
    assert_eq!(v["status"], "LOCKED");
    assert_eq!(v["payerAccountId"], "bob.testnet");
    assert_eq!(v["fundedAtNs"], funded_at.to_string());
    assert_eq!(v["cancelUntilNs"], (funded_at + DURATION).to_string());
    assert_eq!(v["settlementBranch"], Value::Null);
    assert_eq!(v["latestOperation"], Value::Null);
    // No outgoing transfer at funding: escrow holds the principal.
    assert!(get_created_receipts().is_empty());
    assert_eq!(c.locked, amount(&t));
    assert_eq!(c.delivered_paid, 0);
    context("x.testnet", 0, NOW, vec![]);
    assert!(
        c.get_receipt(t.id.clone()).is_none(),
        "LOCKED has no terminal facts"
    );

    // Deadline passage alone executes nothing; release before the cutoff fails.
    rejects_with("CANCELLATION_WINDOW_OPEN", || {
        release(&mut c, &t, "carol.testnet", funded_at + DURATION - 1)
    });
    // Release needs 1 yoctoNEAR from a direct wallet call.
    context("carol.testnet", 0, funded_at + DURATION, vec![]);
    rejects_with("ONE_YOCTO_REQUIRED", || {
        drop(c.release_protected(t.id.clone()));
    });
    // At exactly the cutoff release wins; anyone may submit it.
    release(&mut c, &t, "carol.testnet", funded_at + DURATION);
    assert_eq!(last_transfer(), ("alice.testnet".into(), amount(&t)));
    assert_eq!(status(&t), Status::ReleaseInFlight);
    snapshot("protected-release-in-flight", &view(&t));
    assert_eq!(view(&t)["settlementBranch"], "RECIPIENT");
    assert_eq!(view(&t)["latestOperation"]["kind"], "PROTECTED_RELEASE");
    // The branch is committed: the payer can no longer cancel.
    rejects_with("NOT_LOCKED", || {
        cancel(&mut c, &t, "bob.testnet", funded_at + DURATION - 1)
    });
    assert!(callback(
        &mut c,
        &t,
        "1",
        "PROTECTED_RELEASE",
        funded_at + DURATION + 2,
        true
    ));
    assert_eq!(status(&t), Status::Paid);
    snapshot("protected-final-paid", &view(&t));
    assert_eq!(c.delivered_paid, amount(&t));
    assert_eq!(c.locked, 0);
    context("x.testnet", 0, NOW, vec![]);
    let facts = c.get_receipt(t.id.clone()).unwrap();
    assert_eq!(facts["payoutConfirmed"], true);
}

#[test]
fn payer_only_cancel_strictly_before_cutoff_refunds_payer() {
    let mut c = contract();
    let t = protected_terms(2, DURATION);
    create(&mut c, &t);
    lock(&mut c, &t, NOW + SECOND);
    let cutoff = NOW + SECOND + DURATION;
    rejects_with("PAYER_ONLY", || {
        cancel(&mut c, &t, "alice.testnet", cutoff - 1)
    });
    rejects_with("PAYER_ONLY", || {
        cancel(&mut c, &t, "mallory.testnet", cutoff - 1)
    });
    // At the exact cutoff cancellation loses.
    rejects_with("CANCELLATION_WINDOW_CLOSED", || {
        cancel(&mut c, &t, "bob.testnet", cutoff)
    });
    context("bob.testnet", 0, cutoff - 1, vec![]);
    rejects_with("ONE_YOCTO_REQUIRED", || {
        drop(c.cancel_protected(t.id.clone(), t.terms_hash()));
    });
    context("bob.testnet", 1, cutoff - 1, vec![]);
    rejects_with("TERMS_HASH_MISMATCH", || {
        drop(c.cancel_protected(t.id.clone(), "0".repeat(64)));
    });
    cancel(&mut c, &t, "bob.testnet", cutoff - 1);
    assert_eq!(last_transfer(), ("bob.testnet".into(), amount(&t)));
    assert_eq!(status(&t), Status::RefundInFlight);
    snapshot("protected-refund-in-flight", &view(&t));
    assert_eq!(view(&t)["settlementBranch"], "PAYER");
    assert_eq!(
        view(&t)["latestOperation"]["destinationAccountId"],
        "bob.testnet"
    );
    // Release cannot race an in-flight refund.
    rejects_with("NOT_LOCKED", || {
        release(&mut c, &t, "alice.testnet", cutoff + 5)
    });
    assert!(callback(
        &mut c,
        &t,
        "1",
        "PROTECTED_REFUND",
        cutoff + 2,
        true
    ));
    assert_eq!(status(&t), Status::Refunded);
    snapshot("protected-cancelled-refunded", &view(&t));
    assert_eq!(c.delivered_refunded, amount(&t));
    assert_eq!(c.delivered_paid, 0);
    context("x.testnet", 0, NOW, vec![]);
    let facts = c.get_receipt(t.id.clone()).unwrap();
    assert_eq!(facts["payoutConfirmed"], false, "refunded is never paid");
    assert_eq!(facts["request"]["status"], "CANCELLED_REFUNDED");
}

#[test]
fn funding_requires_explicit_consent_exact_principal_and_mode() {
    let mut c = contract();
    let t = protected_terms(3, 120 * SECOND);
    create(&mut c, &t);
    let at = NOW + SECOND;
    context("bob.testnet", amount(&t), at, vec![]);
    rejects_with("CANCEL_DURATION_NOT_ACCEPTED", || {
        c.fund_protected_native(
            t.id.clone(),
            t.terms_hash(),
            DURATION.to_string(),
            CONSENT_VERSION.into(),
        );
    });
    rejects_with("UNSUPPORTED_CONSENT_VERSION", || {
        c.fund_protected_native(
            t.id.clone(),
            t.terms_hash(),
            "120000000000".into(),
            "v0".into(),
        );
    });
    rejects_with("TERMS_HASH_MISMATCH", || {
        c.fund_protected_native(
            t.id.clone(),
            "f".repeat(64),
            "120000000000".into(),
            CONSENT_VERSION.into(),
        );
    });
    rejects_with("WRONG_MODE", || {
        drop(c.pay_instant_native(t.id.clone(), t.terms_hash()));
    });
    context("bob.testnet", amount(&t) - 1, at, vec![]);
    rejects_with("EXACT_PRINCIPAL_REQUIRED", || {
        lock_unchecked(&mut c, &t);
    });
    context("bob.testnet", amount(&t) + 1, at, vec![]);
    rejects_with("EXACT_PRINCIPAL_REQUIRED", || {
        lock_unchecked(&mut c, &t);
    });
    // Funding expiry is chain time.
    context(
        "bob.testnet",
        amount(&t),
        decimal64(&t.funding_expires_at_ns),
        vec![],
    );
    rejects_with("FUNDING_EXPIRED", || lock_unchecked(&mut c, &t));
    // Instant requests cannot be funded through the escrow path.
    let i = instant_terms(4);
    create(&mut c, &i);
    context("bob.testnet", amount(&i), at, vec![]);
    rejects_with("WRONG_MODE", || {
        c.fund_protected_native(
            i.id.clone(),
            i.terms_hash(),
            DURATION.to_string(),
            CONSENT_VERSION.into(),
        );
    });
    // Payer restriction is honoured.
    let mut r = protected_terms(5, DURATION);
    r.permitted_payer_account_id = Some("dave.testnet".parse().unwrap());
    r.id = r.request_id();
    create(&mut c, &r);
    rejects_with("WRONG_PAYER", || {
        lock(&mut c, &r, at);
    });
    context("dave.testnet", amount(&r), at, vec![]);
    lock_unchecked(&mut c, &r);
    // Funded once only.
    rejects_with("NOT_OPEN", || {
        lock(&mut c, &r, at + 1);
    });
    context("alice.testnet", 1, at + 2, vec![]);
    rejects_with("NOT_OPEN", || {
        c.cancel_unfunded(r.id.clone(), r.terms_hash());
    });
    assert_eq!(c.received, amount(&r));
    assert_eq!(c.locked, amount(&r));
    assert_eq!(status(&t), Status::Open);
}
fn lock_unchecked(c: &mut Payments, t: &IntentTerms) {
    c.fund_protected_native(
        t.id.clone(),
        t.terms_hash(),
        t.cancel_duration_ns.clone().unwrap(),
        CONSENT_VERSION.into(),
    );
}

#[test]
fn failed_refund_retries_only_same_branch_to_payer_with_fresh_nonce() {
    let mut c = contract();
    let t = protected_terms(6, DURATION);
    create(&mut c, &t);
    lock(&mut c, &t, NOW + SECOND);
    let cutoff = NOW + SECOND + DURATION;
    cancel(&mut c, &t, "bob.testnet", cutoff - 10);
    assert!(!callback(
        &mut c,
        &t,
        "1",
        "PROTECTED_REFUND",
        cutoff - 5,
        false
    ));
    assert_eq!(status(&t), Status::RefundFailed);
    snapshot("protected-refund-failed", &view(&t));
    assert_eq!(c.owed, amount(&t));
    // A failed refund never turns into a release, even after the cutoff.
    rejects_with("NOT_LOCKED", || {
        release(&mut c, &t, "alice.testnet", cutoff + 1)
    });
    context("alice.testnet", 1, cutoff + 1, vec![]);
    rejects_with("PAYER_ONLY", || {
        drop(c.retry_native_transfer(t.id.clone(), "1".into()));
    });
    context("bob.testnet", 1, cutoff + 1, vec![]);
    rejects_with("OPERATION_NONCE_MISMATCH", || {
        drop(c.retry_native_transfer(t.id.clone(), "2".into()));
    });
    // Retry after the cutoff is allowed: the branch was committed before it.
    drop(c.retry_native_transfer(t.id.clone(), "1".into()));
    assert_eq!(last_transfer(), ("bob.testnet".into(), amount(&t)));
    assert_eq!(status(&t), Status::RefundInFlight);
    assert_eq!(view(&t)["latestOperation"]["nonce"], "2");
    // Candidate: stale nonce or wrong kind is inert (false, no change) rather
    // than a panic.
    let before = view(&t);
    assert!(!callback(
        &mut c,
        &t,
        "1",
        "PROTECTED_REFUND",
        cutoff + 2,
        true
    ));
    assert!(!callback(
        &mut c,
        &t,
        "2",
        "PROTECTED_RELEASE",
        cutoff + 2,
        true
    ));
    assert_eq!(view(&t), before);
    assert_eq!(status(&t), Status::RefundInFlight);
    assert!(callback(
        &mut c,
        &t,
        "2",
        "PROTECTED_REFUND",
        cutoff + 3,
        true
    ));
    assert_eq!(status(&t), Status::Refunded);
    assert_eq!(c.owed, 0);
    assert_eq!(c.delivered_refunded, amount(&t));
}

#[test]
fn failed_release_retries_only_by_recipient_to_recipient() {
    let mut c = contract();
    let t = protected_terms(7, DURATION);
    create(&mut c, &t);
    lock(&mut c, &t, NOW + SECOND);
    let cutoff = NOW + SECOND + DURATION;
    release(&mut c, &t, "carol.testnet", cutoff);
    assert!(!callback(
        &mut c,
        &t,
        "1",
        "PROTECTED_RELEASE",
        cutoff + 1,
        false
    ));
    assert_eq!(status(&t), Status::ReleaseFailed);
    snapshot("protected-release-failed", &view(&t));
    // Payer cannot use a release failure to claw funds back.
    rejects_with("NOT_LOCKED", || {
        cancel(&mut c, &t, "bob.testnet", cutoff + 2)
    });
    for who in ["bob.testnet", "carol.testnet"] {
        context(who, 1, cutoff + 2, vec![]);
        rejects_with("RECIPIENT_ONLY", || {
            drop(c.retry_native_transfer(t.id.clone(), "1".into()));
        });
    }
    context("alice.testnet", 1, cutoff + 2, vec![]);
    drop(c.retry_native_transfer(t.id.clone(), "1".into()));
    assert_eq!(last_transfer(), ("alice.testnet".into(), amount(&t)));
    assert_eq!(status(&t), Status::ReleaseInFlight);
    assert!(callback(
        &mut c,
        &t,
        "2",
        "PROTECTED_RELEASE",
        cutoff + 3,
        true
    ));
    assert_eq!(status(&t), Status::Paid);
}

#[test]
fn unknown_or_forged_callbacks_keep_the_obligation_reserved() {
    let mut c = contract();
    let t = protected_terms(8, DURATION);
    create(&mut c, &t);
    lock(&mut c, &t, NOW + SECOND);
    let cutoff = NOW + SECOND + DURATION;
    // Callback with nothing in flight is stale.
    let locked = view(&t);
    assert!(!callback(
        &mut c,
        &t,
        "1",
        "PROTECTED_RELEASE",
        cutoff,
        true
    ));
    assert_eq!(view(&t), locked);
    release(&mut c, &t, "alice.testnet", cutoff);
    // Only the contract itself may call the callback.
    context(
        "mallory.testnet",
        0,
        cutoff + 1,
        vec![PromiseResult::Successful(vec![])],
    );
    rejects_with("PRIVATE_CALLBACK", || {
        c.on_native_transfer_complete(t.id.clone(), "1".into(), "PROTECTED_RELEASE".into());
    });
    // No promise result: unknown, never treated as failure or success.
    context(CONTRACT, 0, cutoff + 1, vec![]);
    rejects_with("UNKNOWN_PROMISE_RESULT", || {
        c.on_native_transfer_complete(t.id.clone(), "1".into(), "PROTECTED_RELEASE".into());
    });
    assert_eq!(status(&t), Status::ReleaseInFlight);
    // In-flight obligations cannot be retried or re-branched.
    context("alice.testnet", 1, cutoff + 2, vec![]);
    rejects_with("NO_RECORDED_TRANSFER_FAILURE", || {
        drop(c.retry_native_transfer(t.id.clone(), "1".into()));
    });
    assert_eq!(c.sending, amount(&t));
    assert_eq!(c.delivered_paid, 0);
}

#[test]
fn conservation_holds_across_instant_and_protected_interleavings() {
    let mut c = contract();
    let inst = instant_terms(20);
    let refund = protected_terms(21, DURATION);
    let release_ok = protected_terms(22, DURATION);
    let held = protected_terms(23, 3_600 * SECOND);
    for t in [&inst, &refund, &release_ok, &held] {
        create(&mut c, t);
    }
    context("bob.testnet", amount(&inst), NOW + 1, vec![]);
    drop(c.pay_instant_native(inst.id.clone(), inst.terms_hash()));
    for t in [&refund, &release_ok, &held] {
        lock(&mut c, t, NOW + 1);
    }
    cancel(&mut c, &refund, "bob.testnet", NOW + 2);
    release(&mut c, &release_ok, "eve.testnet", NOW + 1 + DURATION);
    callback(
        &mut c,
        &inst,
        "1",
        "INSTANT_PAYOUT",
        NOW + DURATION + 5,
        true,
    );
    callback(
        &mut c,
        &refund,
        "1",
        "PROTECTED_REFUND",
        NOW + DURATION + 5,
        false,
    );
    callback(
        &mut c,
        &release_ok,
        "1",
        "PROTECTED_RELEASE",
        NOW + DURATION + 5,
        true,
    );
    let a = amount(&inst);
    context("x.testnet", 0, NOW + DURATION + 6, vec![]);
    let acc = c.get_accounting();
    assert_eq!(acc["receivedPrincipalYocto"], (4 * a).to_string());
    assert_eq!(acc["deliveredPaidYocto"], (2 * a).to_string());
    assert_eq!(acc["owedPrincipalYocto"], a.to_string());
    assert_eq!(acc["lockedPrincipalYocto"], a.to_string());
    assert_eq!(acc["deliveredRefundedYocto"], "0");
    assert_eq!(acc["sendingPrincipalYocto"], "0");
    assert_eq!(status(&held), Status::Locked);
}

#[test]
fn liquidity_guard_counts_locked_escrow() {
    let mut c = contract();
    let t = protected_terms(30, DURATION);
    create(&mut c, &t);
    lock(&mut c, &t, NOW + 1);
    // Simulate a balance that no longer covers escrow + storage: any new funding
    // or settlement must fail closed rather than spend another obligation.
    let u = protected_terms(31, DURATION);
    create(&mut c, &u);
    let mut b = VMContextBuilder::new();
    b.storage_usage(env::storage_usage());
    b.current_account_id(CONTRACT.parse().unwrap())
        .predecessor_account_id("bob.testnet".parse().unwrap())
        .signer_account_id("bob.testnet".parse().unwrap())
        .block_timestamp(NOW + 2)
        .account_balance(NearToken::from_yoctonear(amount(&t)))
        .attached_deposit(NearToken::from_yoctonear(amount(&u)))
        .prepaid_gas(Gas::from_tgas(300));
    testing_env!(b.build());
    rejects_with("INSUFFICIENT_OPERATIONAL_LIQUIDITY", || {
        lock_unchecked(&mut c, &u)
    });
}
