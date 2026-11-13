use super::*;
use near_sdk::test_utils::{VMContextBuilder, get_created_receipts};
use near_sdk::{PromiseResult, testing_env};
use std::panic::{AssertUnwindSafe, catch_unwind};
const CONTRACT: &str = "devkendinecrypto.near";
const NOW: u64 = 1_793_520_000_000_000_000;

fn ctx(caller: &str, deposit: u128, gas: u64, time: u64, results: Vec<PromiseResult>) {
    let mut b = VMContextBuilder::new();
    b.current_account_id(CONTRACT.parse().unwrap())
        .predecessor_account_id(caller.parse().unwrap()).signer_account_id(caller.parse().unwrap())
        .storage_usage(env::storage_usage()).account_balance(NearToken::from_near(100))
        .attached_deposit(NearToken::from_yoctonear(deposit)).prepaid_gas(Gas::from_tgas(gas))
        .block_timestamp(time).block_height(100);
    testing_env!(b.build(), near_sdk::test_vm_config(), near_sdk::RuntimeFeesConfig::test(), Default::default(), results);
}
fn setup() -> Payments {
    ctx(CONTRACT, 0, 300, NOW, vec![]);
    Payments::new(vec![TokenSpec { account_id: USDC.parse().unwrap(), decimals: 6, symbol: "USDC".into() }],
        "intents.near".parse().unwrap(), "kendinecrypto.near".parse().unwrap(), U128(NATIVE_CAP), U128(USDC_CAP))
}
fn terms(n: u64, native: bool) -> IntentTerms {
    let mut t: IntentTerms = near_sdk::serde_json::from_str(include_str!("../../../packages/shared/test-vectors/intent-a.json")).unwrap();
    t.network = "near-mainnet".into(); t.contract_id = CONTRACT.parse().unwrap();
    t.creator_account_id = "merchant.near".parse().unwrap(); t.creation_nonce = format!("{n:064x}");
    t.asset_id = if native { NATIVE.into() } else { format!("nep141:{USDC}") };
    t.amount_base_units = if native { NATIVE_CAP.to_string() } else { "1000000".into() };
    t.mode = "instant".into(); t.cancel_duration_ns = None; t.merchant_account_id = None;
    t.session_binding = None; t.permitted_payer_account_id = None;
    t.funding_expires_at_ns = (NOW + 1_000_000_000).to_string(); t.id = t.request_id(); t
}
fn create(c: &mut Payments, t: &IntentTerms) {
    ctx("merchant.near", 0, 300, NOW, vec![]);
    let q = c.quote_create_request(t.clone());
    ctx("merchant.near", decimal128(q["depositYocto"].as_str().unwrap()), 300, NOW, vec![]);
    c.create_request(t.clone(), "1".into());
}
fn msg(t: &IntentTerms) -> String { json!({"id":t.id,"expectedTermsHash":t.terms_hash(),"action":"pay_instant"}).to_string() }
fn delivery(c: &mut Payments, amount: u128, message: String, gas: u64) {
    ctx(USDC, 0, gas, NOW + 2_000_000_000, vec![]);
    assert!(matches!(c.ft_on_transfer("intents.near".parse().unwrap(), U128(amount), message), PromiseOrValue::Value(U128(0))));
    c.conservation();
}
fn rejects(f: impl FnOnce()) { assert!(catch_unwind(AssertUnwindSafe(f)).is_err()); }

#[test]
fn router_late_open_overpayment_exact_payout_duplicate_and_conservation() {
    let mut c = setup(); let t = terms(1, false); create(&mut c, &t);
    delivery(&mut c, 1_100_000, msg(&t), 250);
    assert_eq!(c.tokens[0].unclaimed_held, 100_000);
    assert_eq!(load(&t.id).status, Status::InFlight);
    assert_eq!(get_created_receipts().len(), 2);
    delivery(&mut c, 1_000_000, msg(&t), 250);
    assert!(get_created_receipts().is_empty());
    assert_eq!(c.tokens[0].unclaimed_held, 1_100_000);
    ctx(CONTRACT, 0, 300, NOW + 3, vec![PromiseResult::Successful(vec![])]);
    assert!(c.on_native_transfer_complete(t.id.clone(), "1".into(), "INSTANT_PAYOUT".into()));
    assert_eq!(load(&t.id).status, Status::Paid); c.conservation();
}
#[test]
fn native_exact_payment_and_failure_retry_are_nonce_bound() {
    let mut c = setup(); let t = terms(2, true); create(&mut c, &t);
    ctx("payer.near", NATIVE_CAP, 300, NOW + 1, vec![]);
    drop(c.pay_instant_native(t.id.clone(), t.terms_hash()));
    ctx(CONTRACT, 0, 300, NOW + 2, vec![PromiseResult::Failed]);
    assert!(!c.on_native_transfer_complete(t.id.clone(), "1".into(), "INSTANT_PAYOUT".into()));
    assert_eq!(load(&t.id).status, Status::Failed);
    ctx("merchant.near", 1, 300, NOW + 3, vec![]);
    drop(c.retry_native_transfer(t.id.clone(), "1".into()));
    ctx(CONTRACT, 0, 300, NOW + 4, vec![PromiseResult::Successful(vec![])]);
    assert!(c.on_native_transfer_complete(t.id.clone(), "2".into(), "INSTANT_PAYOUT".into())); c.conservation();
}
#[test]
fn caps_network_recipient_and_protected_fail_closed() {
    let c = setup();
    for native in [true, false] {
        let mut t = terms(3, native); t.amount_base_units = (if native { NATIVE_CAP + 1 } else { USDC_CAP + 1 }).to_string();
        rejects(|| { c.quote_create_request(t); });
    }
    let mut t = terms(4, false); t.network = "near-testnet".into(); t.id = t.request_id();
    rejects(|| { c.quote_create_request(t); });
    let mut t = terms(5, false); t.creator_account_id = CONTRACT.parse().unwrap(); t.id = t.request_id();
    rejects(|| { c.quote_create_request(t); });
    let mut t = terms(6, false); t.mode = "protected".into(); t.cancel_duration_ns = Some("60000000000".into());
    rejects(|| { c.quote_create_request(t); });
}
#[test]
fn router_rejections_and_low_gas_are_held_without_payout() {
    let mut c = setup(); let t = terms(7, false); create(&mut c, &t);
    let messages = ["{".into(), "x".repeat(1025), json!({"id":"0".repeat(64),"expectedTermsHash":"0".repeat(64),"action":"pay_instant"}).to_string(),
        json!({"id":t.id,"expectedTermsHash":"0".repeat(64),"action":"pay_instant"}).to_string(),
        json!({"id":t.id,"expectedTermsHash":t.terms_hash(),"action":"fund_protected"}).to_string()];
    for message in messages { delivery(&mut c, 1_000_000, message, 250); assert!(get_created_receipts().is_empty()); }
    delivery(&mut c, 900_000, msg(&t), 250);
    delivery(&mut c, 1_000_000, msg(&t), 20);
    assert_eq!(load(&t.id).status, Status::Open);
    assert_eq!(c.tokens[0].received, c.tokens[0].unclaimed_held);
}
#[test]
fn recovery_failure_restores_only_unclaimed_and_unknown_never_retries() {
    let mut c = setup(); delivery(&mut c, 2_000_000, "bad".into(), 250);
    ctx("attacker.near", 1, 300, NOW, vec![]);
    rejects(|| { drop(c.withdraw_unclaimed(USDC.parse().unwrap(), U128(1), "payer.near".parse().unwrap())); });
    ctx("kendinecrypto.near", 1, 300, NOW, vec![]);
    drop(c.withdraw_unclaimed(USDC.parse().unwrap(), U128(1_000_000), "payer.near".parse().unwrap()));
    ctx(CONTRACT, 0, 300, NOW, vec![PromiseResult::Failed]);
    assert!(!c.on_unclaimed_transfer_complete("1".into())); assert_eq!(c.tokens[0].unclaimed_held, 2_000_000);
    ctx("kendinecrypto.near", 1, 300, NOW, vec![]);
    drop(c.withdraw_unclaimed(USDC.parse().unwrap(), U128(1_000_000), "payer.near".parse().unwrap()));
    ctx(CONTRACT, 0, 300, NOW, vec![PromiseResult::Successful(vec![0; 257])]);
    rejects(|| { c.on_unclaimed_transfer_complete("2".into()); });
    ctx("kendinecrypto.near", 1, 300, NOW, vec![]);
    rejects(|| { drop(c.withdraw_unclaimed(USDC.parse().unwrap(), U128(1), "payer.near".parse().unwrap())); });
    assert_eq!(c.tokens[0].unclaimed_in_flight, 1_000_000); c.conservation();
}
#[test]
fn wrong_token_and_direct_expired_payment_are_rejected() {
    let mut c = setup(); let t = terms(8, false); create(&mut c, &t);
    ctx("fake.near", 0, 300, NOW, vec![]);
    rejects(|| { c.ft_on_transfer("intents.near".parse().unwrap(), U128(1_000_000), msg(&t)); });
    ctx(USDC, 0, 300, NOW + 2_000_000_000, vec![]);
    rejects(|| { c.ft_on_transfer("payer.near".parse().unwrap(), U128(1_000_000), msg(&t)); });
}

#[test]
fn direct_usdc_exact_only_callback_private_and_duplicate_is_not_a_second_payout() {
    let mut c = setup(); let t = terms(9, false); create(&mut c, &t);
    for amount in [999_999, 1_000_001] {
        ctx(USDC, 0, 300, NOW + 1, vec![]);
        rejects(|| { c.ft_on_transfer("payer.near".parse().unwrap(), U128(amount), msg(&t)); });
    }
    ctx(USDC, 0, 300, NOW + 1, vec![]);
    assert!(matches!(c.ft_on_transfer("payer.near".parse().unwrap(), U128(1_000_000), msg(&t)), PromiseOrValue::Value(U128(0))));
    ctx(USDC, 0, 300, NOW + 2, vec![]);
    rejects(|| { c.ft_on_transfer("other.near".parse().unwrap(), U128(1_000_000), msg(&t)); });
    ctx("attacker.near", 0, 300, NOW + 3, vec![PromiseResult::Successful(vec![])]);
    rejects(|| { c.on_native_transfer_complete(t.id.clone(), "1".into(), "INSTANT_PAYOUT".into()); });
    ctx(CONTRACT, 0, 300, NOW + 3, vec![PromiseResult::Successful(vec![])]);
    rejects(|| { c.on_native_transfer_complete(t.id.clone(), "2".into(), "INSTANT_PAYOUT".into()); });
    assert!(c.on_native_transfer_complete(t.id.clone(), "1".into(), "INSTANT_PAYOUT".into()));
    assert_eq!(load(&t.id).status, Status::Paid); c.conservation();
}

#[test]
fn missing_token_outcome_stays_in_flight_without_retry_or_false_paid() {
    let mut c = setup(); let t = terms(10, false); create(&mut c, &t);
    delivery(&mut c, 1_000_000, msg(&t), 250);
    ctx(CONTRACT, 0, 300, NOW + 3, vec![]);
    rejects(|| { c.on_native_transfer_complete(t.id.clone(), "1".into(), "INSTANT_PAYOUT".into()); });
    assert_eq!(load(&t.id).status, Status::InFlight);
    ctx("merchant.near", 1, 300, NOW + 4, vec![]);
    rejects(|| { drop(c.retry_native_transfer(t.id.clone(), "1".into())); });
    assert!(c.get_receipt(t.id.clone()).is_none()); c.conservation();
}

#[test]
fn router_cancelled_wrong_asset_wrong_payer_do_not_settle() {
    let mut c = setup(); let cancelled = terms(11, false); create(&mut c, &cancelled);
    ctx("merchant.near", 1, 300, NOW, vec![]); c.cancel_unfunded(cancelled.id.clone(), cancelled.terms_hash());
    delivery(&mut c, 1_000_000, msg(&cancelled), 250);
    let native = terms(12, true); create(&mut c, &native); delivery(&mut c, 1_000_000, msg(&native), 250);
    let mut restricted = terms(13, false); restricted.permitted_payer_account_id = Some("payer.near".parse().unwrap());
    create(&mut c, &restricted); delivery(&mut c, 1_000_000, msg(&restricted), 250);
    assert_eq!(c.tokens[0].unclaimed_held, 3_000_000); assert_eq!(c.tokens[0].in_flight, 0); c.conservation();
}

#[test]
fn bounded_message_fuzz_is_held_and_conserved() {
    let mut c = setup();
    // Deterministic hostile Unicode/control inputs. This is NOT an arbitrary-gas proof.
    for n in 0..128usize {
        let message: String = (0..n).map(|i| char::from_u32(((i * 7919 + n * 31) % 0xD800) as u32).unwrap()).collect();
        delivery(&mut c, (n + 1) as u128, message, 250);
        assert!(get_created_receipts().is_empty());
    }
    assert_eq!(c.tokens[0].received, c.tokens[0].unclaimed_held);
}
