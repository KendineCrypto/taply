use super::*;
use near_sdk::test_utils::{VMContextBuilder, get_created_receipts};
use near_sdk::{PromiseResult, testing_env};
use std::panic::{AssertUnwindSafe, catch_unwind};

fn context(caller: &str, deposit: u128, time: u64, results: Vec<PromiseResult>) {
    let mut b = VMContextBuilder::new();
    b.storage_usage(env::storage_usage());
    b.current_account_id("payments.fixture.testnet".parse().unwrap())
        .predecessor_account_id(caller.parse().unwrap())
        .signer_account_id(caller.parse().unwrap())
        .block_timestamp(time)
        .block_height(time / 1_000_000_000)
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
const NOW: u64 = 1_793_520_000_000_000_000;
fn terms(n: u64) -> IntentTerms {
    let mut t: IntentTerms = near_sdk::serde_json::from_str(include_str!(
        "../../../packages/shared/test-vectors/intent-a.json"
    ))
    .unwrap();
    t.creation_nonce = format!("{n:064x}");
    t.mode = "instant".into();
    t.cancel_duration_ns = None;
    t.merchant_account_id = None;
    t.session_binding = None;
    t.id = t.request_id();
    t
}
fn contract() -> Payments {
    context("payments.fixture.testnet", 0, NOW, vec![]);
    Payments::new(vec![])
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
fn fund(c: &mut Payments, t: &IntentTerms) {
    context(
        "bob.testnet",
        decimal128(&t.amount_base_units),
        NOW + 1,
        vec![],
    );
    drop(c.pay_instant_native(t.id.clone(), t.terms_hash()));
}
fn callback(c: &mut Payments, t: &IntentTerms, nonce: &str, result: PromiseResult) -> bool {
    context("payments.fixture.testnet", 0, NOW + 3, vec![result]);
    c.on_delivery_complete(t.id.clone(), nonce.into())
}
fn rejects(f: impl FnOnce()) {
    assert!(catch_unwind(AssertUnwindSafe(f)).is_err());
}

#[test]
fn frozen_jcs_fixtures_match_both_languages() {
    context("alice.testnet", 0, NOW, vec![]);
    let expected: Value = near_sdk::serde_json::from_str(include_str!(
        "../../../packages/shared/test-vectors/expected.json"
    ))
    .unwrap();
    for (raw, canonical_raw, name) in [
        (
            include_str!("../../../packages/shared/test-vectors/intent-a.json"),
            include_str!("../../../packages/shared/test-vectors/intent-a.canonical.json"),
            "a",
        ),
        (
            include_str!("../../../packages/shared/test-vectors/intent-b.json"),
            include_str!("../../../packages/shared/test-vectors/intent-b.canonical.json"),
            "b",
        ),
    ] {
        let t: IntentTerms = near_sdk::serde_json::from_str(raw).unwrap();
        assert_eq!(
            canonical(&near_sdk::serde_json::to_value(&t).unwrap()),
            canonical_raw.trim()
        );
        assert_eq!(t.request_id(), expected["requestId"]);
        assert_eq!(t.terms_hash(), expected[name]["termsHash"]);
        assert_eq!(
            domain_hash("taply.session.v1", &t.terms_hash()),
            expected[name]["sessionCommitment"]
        );
    }
}

#[test]
fn payout_settles_in_one_receipt_and_only_the_callback_confirms_delivery() {
    let mut c = contract();
    let t = terms(10);
    create(&mut c, &t);
    let size = env::storage_usage();
    fund(&mut c, &t);
    // Settled in the paying receipt; the transfer is debited and sent.
    assert_eq!(load(&t.id).status, Status::Paid);
    assert_eq!(load(&t.id).delivery, Delivery::Sent);
    assert_eq!(c.sending, decimal128(&t.amount_base_units));
    assert_eq!(
        c.get_receipt(t.id.clone()).unwrap()["payoutConfirmed"],
        false
    );
    assert_eq!(get_created_receipts().len(), 2);
    assert!(callback(&mut c, &t, "1", PromiseResult::Successful(vec![])));
    assert_eq!(load(&t.id).status, Status::Paid);
    assert_eq!(load(&t.id).delivery, Delivery::Delivered);
    assert_eq!(c.delivered_paid, decimal128(&t.amount_base_units));
    assert_eq!(c.sending, 0);
    c.conservation();
    assert_eq!(env::storage_usage(), size);
    assert_eq!(
        c.get_receipt(t.id.clone()).unwrap()["payoutConfirmed"],
        true
    );
    // A duplicate callback changes nothing.
    let before = load(&t.id).view();
    assert!(!callback(
        &mut c,
        &t,
        "1",
        PromiseResult::Successful(vec![])
    ));
    assert!(!callback(&mut c, &t, "1", PromiseResult::Failed));
    assert_eq!(load(&t.id).view(), before);
    assert_eq!(
        (c.owed, c.delivered_paid),
        (0, decimal128(&t.amount_base_units))
    );
}

#[test]
fn failed_payout_same_beneficiary_retry_new_nonce_only() {
    let mut c = contract();
    let t = terms(11);
    create(&mut c, &t);
    fund(&mut c, &t);
    assert!(!callback(&mut c, &t, "1", PromiseResult::Failed));
    assert_eq!(load(&t.id).delivery, Delivery::Returned);
    assert_eq!(c.owed, decimal128(&t.amount_base_units));
    context("bob.testnet", 1, NOW + 4, vec![]);
    rejects(|| {
        drop(c.retry_native_transfer(t.id.clone(), "1".into()));
    });
    context("alice.testnet", 1, NOW + 4, vec![]);
    rejects(|| {
        drop(c.retry_native_transfer(t.id.clone(), "2".into()));
    });
    drop(c.retry_native_transfer(t.id.clone(), "1".into()));
    assert_eq!(load(&t.id).nonce, 2);
    rejects(|| {
        drop(c.retry_native_transfer(t.id.clone(), "1".into()));
    });
    // The superseded attempt's callback is stale: no effect even if "failed".
    assert!(!callback(&mut c, &t, "1", PromiseResult::Failed));
    assert_eq!(load(&t.id).delivery, Delivery::Sent);
    assert!(callback(&mut c, &t, "2", PromiseResult::Successful(vec![])));
    assert_eq!((c.owed, c.sending), (0, 0));
    c.conservation();
}

#[test]
fn unknown_and_forged_callbacks_leave_delivery_unconfirmed() {
    let mut c = contract();
    let t = terms(12);
    create(&mut c, &t);
    fund(&mut c, &t);
    context(
        "alice.testnet",
        0,
        NOW + 2,
        vec![PromiseResult::Successful(vec![])],
    );
    rejects(|| {
        c.on_delivery_complete(t.id.clone(), "1".into());
    });
    for results in [
        vec![],
        vec![PromiseResult::Successful(vec![]), PromiseResult::Failed],
    ] {
        context("payments.fixture.testnet", 0, NOW + 2, results);
        rejects(|| {
            c.on_delivery_complete(t.id.clone(), "1".into());
        });
        assert_eq!(load(&t.id).status, Status::Paid);
        assert_eq!(load(&t.id).delivery, Delivery::Sent);
        c.conservation();
    }
    context("alice.testnet", 1, NOW + 3, vec![]);
    rejects(|| {
        drop(c.retry_native_transfer(t.id.clone(), "1".into()));
    });
}

#[test]
fn duplicate_nonce_and_changed_terms_rejected() {
    let mut c = contract();
    let t = terms(13);
    create(&mut c, &t);
    rejects(|| {
        c.create_request(t.clone(), "1".into());
    });
    let mut changed = t.clone();
    changed.amount_base_units = "2".into();
    rejects(|| {
        c.create_request(changed, "1".into());
    });
    assert_eq!(c.request_count, 1);
}

#[test]
fn amount_terms_payer_expiry_and_cancellation_guards() {
    let mut c = contract();
    let mut t = terms(14);
    t.permitted_payer_account_id = Some("bob.testnet".parse().unwrap());
    create(&mut c, &t);
    for amount in [
        0,
        1,
        decimal128(&t.amount_base_units) - 1,
        decimal128(&t.amount_base_units) + 1,
    ] {
        context("bob.testnet", amount, NOW + 1, vec![]);
        rejects(|| {
            drop(c.pay_instant_native(t.id.clone(), t.terms_hash()));
        });
    }
    context(
        "eve.testnet",
        decimal128(&t.amount_base_units),
        NOW + 1,
        vec![],
    );
    rejects(|| {
        drop(c.pay_instant_native(t.id.clone(), t.terms_hash()));
    });
    context(
        "bob.testnet",
        decimal128(&t.amount_base_units),
        NOW + 1,
        vec![],
    );
    rejects(|| {
        drop(c.pay_instant_native(t.id.clone(), "0".repeat(64)));
    });
    context(
        "bob.testnet",
        decimal128(&t.amount_base_units),
        decimal64(&t.funding_expires_at_ns),
        vec![],
    );
    rejects(|| {
        drop(c.pay_instant_native(t.id.clone(), t.terms_hash()));
    });
    context("eve.testnet", 1, NOW + 1, vec![]);
    rejects(|| {
        c.cancel_unfunded(t.id.clone(), t.terms_hash());
    });
    context("alice.testnet", 1, NOW + 1, vec![]);
    c.cancel_unfunded(t.id.clone(), t.terms_hash());
    assert_eq!(
        c.get_receipt(t.id.clone()).unwrap()["payoutConfirmed"],
        false
    );
    rejects(|| {
        fund(&mut c, &t);
    });
}

#[test]
fn exact_storage_bond_and_no_growth_at_maximum_sizes() {
    let mut c = contract();
    let mut t = terms(15);
    t.memo = "é".repeat(128);
    let q = c.quote_create_request(t.clone());
    let bond = decimal128(q["depositYocto"].as_str().unwrap());
    for bad in [bond - 1, bond + 1] {
        context("alice.testnet", bad, NOW, vec![]);
        rejects(|| {
            c.create_request(t.clone(), "1".into());
        });
    }
    create(&mut c, &t);
    let before = env::storage_usage();
    context(
        &"b".repeat(64),
        decimal128(&t.amount_base_units),
        NOW + 1,
        vec![],
    );
    drop(c.pay_instant_native(t.id.clone(), t.terms_hash()));
    callback(&mut c, &t, "1", PromiseResult::Failed);
    assert_eq!(before, env::storage_usage());
    assert_eq!(c.storage_bonds, bond);
}

#[test]
fn strict_wire_rejects_unknown_duplicate_missing_and_noncanonical_terms() {
    context("alice.testnet", 0, NOW, vec![]);
    let raw = near_sdk::serde_json::to_string(&terms(16)).unwrap();
    assert!(
        near_sdk::serde_json::from_str::<IntentTerms>(
            &raw.replace("\"memo\":", "\"memo\":\"x\",\"memo\":")
        )
        .is_err()
    );
    assert!(
        near_sdk::serde_json::from_str::<IntentTerms>(
            &raw.replace("\"memo\":", "\"extra\":1,\"memo\":")
        )
        .is_err()
    );
    assert!(
        near_sdk::serde_json::from_str::<IntentTerms>(
            &raw.replace("\"sessionBinding\":null", "\"sessionBindingMissing\":null")
        )
        .is_err()
    );
    for s in [
        "",
        "01",
        "+1",
        "1.0",
        "1e2",
        " 1",
        "340282366920938463463374607431768211456",
    ] {
        rejects(|| {
            decimal128(s);
        });
    }
    for s in ["0".repeat(63), "A".repeat(64), "g".repeat(64)] {
        rejects(|| {
            hash_bytes(&s);
        });
    }
}

#[test]
fn disabled_modes_and_invalid_terms_cannot_be_quoted() {
    let c = contract();
    let base = terms(17);
    for field in [
        "mode",
        "assetId",
        "network",
        "contractId",
        "memo",
        "fundingExpiresAtNs",
        "amountBaseUnits",
        "merchantAccountId",
    ] {
        let mut v = near_sdk::serde_json::to_value(&base).unwrap();
        v[field] = match field {
            "mode" => json!("protected"),
            "assetId" => json!("ft:fake.testnet"),
            "network" => json!("mainnet"),
            "contractId" => json!("other.testnet"),
            "memo" => json!("é".repeat(129)),
            "fundingExpiresAtNs" => json!(NOW.to_string()),
            "merchantAccountId" => json!("alice.testnet"),
            _ => json!("0"),
        };
        let bad: IntentTerms = near_sdk::serde_json::from_value(v).unwrap();
        rejects(|| {
            c.quote_create_request(bad);
        });
    }
}

#[test]
fn aggregate_conservation_across_interleaved_requests() {
    let mut c = contract();
    let ts: Vec<_> = (20..40).map(terms).collect();
    for t in &ts {
        create(&mut c, t);
        fund(&mut c, t);
        c.conservation();
    }
    for (i, t) in ts.iter().enumerate() {
        if i % 3 != 0 {
            callback(
                &mut c,
                t,
                "1",
                if i % 3 == 1 {
                    PromiseResult::Failed
                } else {
                    PromiseResult::Successful(vec![])
                },
            );
        }
        c.conservation();
    }
    assert_eq!(c.received, decimal128(&ts[0].amount_base_units) * 20);
    assert!(c.sending > 0 && c.owed > 0 && c.delivered_paid > 0);
}

#[test]
fn forwarding_low_gas_and_counter_overflow_fail_closed() {
    let mut c = contract();
    let t = terms(50);
    create(&mut c, &t);
    let mut b = VMContextBuilder::new();
    b.current_account_id("payments.fixture.testnet".parse().unwrap())
        .predecessor_account_id("proxy.testnet".parse().unwrap())
        .signer_account_id("bob.testnet".parse().unwrap())
        .block_timestamp(NOW + 1)
        .prepaid_gas(Gas::from_tgas(300));
    testing_env!(b.build());
    rejects(|| {
        drop(c.pay_instant_native(t.id.clone(), t.terms_hash()));
    });
    b.predecessor_account_id("bob.testnet".parse().unwrap())
        .prepaid_gas(Gas::from_tgas(49));
    testing_env!(b.build());
    rejects(|| {
        drop(c.pay_instant_native(t.id.clone(), t.terms_hash()));
    });
    rejects(|| {
        inc(u64::MAX);
    });
    rejects(|| {
        add(u128::MAX, 1);
    });
    assert_eq!(load(&t.id).status, Status::Open);
}

#[test]
fn funded_request_cannot_cancel_refund_or_fund_twice() {
    let mut c = contract();
    let t = terms(51);
    create(&mut c, &t);
    fund(&mut c, &t);
    rejects(|| {
        fund(&mut c, &t);
    });
    context("alice.testnet", 1, NOW + 2, vec![]);
    rejects(|| {
        c.cancel_unfunded(t.id.clone(), t.terms_hash());
    });
    assert_eq!(load(&t.id).status, Status::Paid);
    assert_eq!(c.received, decimal128(&t.amount_base_units));
}

#[test]
fn new_funding_cannot_spend_storage_or_another_failed_obligation() {
    let mut c = contract();
    let held = terms(52);
    let fresh = terms(53);
    create(&mut c, &held);
    create(&mut c, &fresh);
    fund(&mut c, &held);
    callback(&mut c, &held, "1", PromiseResult::Failed);
    let mut b = VMContextBuilder::new();
    b.current_account_id("payments.fixture.testnet".parse().unwrap())
        .predecessor_account_id("bob.testnet".parse().unwrap())
        .signer_account_id("bob.testnet".parse().unwrap())
        .block_timestamp(NOW + 5)
        .storage_usage(env::storage_usage())
        .prepaid_gas(Gas::from_tgas(50))
        .attached_deposit(NearToken::from_yoctonear(
            fresh.amount_base_units.parse().unwrap(),
        ));
    // Runtime account_balance already includes attached deposit. Short by one
    // yocto of the combined held principal + storage + new principal requirement.
    let required =
        storage_cost(env::storage_usage()) + c.owed + decimal128(&fresh.amount_base_units);
    // VMContextBuilder takes the pre-deposit balance; the mock runtime adds it.
    b.account_balance(NearToken::from_yoctonear(
        required - decimal128(&fresh.amount_base_units) - 1,
    ));
    testing_env!(b.build());
    rejects(|| {
        drop(c.pay_instant_native(fresh.id.clone(), fresh.terms_hash()));
    });
    assert_eq!(load(&fresh.id).status, Status::Open);
    assert_eq!(c.owed, decimal128(&held.amount_base_units));
    assert!(get_created_receipts().is_empty());
    c.conservation();
}

#[test]
fn quote_version_authorization_deposits_and_self_recipient() {
    let mut c = contract();
    let t = terms(54);
    context(
        "alice.testnet",
        storage_cost(storage_bytes(&Record::new(t.clone()))),
        NOW,
        vec![],
    );
    rejects(|| {
        c.create_request(t.clone(), "01".into());
    });
    rejects(|| {
        c.create_request(t.clone(), "2".into());
    });
    create(&mut c, &t);
    for deposit in [0, 2] {
        context("alice.testnet", deposit, NOW + 1, vec![]);
        rejects(|| {
            c.cancel_unfunded(t.id.clone(), t.terms_hash());
        });
    }
    let mut bad = terms(55);
    bad.creator_account_id = bad.contract_id.clone();
    bad.id = bad.request_id();
    rejects(|| {
        c.quote_create_request(bad);
    });
    assert_eq!(load(&t.id).status, Status::Open);
}

#[test]
fn runtime_wire_input_and_invalid_reads_are_rejected() {
    let c = contract();
    let mut b = VMContextBuilder::new();
    b.context.input = br#"{"id":"0000000000000000000000000000000000000000000000000000000000000000","extra":true}"#.to_vec().into();
    testing_env!(b.build());
    rejects(|| {
        c.get_request("0".repeat(64));
    });
    b.context.input = vec![b' '; 8193].into();
    testing_env!(b.build());
    rejects(|| {
        c.get_request("0".repeat(64));
    });
    context("alice.testnet", 0, NOW, vec![]);
    rejects(|| {
        c.get_request("oops".into());
    });
    assert!(c.get_request("f".repeat(64)).is_none());
    assert!(c.get_receipt("f".repeat(64)).is_none());
}
