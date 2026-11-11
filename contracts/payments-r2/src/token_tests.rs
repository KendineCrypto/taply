//! NEP-141 path of the candidate: funding only through the allowlisted token's
//! ft_on_transfer, exact amounts, strict msg, token payouts/refunds, retries.
use super::*;
use near_sdk::test_utils::{VMContextBuilder, get_created_receipts};
use near_sdk::{PromiseResult, testing_env};
use std::panic::{AssertUnwindSafe, catch_unwind};

const NOW: u64 = 1_793_520_000_000_000_000;
const S: u64 = 1_000_000_000;
const CONTRACT: &str = "payments.fixture.testnet";
const TOKEN: &str = "tusd.fixture.testnet";
const AMOUNT: u128 = 2_500_000; // 2.5 tUSD-TEST (6 decimals)

fn ctx(caller: &str, signer: &str, deposit: u128, time: u64, results: Vec<PromiseResult>) {
    let mut b = VMContextBuilder::new();
    b.storage_usage(env::storage_usage());
    b.current_account_id(CONTRACT.parse().unwrap())
        .predecessor_account_id(caller.parse().unwrap())
        .signer_account_id(signer.parse().unwrap())
        .block_timestamp(time)
        .block_height(time / S)
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
fn contract() -> Payments {
    ctx(CONTRACT, CONTRACT, 0, NOW, vec![]);
    Payments::new(vec![TokenSpec {
        account_id: TOKEN.parse().unwrap(),
        decimals: 6,
        symbol: "tUSD-TEST".into(),
    }])
}
fn terms(n: u64, mode: &str, asset: &str) -> IntentTerms {
    let mut t: IntentTerms = near_sdk::serde_json::from_str(include_str!(
        "../../../packages/shared/test-vectors/intent-a.json"
    ))
    .unwrap();
    t.creation_nonce = format!("{n:064x}");
    t.merchant_account_id = None;
    t.session_binding = None;
    t.asset_id = asset.into();
    t.amount_base_units = AMOUNT.to_string();
    t.mode = mode.into();
    t.cancel_duration_ns = (mode == "protected").then(|| (60 * S).to_string());
    t.id = t.request_id();
    t
}
fn token_terms(n: u64, mode: &str) -> IntentTerms {
    terms(n, mode, &format!("nep141:{TOKEN}"))
}
fn create(c: &mut Payments, t: &IntentTerms) {
    ctx("alice.testnet", "alice.testnet", 0, NOW, vec![]);
    let q = c.quote_create_request(t.clone());
    ctx(
        "alice.testnet",
        "alice.testnet",
        decimal128(q["depositYocto"].as_str().unwrap()),
        NOW,
        vec![],
    );
    c.create_request(t.clone(), "1".into());
}
fn msg(t: &IntentTerms, action: &str) -> String {
    let mut m = json!({"id": t.id, "expectedTermsHash": t.terms_hash(), "action": action});
    if action == "fund_protected" {
        m["acceptedCancelDurationNs"] = json!(t.cancel_duration_ns);
        m["consentVersion"] = json!(CONSENT_VERSION);
    }
    m.to_string()
}
fn ft_in(
    c: &mut Payments,
    token: &str,
    payer: &str,
    amount: u128,
    m: String,
    time: u64,
) -> PromiseOrValue<U128> {
    ctx(token, payer, 0, time, vec![]);
    c.ft_on_transfer(payer.parse().unwrap(), U128(amount), m)
}
fn used_all(v: PromiseOrValue<U128>) -> bool {
    matches!(v, PromiseOrValue::Value(U128(0)))
}
fn callback(c: &mut Payments, t: &IntentTerms, nonce: &str, kind: &str, ok: bool) -> bool {
    ctx(
        CONTRACT,
        CONTRACT,
        0,
        NOW + 100 * S,
        vec![if ok {
            PromiseResult::Successful(vec![])
        } else {
            PromiseResult::Failed
        }],
    );
    c.on_native_transfer_complete(t.id.clone(), nonce.into(), kind.into())
}
/// The last ft_transfer the contract scheduled: (token, receiver, amount, attached yocto).
fn last_ft_transfer() -> (String, String, String, u128) {
    let r = get_created_receipts();
    let receipt = r.iter().rev().find(|r| r.actions.iter().any(|a| matches!(a, near_sdk::mock::MockAction::FunctionCallWeight { method_name, .. } if method_name == b"ft_transfer"))).expect("ft_transfer");
    let (args, deposit) = receipt
        .actions
        .iter()
        .find_map(|a| match a {
            near_sdk::mock::MockAction::FunctionCallWeight {
                method_name,
                args,
                attached_deposit,
                ..
            } if method_name == b"ft_transfer" => {
                Some((args.clone(), attached_deposit.as_yoctonear()))
            }
            _ => None,
        })
        .unwrap();
    let v: Value = near_sdk::serde_json::from_slice(&args).unwrap();
    (
        receipt.receiver_id.to_string(),
        v["receiver_id"].as_str().unwrap().into(),
        v["amount"].as_str().unwrap().into(),
        deposit,
    )
}
fn status(t: &IntentTerms) -> Status {
    load(&t.id).status
}
fn snapshot(name: &str, v: &Value) {
    let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("artifacts/requests-token");
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(
        dir.join(format!("{name}.json")),
        near_sdk::serde_json::to_string_pretty(v).unwrap(),
    )
    .unwrap();
}

#[test]
fn allowlist_is_fixed_at_init_and_enforced_on_terms() {
    let c = contract();
    ctx("alice.testnet", "alice.testnet", 0, NOW, vec![]);
    c.quote_create_request(token_terms(1, "instant"));
    rejects_with("TOKEN_DISABLED", || {
        c.quote_create_request(terms(2, "instant", "nep141:evil.testnet"));
    });
    rejects_with("TOKEN_DISABLED", || {
        c.quote_create_request(terms(3, "instant", "ft:tusd.fixture.testnet"));
    });
    let cfg = c.get_config();
    assert_eq!(cfg["capabilities"]["nep141"], true);
    assert_eq!(cfg["tokens"][0]["assetId"], format!("nep141:{TOKEN}"));
    assert_eq!(cfg["tokens"][0]["decimals"], 6);
    let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("artifacts/config");
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(
        dir.join("token-config.json"),
        near_sdk::serde_json::to_string_pretty(&cfg).unwrap(),
    )
    .unwrap();
    ctx(CONTRACT, CONTRACT, 0, NOW, vec![]);
    rejects_with("INVALID_TOKEN_ALLOWLIST", || {
        Payments::new(vec![
            TokenSpec {
                account_id: TOKEN.parse().unwrap(),
                decimals: 6,
                symbol: "A".into(),
            },
            TokenSpec {
                account_id: TOKEN.parse().unwrap(),
                decimals: 6,
                symbol: "B".into(),
            },
        ]);
    });
    rejects_with("INVALID_TOKEN_METADATA", || {
        Payments::new(vec![TokenSpec {
            account_id: TOKEN.parse().unwrap(),
            decimals: 25,
            symbol: "A".into(),
        }]);
    });
}

#[test]
fn instant_token_payment_pays_recipient_in_tokens_only_after_callback() {
    let mut c = contract();
    let t = token_terms(10, "instant");
    create(&mut c, &t);
    snapshot("token-instant-open", &load(&t.id).view());
    // Native funding of a token request is refused.
    ctx("bob.testnet", "bob.testnet", AMOUNT, NOW + 1, vec![]);
    rejects_with("WRONG_ASSET", || {
        drop(c.pay_instant_native(t.id.clone(), t.terms_hash()));
    });
    assert!(used_all(ft_in(
        &mut c,
        TOKEN,
        "bob.testnet",
        AMOUNT,
        msg(&t, "pay_instant"),
        NOW + 2
    )));
    assert_eq!(status(&t), Status::InFlight);
    snapshot("token-instant-in-flight", &load(&t.id).view());
    assert_eq!(
        last_ft_transfer(),
        (TOKEN.into(), "alice.testnet".into(), AMOUNT.to_string(), 1)
    );
    assert!(callback(&mut c, &t, "1", "INSTANT_PAYOUT", true));
    assert_eq!(status(&t), Status::Paid);
    snapshot("token-instant-final-paid", &load(&t.id).view());
    let acc = c.get_accounting();
    assert_eq!(acc["tokens"][0]["deliveredPaid"], AMOUNT.to_string());
    assert_eq!(acc["deliveredPaidYocto"], "0", "native ledger untouched");
    // Funded once: a second transfer panics, so the token refunds it in full.
    rejects_with("NOT_OPEN", || {
        let _ = ft_in(
            &mut c,
            TOKEN,
            "bob.testnet",
            AMOUNT,
            msg(&t, "pay_instant"),
            NOW + 3,
        );
    });
}

#[test]
fn fake_token_wrong_amount_and_hostile_messages_are_refused() {
    let mut c = contract();
    let t = token_terms(20, "instant");
    create(&mut c, &t);
    rejects_with("WRONG_ASSET", || {
        let _ = ft_in(
            &mut c,
            "evil.testnet",
            "bob.testnet",
            AMOUNT,
            msg(&t, "pay_instant"),
            NOW + 1,
        );
    });
    rejects_with("EXACT_PRINCIPAL_REQUIRED", || {
        let _ = ft_in(
            &mut c,
            TOKEN,
            "bob.testnet",
            AMOUNT - 1,
            msg(&t, "pay_instant"),
            NOW + 1,
        );
    });
    let mut payee = near_sdk::serde_json::from_str::<Value>(&msg(&t, "pay_instant")).unwrap();
    payee["receiverId"] = json!("mallory.testnet");
    rejects_with("INVALID_FT_MESSAGE", || {
        let _ = ft_in(
            &mut c,
            TOKEN,
            "bob.testnet",
            AMOUNT,
            payee.to_string(),
            NOW + 1,
        );
    });
    rejects_with("INVALID_FT_MESSAGE", || {
        let _ = ft_in(
            &mut c,
            TOKEN,
            "bob.testnet",
            AMOUNT,
            "not json".into(),
            NOW + 1,
        );
    });
    rejects_with("WRONG_MODE", || {
        let _ = ft_in(
            &mut c,
            TOKEN,
            "bob.testnet",
            AMOUNT,
            msg(&t, "fund_protected"),
            NOW + 1,
        );
    });
    rejects_with("FUNDING_EXPIRED", || {
        let _ = ft_in(
            &mut c,
            TOKEN,
            "bob.testnet",
            AMOUNT,
            msg(&t, "pay_instant"),
            decimal64(&t.funding_expires_at_ns),
        );
    });
    let mut r = token_terms(21, "instant");
    r.permitted_payer_account_id = Some("dave.testnet".parse().unwrap());
    r.id = r.request_id();
    create(&mut c, &r);
    rejects_with("WRONG_PAYER", || {
        let _ = ft_in(
            &mut c,
            TOKEN,
            "bob.testnet",
            AMOUNT,
            msg(&r, "pay_instant"),
            NOW + 1,
        );
    });
    assert_eq!(status(&t), Status::Open);
    assert_eq!(c.get_accounting()["tokens"][0]["received"], "0");
}

#[test]
fn protected_token_refund_failure_is_held_and_retried_to_the_payer() {
    let mut c = contract();
    let t = token_terms(30, "protected");
    create(&mut c, &t);
    let mut wrong = near_sdk::serde_json::from_str::<Value>(&msg(&t, "fund_protected")).unwrap();
    wrong["acceptedCancelDurationNs"] = json!("120000000000");
    rejects_with("CANCEL_DURATION_NOT_ACCEPTED", || {
        let _ = ft_in(
            &mut c,
            TOKEN,
            "bob.testnet",
            AMOUNT,
            wrong.to_string(),
            NOW + 1,
        );
    });
    assert!(used_all(ft_in(
        &mut c,
        TOKEN,
        "bob.testnet",
        AMOUNT,
        msg(&t, "fund_protected"),
        NOW + 1
    )));
    assert_eq!(status(&t), Status::Locked);
    snapshot("token-protected-locked", &load(&t.id).view());
    assert_eq!(
        c.get_accounting()["tokens"][0]["locked"],
        AMOUNT.to_string()
    );
    ctx("bob.testnet", "bob.testnet", 1, NOW + 2, vec![]);
    drop(c.cancel_protected(t.id.clone(), t.terms_hash()));
    assert_eq!(
        last_ft_transfer(),
        (TOKEN.into(), "bob.testnet".into(), AMOUNT.to_string(), 1)
    );
    // e.g. payer not registered with the token: the transfer fails, funds stay held.
    assert!(!callback(&mut c, &t, "1", "PROTECTED_REFUND", false));
    assert_eq!(status(&t), Status::RefundFailed);
    let failed = load(&t.id).view();
    assert_eq!(
        failed["latestOperation"]["failureCode"],
        "FT_TRANSFER_FAILED"
    );
    snapshot("token-protected-refund-failed", &failed);
    assert_eq!(c.get_accounting()["tokens"][0]["owed"], AMOUNT.to_string());
    ctx("bob.testnet", "bob.testnet", 1, NOW + 3, vec![]);
    drop(c.retry_native_transfer(t.id.clone(), "1".into()));
    assert!(callback(&mut c, &t, "2", "PROTECTED_REFUND", true));
    assert_eq!(status(&t), Status::Refunded);
    snapshot("token-protected-refunded", &load(&t.id).view());
    let acc = c.get_accounting();
    assert_eq!(acc["tokens"][0]["deliveredRefunded"], AMOUNT.to_string());
    assert_eq!(acc["tokens"][0]["owed"], "0");
}

#[test]
fn protected_token_release_after_cutoff() {
    let mut c = contract();
    let t = token_terms(40, "protected");
    create(&mut c, &t);
    let _ = ft_in(
        &mut c,
        TOKEN,
        "bob.testnet",
        AMOUNT,
        msg(&t, "fund_protected"),
        NOW + 1,
    );
    let cutoff = NOW + 1 + 60 * S;
    ctx("carol.testnet", "carol.testnet", 1, cutoff - 1, vec![]);
    rejects_with("CANCELLATION_WINDOW_OPEN", || {
        drop(c.release_protected(t.id.clone()));
    });
    ctx("carol.testnet", "carol.testnet", 1, cutoff, vec![]);
    drop(c.release_protected(t.id.clone()));
    assert_eq!(
        last_ft_transfer(),
        (TOKEN.into(), "alice.testnet".into(), AMOUNT.to_string(), 1)
    );
    assert!(callback(&mut c, &t, "1", "PROTECTED_RELEASE", true));
    assert_eq!(status(&t), Status::Paid);
    snapshot("token-protected-final-paid", &load(&t.id).view());
}

#[test]
fn token_payout_success_with_a_return_value_is_still_success() {
    let mut c = contract();
    let t = token_terms(50, "instant");
    create(&mut c, &t);
    let _ = ft_in(
        &mut c,
        TOKEN,
        "bob.testnet",
        AMOUNT,
        msg(&t, "pay_instant"),
        NOW + 1,
    );
    ctx(
        CONTRACT,
        CONTRACT,
        0,
        NOW + 100 * S,
        vec![PromiseResult::Successful(b"\"ok\"".to_vec())],
    );
    assert!(c.on_native_transfer_complete(t.id.clone(), "1".into(), "INSTANT_PAYOUT".into()));
    assert_eq!(status(&t), Status::Paid);
}
