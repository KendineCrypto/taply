//! Taply Gift unit tests. Numbers refer to the required test list in
//! docs/GIFT.md (1 creation/accounting ... 14 balance/storage invariants).
use super::*;
use ed25519_dalek::{Signer, SigningKey};
use near_sdk::mock::MockAction;
use near_sdk::test_utils::{VMContextBuilder, get_created_receipts};
use near_sdk::{PromiseResult, testing_env};
use std::panic::{AssertUnwindSafe, catch_unwind};

const GIFT_FEE: u128 = 10_000_000_000_000_000_000_000;
const MIN_AMOUNT: u128 = 10_000_000_000_000_000_000_000;
const MAX_AMOUNT: u128 = 2_000_000_000_000_000_000_000_000; // synthetic sandbox policy, NOT owner approval
const NOW: u64 = 1_794_000_000_000_000_000;
const SECOND: u64 = 1_000_000_000;
const HOUR: u64 = 3600;
const CONTRACT: &str = "gift.fixture.near";
const CREATOR: &str = "alice.near";
const BOB: &str = "bob.near";
const CAROL: &str = "carol.near";
const ONE_NEAR: u128 = 1_000_000_000_000_000_000_000_000;
const ID: &str = "0123456789abcdef0123456789abcdef";
/// The contract's own operating balance in the simulated runtime.
const BASE_BALANCE: u128 = ONE_NEAR / 10;

struct Env {
    balance: u128,
}

impl Env {
    fn new() -> Self {
        Self {
            balance: BASE_BALANCE,
        }
    }
    fn ctx(&self, caller: &str, deposit: u128, time: u64, results: Vec<PromiseResult>) {
        self.ctx_gas(caller, deposit, time, results, 100)
    }
    fn ctx_gas(
        &self,
        caller: &str,
        deposit: u128,
        time: u64,
        results: Vec<PromiseResult>,
        tgas: u64,
    ) {
        let mut b = VMContextBuilder::new();
        b.storage_usage(env::storage_usage());
        b.current_account_id(CONTRACT.parse().unwrap())
            .predecessor_account_id(caller.parse().unwrap())
            .signer_account_id(caller.parse().unwrap())
            .block_timestamp(time)
            .block_height(time / SECOND)
            // The runtime credits the attached deposit before the call runs.
            .account_balance(NearToken::from_yoctonear(self.balance + deposit))
            .attached_deposit(NearToken::from_yoctonear(deposit))
            .prepaid_gas(Gas::from_tgas(tgas));
        testing_env!(
            b.build(),
            near_sdk::test_vm_config(),
            near_sdk::RuntimeFeesConfig::test(),
            Default::default(),
            results
        );
    }
}

fn link_key() -> SigningKey {
    SigningKey::from_bytes(&[7u8; 32])
}
fn pk_hex(k: &SigningKey) -> String {
    hex(k.verifying_key().as_bytes())
}
fn sign_for(k: &SigningKey, contract: &str, id: &str, claimant: &str) -> String {
    let msg = claim_message(&contract.parse().unwrap(), id, &claimant.parse().unwrap());
    hex(&k.sign(msg.as_bytes()).to_bytes())
}
fn sig(id: &str, claimant: &str) -> String {
    sign_for(&link_key(), CONTRACT, id, claimant)
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
fn setup() -> (Env, Gifts) {
    let mut e = Env::new();
    e.ctx(CONTRACT, 0, NOW, vec![]);
    let c = Gifts::new("near-mainnet".into(), CONTRACT.parse().unwrap(), U128(MIN_AMOUNT), U128(MAX_AMOUNT), U128(GIFT_FEE));
    // The account pays for its own (mock) storage and keeps BASE_BALANCE spare.
    e.balance =
        env::storage_usage() as u128 * env::storage_byte_cost().as_yoctonear() + BASE_BALANCE;
    (e, c)
}
/// Creates a 1 NEAR, 1 hour gift with id `id` and returns the env with the deposit credited.
fn create(e: &mut Env, c: &mut Gifts, id: &str) -> GiftView {
    e.ctx(CREATOR, ONE_NEAR + GIFT_FEE, NOW, vec![]);
    let v = c.create_gift(
        id.into(),
        pk_hex(&link_key()),
        U128(ONE_NEAR),
        HOUR,
        "Happy birthday!".into(),
        2,
    );
    e.balance += ONE_NEAR + GIFT_FEE;
    v
}
fn acct(c: &Gifts, field: &str) -> u128 {
    c.get_accounting()[field].as_str().unwrap().parse().unwrap()
}
fn transfers() -> Vec<(String, u128)> {
    get_created_receipts()
        .into_iter()
        .flat_map(|r| {
            let to = r.receiver_id.to_string();
            r.actions.into_iter().filter_map(move |a| match a {
                MockAction::Transfer { deposit, .. } => Some((to.clone(), deposit.as_yoctonear())),
                _ => None,
            })
        })
        .collect()
}
fn callbacks() -> Vec<String> {
    get_created_receipts()
        .into_iter()
        .flat_map(|r| r.actions)
        .filter_map(|a| match a {
            MockAction::FunctionCallWeight {
                method_name, args, ..
            } => Some(format!(
                "{}:{}",
                String::from_utf8(method_name).unwrap(),
                String::from_utf8(args).unwrap()
            )),
            _ => None,
        })
        .collect()
}
fn claim(e: &mut Env, c: &mut Gifts, who: &str, time: u64) {
    e.ctx(who, 0, time, vec![]);
    c.claim_gift(ID.into(), sig(ID, who));
    // The transfer leaves the account when the receipt is created.
    e.balance -= ONE_NEAR;
}
fn callback(e: &Env, c: &mut Gifts, nonce: u32, result: PromiseResult) -> bool {
    e.ctx(CONTRACT, 0, NOW + 5 * SECOND, vec![result]);
    c.on_payout(ID.into(), nonce)
}
fn status(c: &Gifts) -> (String, Option<String>, Option<String>, Option<u32>) {
    let v = c.get_gift(ID.into()).unwrap();
    (
        v.status.to_string(),
        v.beneficiary.map(|a| a.to_string()),
        v.payout.map(str::to_string),
        v.payout_nonce,
    )
}
fn expiry() -> u64 {
    NOW + HOUR * SECOND
}

// ---------- 1. creation and accounting ----------

#[test]
fn t01_create_records_gift_and_accounting() {
    let (mut e, mut c) = setup();
    let v = create(&mut e, &mut c, ID);
    assert_eq!(v.status, "AVAILABLE");
    assert_eq!(v.creator.as_str(), CREATOR);
    assert_eq!(v.amount_yocto.0, ONE_NEAR);
    assert_eq!(v.message, "Happy birthday!");
    assert_eq!(v.design, 2);
    assert_eq!(v.expires_at_ns, expiry().to_string());
    assert_eq!(v.public_key, pk_hex(&link_key()));
    assert!(v.beneficiary.is_none() && v.payout.is_none());
    assert_eq!(acct(&c, "giftCount"), 1);
    assert_eq!(acct(&c, "depositedYocto"), ONE_NEAR);
    assert_eq!(acct(&c, "heldYocto"), ONE_NEAR);
    assert_eq!(acct(&c, "feesYocto"), GIFT_FEE);
    assert_eq!(acct(&c, "inFlightYocto"), 0);
    assert!(transfers().is_empty(), "creation never sends money");
    e.ctx(BOB, 0, NOW, vec![]);
    assert_eq!(c.get_gift(ID.into()).unwrap().status, "AVAILABLE");
}

#[test]
fn t01_create_input_validation() {
    let (e, mut c) = setup();
    let pk = pk_hex(&link_key());
    let try_create =
        |c: &mut Gifts, amount: u128, deposit: u128, life: u64, msg: &str, design: u8| {
            e.ctx(CREATOR, deposit, NOW, vec![]);
            c.create_gift(
                ID.into(),
                pk.clone(),
                U128(amount),
                life,
                msg.into(),
                design,
            );
        };
    rejects_with("AMOUNT_OUT_OF_RANGE", || {
        try_create(
            &mut c,
            MIN_AMOUNT - 1,
            MIN_AMOUNT - 1 + GIFT_FEE,
            HOUR,
            "",
            0,
        )
    });
    rejects_with("AMOUNT_OUT_OF_RANGE", || {
        try_create(
            &mut c,
            MAX_AMOUNT + 1,
            MAX_AMOUNT + 1 + GIFT_FEE,
            HOUR,
            "",
            0,
        )
    });
    rejects_with("LIFETIME_OUT_OF_RANGE", || {
        try_create(
            &mut c,
            ONE_NEAR,
            ONE_NEAR + GIFT_FEE,
            MIN_LIFETIME_S - 1,
            "",
            0,
        )
    });
    rejects_with("LIFETIME_OUT_OF_RANGE", || {
        try_create(
            &mut c,
            ONE_NEAR,
            ONE_NEAR + GIFT_FEE,
            MAX_LIFETIME_S + 1,
            "",
            0,
        )
    });
    rejects_with("LIFETIME_OUT_OF_RANGE", || {
        try_create(&mut c, ONE_NEAR, ONE_NEAR + GIFT_FEE, u64::MAX, "", 0)
    });
    rejects_with("MESSAGE_TOO_LONG", || {
        try_create(
            &mut c,
            ONE_NEAR,
            ONE_NEAR + GIFT_FEE,
            HOUR,
            &"x".repeat(281),
            0,
        )
    });
    rejects_with("MESSAGE_TOO_LONG", || {
        try_create(
            &mut c,
            ONE_NEAR,
            ONE_NEAR + GIFT_FEE,
            HOUR,
            &"🎁".repeat(71),
            0,
        )
    });
    rejects_with("MESSAGE_INVALID", || {
        try_create(&mut c, ONE_NEAR, ONE_NEAR + GIFT_FEE, HOUR, "hi\u{0007}", 0)
    });
    rejects_with("MESSAGE_INVALID", || {
        try_create(
            &mut c,
            ONE_NEAR,
            ONE_NEAR + GIFT_FEE,
            HOUR,
            "a\u{200B}\u{0000}",
            0,
        )
    });
    rejects_with("DESIGN_INVALID", || {
        try_create(
            &mut c,
            ONE_NEAR,
            ONE_NEAR + GIFT_FEE,
            HOUR,
            "",
            MAX_DESIGN + 1,
        )
    });
    e.ctx(CREATOR, ONE_NEAR + GIFT_FEE, NOW, vec![]);
    rejects_with("INVALID_PUBLIC_KEY", || {
        c.create_gift(ID.into(), "ab".into(), U128(ONE_NEAR), HOUR, "".into(), 0);
    });
    rejects_with("INVALID_HEX", || {
        c.create_gift(
            ID.into(),
            "Z".repeat(64),
            U128(ONE_NEAR),
            HOUR,
            "".into(),
            0,
        );
    });
    // Boundaries are accepted: 280 bytes with a newline, min amount, min lifetime.
    e.ctx(CREATOR, MIN_AMOUNT + GIFT_FEE, NOW, vec![]);
    let msg = format!("line one\n{}", "y".repeat(271));
    assert_eq!(msg.len(), 280);
    c.create_gift(
        ID.into(),
        pk.clone(),
        U128(MIN_AMOUNT),
        MIN_LIFETIME_S,
        msg,
        MAX_DESIGN,
    );
    assert_eq!(acct(&c, "giftCount"), 1);
}

#[test]
fn t01_duplicate_gift_id_refused() {
    let (mut e, mut c) = setup();
    create(&mut e, &mut c, ID);
    rejects_with("GIFT_ID_TAKEN", || {
        create(&mut e, &mut c, ID);
    });
    assert_eq!(acct(&c, "giftCount"), 1);
}

// ---------- 2. first successful claim ----------

#[test]
fn t02_first_claim_pays_signed_claimant_then_confirms() {
    let (mut e, mut c) = setup();
    create(&mut e, &mut c, ID);
    claim(&mut e, &mut c, BOB, NOW + 60 * SECOND);
    assert_eq!(transfers(), vec![(BOB.to_string(), ONE_NEAR)]);
    let cb = callbacks();
    assert_eq!(cb.len(), 1);
    assert!(cb[0].starts_with("on_payout:") && cb[0].contains(ID) && cb[0].contains("\"nonce\":1"));
    assert_eq!(
        status(&c),
        (
            "CLAIMED".into(),
            Some(BOB.into()),
            Some("PENDING".into()),
            Some(1)
        )
    );
    assert_eq!(acct(&c, "heldYocto"), 0);
    assert_eq!(acct(&c, "inFlightYocto"), ONE_NEAR);
    assert!(callback(&e, &mut c, 1, PromiseResult::Successful(vec![])));
    assert_eq!(
        status(&c),
        (
            "CLAIMED".into(),
            Some(BOB.into()),
            Some("CONFIRMED".into()),
            Some(1)
        )
    );
    assert_eq!(acct(&c, "inFlightYocto"), 0);
    assert_eq!(acct(&c, "claimedPaidYocto"), ONE_NEAR);
    assert!(transfers().is_empty(), "callback never transfers");
}

#[test]
fn t02_claim_guards() {
    let (mut e, mut c) = setup();
    create(&mut e, &mut c, ID);
    e.ctx(CREATOR, 0, NOW, vec![]);
    rejects_with("CREATOR_CANNOT_CLAIM", || {
        c.claim_gift(ID.into(), sig(ID, CREATOR))
    });
    e.ctx(BOB, 1, NOW, vec![]);
    rejects_with("NO_DEPOSIT_ALLOWED", || {
        c.claim_gift(ID.into(), sig(ID, BOB))
    });
    e.ctx_gas(BOB, 0, NOW, vec![], 20);
    rejects_with("NOT_ENOUGH_GAS", || c.claim_gift(ID.into(), sig(ID, BOB)));
    e.ctx(BOB, 0, NOW, vec![]);
    rejects_with("GIFT_NOT_FOUND", || {
        c.claim_gift("f".repeat(32), sig(&"f".repeat(32), BOB))
    });
    assert_eq!(status(&c).0, "AVAILABLE");
}

// ---------- 3. two competing claims ----------

#[test]
fn t03_second_competing_claim_is_refused() {
    let (mut e, mut c) = setup();
    create(&mut e, &mut c, ID);
    claim(&mut e, &mut c, BOB, NOW + SECOND);
    // Carol holds the same link and a valid signature for her own account,
    // in the very next receipt (even before Bob's callback ran).
    e.ctx(CAROL, 0, NOW + SECOND, vec![]);
    rejects_with("ALREADY_SETTLED", || {
        c.claim_gift(ID.into(), sig(ID, CAROL))
    });
    callback(&e, &mut c, 1, PromiseResult::Successful(vec![]));
    e.ctx(CAROL, 0, NOW + 2 * SECOND, vec![]);
    rejects_with("ALREADY_SETTLED", || {
        c.claim_gift(ID.into(), sig(ID, CAROL))
    });
    assert_eq!(status(&c).1.as_deref(), Some(BOB));
    assert_eq!(acct(&c, "claimedPaidYocto"), ONE_NEAR);
}

// ---------- 4. repeated claim by the same account ----------

#[test]
fn t04_repeated_claim_same_account_refused() {
    let (mut e, mut c) = setup();
    create(&mut e, &mut c, ID);
    claim(&mut e, &mut c, BOB, NOW);
    e.ctx(BOB, 0, NOW, vec![]);
    rejects_with("ALREADY_SETTLED", || c.claim_gift(ID.into(), sig(ID, BOB)));
    callback(&e, &mut c, 1, PromiseResult::Successful(vec![]));
    e.ctx(BOB, 0, NOW + SECOND, vec![]);
    rejects_with("ALREADY_SETTLED", || c.claim_gift(ID.into(), sig(ID, BOB)));
}

// ---------- 5. claim after expiry ----------

#[test]
fn t05_claim_at_or_after_expiry_refused() {
    let (mut e, mut c) = setup();
    create(&mut e, &mut c, ID);
    e.ctx(BOB, 0, expiry(), vec![]);
    rejects_with("GIFT_EXPIRED", || c.claim_gift(ID.into(), sig(ID, BOB)));
    assert_eq!(c.get_gift(ID.into()).unwrap().status, "EXPIRED");
    e.ctx(BOB, 0, expiry() + 10 * HOUR * SECOND, vec![]);
    rejects_with("GIFT_EXPIRED", || c.claim_gift(ID.into(), sig(ID, BOB)));
    assert_eq!(acct(&c, "heldYocto"), ONE_NEAR);
}

// ---------- 6. refund before expiry ----------

#[test]
fn t06_refund_before_expiry_refused() {
    let (mut e, mut c) = setup();
    create(&mut e, &mut c, ID);
    e.ctx(CREATOR, 0, expiry() - 1, vec![]);
    rejects_with("NOT_EXPIRED", || c.refund_gift(ID.into()));
    assert!(transfers().is_empty());
    assert_eq!(status(&c).0, "AVAILABLE");
}

// ---------- 7. refund after expiry ----------

#[test]
fn t07_refund_after_expiry_creator_only() {
    let (mut e, mut c) = setup();
    create(&mut e, &mut c, ID);
    e.ctx(BOB, 0, expiry(), vec![]);
    rejects_with("CREATOR_ONLY", || c.refund_gift(ID.into()));
    e.ctx(CREATOR, 1, expiry(), vec![]);
    rejects_with("NO_DEPOSIT_ALLOWED", || c.refund_gift(ID.into()));
    e.ctx(CREATOR, 0, expiry(), vec![]);
    c.refund_gift(ID.into());
    e.balance -= ONE_NEAR;
    assert_eq!(transfers(), vec![(CREATOR.to_string(), ONE_NEAR)]);
    assert_eq!(
        status(&c),
        (
            "REFUNDED".into(),
            Some(CREATOR.into()),
            Some("PENDING".into()),
            Some(1)
        )
    );
    callback(&e, &mut c, 1, PromiseResult::Successful(vec![]));
    assert_eq!(status(&c).2.as_deref(), Some("CONFIRMED"));
    assert_eq!(acct(&c, "refundedYocto"), ONE_NEAR);
    assert_eq!(acct(&c, "claimedPaidYocto"), 0);
    e.ctx(CREATOR, 0, expiry() + SECOND, vec![]);
    rejects_with("ALREADY_SETTLED", || c.refund_gift(ID.into()));
}

// ---------- 8. claim / refund race ----------

#[test]
fn t08_claim_and_refund_windows_never_overlap() {
    // One nanosecond before expiry: claim wins, refund is refused.
    let (mut e, mut c) = setup();
    create(&mut e, &mut c, ID);
    e.ctx(CREATOR, 0, expiry() - 1, vec![]);
    rejects_with("NOT_EXPIRED", || c.refund_gift(ID.into()));
    claim(&mut e, &mut c, BOB, expiry() - 1);
    // After the claim, even after expiry, the creator cannot refund.
    e.ctx(CREATOR, 0, expiry() + SECOND, vec![]);
    rejects_with("ALREADY_SETTLED", || c.refund_gift(ID.into()));
    callback(&e, &mut c, 1, PromiseResult::Successful(vec![]));
    e.ctx(CREATOR, 0, expiry() + SECOND, vec![]);
    rejects_with("ALREADY_SETTLED", || c.refund_gift(ID.into()));
}

#[test]
fn t08_at_exact_expiry_refund_wins_and_claim_stays_refused() {
    let (mut e, mut c) = setup();
    create(&mut e, &mut c, ID);
    e.ctx(BOB, 0, expiry(), vec![]);
    rejects_with("GIFT_EXPIRED", || c.claim_gift(ID.into(), sig(ID, BOB)));
    e.ctx(CREATOR, 0, expiry(), vec![]);
    c.refund_gift(ID.into());
    e.ctx(BOB, 0, expiry(), vec![]);
    rejects_with("ALREADY_SETTLED", || c.claim_gift(ID.into(), sig(ID, BOB)));
}

// ---------- 9. transfer failure ----------

#[test]
fn t09_recorded_failure_retry_only_by_beneficiary_to_itself() {
    let (mut e, mut c) = setup();
    create(&mut e, &mut c, ID);
    claim(&mut e, &mut c, BOB, NOW);
    assert!(!callback(&e, &mut c, 1, PromiseResult::Failed));
    // The failed transfer's deposit came back to the contract.
    e.balance += ONE_NEAR;
    assert_eq!(
        status(&c),
        (
            "CLAIMED".into(),
            Some(BOB.into()),
            Some("FAILED".into()),
            Some(1)
        )
    );
    assert_eq!(acct(&c, "failedHeldYocto"), ONE_NEAR);
    assert_eq!(acct(&c, "inFlightYocto"), 0);
    // A failed claim never reopens the gift or lets the creator take it.
    e.ctx(CAROL, 0, NOW, vec![]);
    rejects_with("ALREADY_SETTLED", || {
        c.claim_gift(ID.into(), sig(ID, CAROL))
    });
    e.ctx(CREATOR, 0, expiry() + SECOND, vec![]);
    rejects_with("ALREADY_SETTLED", || c.refund_gift(ID.into()));
    e.ctx(CAROL, 0, NOW, vec![]);
    rejects_with("BENEFICIARY_ONLY", || c.retry_payout(ID.into()));
    e.ctx(CREATOR, 0, NOW, vec![]);
    rejects_with("BENEFICIARY_ONLY", || c.retry_payout(ID.into()));
    e.ctx(BOB, 0, NOW, vec![]);
    c.retry_payout(ID.into());
    e.balance -= ONE_NEAR;
    assert_eq!(transfers(), vec![(BOB.to_string(), ONE_NEAR)]);
    assert_eq!(
        status(&c),
        (
            "CLAIMED".into(),
            Some(BOB.into()),
            Some("PENDING".into()),
            Some(2)
        )
    );
    // The old nonce's callback is stale; the new one settles.
    e.ctx(CONTRACT, 0, NOW, vec![PromiseResult::Successful(vec![])]);
    rejects_with("STALE_CALLBACK", || {
        c.on_payout(ID.into(), 1);
    });
    assert!(callback(&e, &mut c, 2, PromiseResult::Successful(vec![])));
    assert_eq!(status(&c).2.as_deref(), Some("CONFIRMED"));
    assert_eq!(acct(&c, "claimedPaidYocto"), ONE_NEAR);
    assert_eq!(acct(&c, "failedHeldYocto"), 0);
}

#[test]
fn t09_retry_waits_for_returned_funds() {
    let (mut e, mut c) = setup();
    create(&mut e, &mut c, ID);
    claim(&mut e, &mut c, BOB, NOW);
    callback(&e, &mut c, 1, PromiseResult::Failed);
    // The refund receipt of the failed transfer has not landed yet: the
    // contract would have to spend reserved money, so it refuses.
    e.ctx(BOB, 0, NOW, vec![]);
    rejects_with("INSUFFICIENT_LIQUIDITY", || c.retry_payout(ID.into()));
    assert_eq!(status(&c).2.as_deref(), Some("FAILED"));
}

// ---------- 10. unknown callback outcome ----------

#[test]
fn t10_unknown_outcome_is_never_repaid() {
    let (mut e, mut c) = setup();
    create(&mut e, &mut c, ID);
    claim(&mut e, &mut c, BOB, NOW);
    // Callback could not decide: no result, or an unexpected result payload.
    e.ctx(CONTRACT, 0, NOW, vec![]);
    rejects_with("UNKNOWN_PROMISE_RESULT", || {
        c.on_payout(ID.into(), 1);
    });
    e.ctx(
        CONTRACT,
        0,
        NOW,
        vec![PromiseResult::Successful(vec![1, 2, 3])],
    );
    rejects_with("UNKNOWN_PROMISE_RESULT", || {
        c.on_payout(ID.into(), 1);
    });
    // Stays PENDING: no retry, no refund, no second claim, no transfer.
    assert_eq!(
        status(&c),
        (
            "CLAIMED".into(),
            Some(BOB.into()),
            Some("PENDING".into()),
            Some(1)
        )
    );
    e.ctx(BOB, 0, NOW, vec![]);
    rejects_with("PAYOUT_NOT_FAILED", || c.retry_payout(ID.into()));
    e.ctx(CREATOR, 0, expiry() + SECOND, vec![]);
    rejects_with("ALREADY_SETTLED", || c.refund_gift(ID.into()));
    e.ctx(CAROL, 0, NOW, vec![]);
    rejects_with("ALREADY_SETTLED", || {
        c.claim_gift(ID.into(), sig(ID, CAROL))
    });
    assert!(transfers().is_empty());
    assert_eq!(acct(&c, "inFlightYocto"), ONE_NEAR);
    assert_eq!(
        acct(&c, "claimedPaidYocto"),
        0,
        "unknown is not counted as paid"
    );
}

// ---------- 11. attempted double payout ----------

#[test]
fn t11_double_payout_attempts_refused() {
    let (mut e, mut c) = setup();
    create(&mut e, &mut c, ID);
    claim(&mut e, &mut c, BOB, NOW);
    // Only the contract itself may deliver the callback.
    e.ctx(BOB, 0, NOW, vec![PromiseResult::Failed]);
    rejects_with("PRIVATE_CALLBACK", || {
        c.on_payout(ID.into(), 1);
    });
    callback(&e, &mut c, 1, PromiseResult::Successful(vec![]));
    // A replayed callback (success or failure) cannot change a confirmed payout.
    e.ctx(CONTRACT, 0, NOW, vec![PromiseResult::Failed]);
    rejects_with("STALE_CALLBACK", || {
        c.on_payout(ID.into(), 1);
    });
    e.ctx(CONTRACT, 0, NOW, vec![PromiseResult::Successful(vec![])]);
    rejects_with("STALE_CALLBACK", || {
        c.on_payout(ID.into(), 2);
    });
    e.ctx(BOB, 0, NOW, vec![]);
    rejects_with("PAYOUT_NOT_FAILED", || c.retry_payout(ID.into()));
    e.ctx(CONTRACT, 0, NOW, vec![PromiseResult::Successful(vec![])]);
    rejects_with("GIFT_NOT_FOUND", || {
        c.on_payout("f".repeat(32), 1);
    });
    assert_eq!(acct(&c, "claimedPaidYocto"), ONE_NEAR);
    assert_eq!(acct(&c, "depositedYocto"), ONE_NEAR);
    // An available gift has no payout to retry.
    create(&mut e, &mut c, &"a".repeat(32));
    e.ctx(CREATOR, 0, NOW, vec![]);
    rejects_with("NOT_SETTLED", || c.retry_payout("a".repeat(32)));
}

// ---------- 12. malicious or malformed gift ids and signatures ----------

#[test]
fn t12_malformed_ids_and_forged_signatures() {
    let (mut e, mut c) = setup();
    create(&mut e, &mut c, ID);
    let bad_ids = [
        "".to_string(),
        "0123456789ABCDEF0123456789ABCDEF".to_string(),
        "0123456789abcdef0123456789abcde".to_string(),
        "0123456789abcdef0123456789abcdef0".to_string(),
        "../../g:0123456789abcdef01234567".to_string(),
        "0123456789abcdef0123456789abcdeg".to_string(),
        "0123456789abcdef0123456789abcdé".to_string(),
        " 0123456789abcdef0123456789abcde".to_string(),
    ];
    for id in &bad_ids {
        e.ctx(BOB, 0, NOW, vec![]);
        assert!(c.get_gift(id.clone()).is_none());
        rejects_with("INVALID_GIFT_ID", || c.claim_gift(id.clone(), sig(ID, BOB)));
        e.ctx(CREATOR, 0, expiry(), vec![]);
        rejects_with("INVALID_GIFT_ID", || c.refund_gift(id.clone()));
        rejects_with("INVALID_GIFT_ID", || c.retry_payout(id.clone()));
        e.ctx(CREATOR, ONE_NEAR + GIFT_FEE, NOW, vec![]);
        rejects_with("INVALID_GIFT_ID", || {
            c.create_gift(
                id.clone(),
                pk_hex(&link_key()),
                U128(ONE_NEAR),
                HOUR,
                "".into(),
                0,
            );
        });
    }
    e.ctx(BOB, 0, NOW, vec![]);
    // Signature replayed from another claimant, another gift, another contract, another key.
    rejects_with("BAD_CLAIM_SIGNATURE", || {
        c.claim_gift(ID.into(), sig(ID, CAROL))
    });
    rejects_with("BAD_CLAIM_SIGNATURE", || {
        c.claim_gift(ID.into(), sig(&"b".repeat(32), BOB))
    });
    rejects_with("BAD_CLAIM_SIGNATURE", || {
        c.claim_gift(ID.into(), sign_for(&link_key(), "other.near", ID, BOB))
    });
    let other = SigningKey::from_bytes(&[9u8; 32]);
    rejects_with("BAD_CLAIM_SIGNATURE", || {
        c.claim_gift(ID.into(), sign_for(&other, CONTRACT, ID, BOB))
    });
    rejects_with("INVALID_SIGNATURE", || c.claim_gift(ID.into(), "00".into()));
    rejects_with("INVALID_HEX", || c.claim_gift(ID.into(), "X".repeat(128)));
    let mut flipped = sig(ID, BOB).into_bytes();
    flipped[0] = if flipped[0] == b'0' { b'1' } else { b'0' };
    rejects_with("BAD_CLAIM_SIGNATURE", || {
        c.claim_gift(ID.into(), String::from_utf8(flipped).unwrap())
    });
    assert_eq!(status(&c).0, "AVAILABLE");
    assert!(transfers().is_empty());
}

// ---------- 13. wrong amount or insufficient deposit ----------

#[test]
fn t13_deposit_must_be_exactly_amount_plus_fee() {
    let (e, mut c) = setup();
    let pk = pk_hex(&link_key());
    for deposit in [
        0,
        ONE_NEAR,
        ONE_NEAR + GIFT_FEE - 1,
        ONE_NEAR + GIFT_FEE + 1,
        2 * ONE_NEAR,
    ] {
        e.ctx(CREATOR, deposit, NOW, vec![]);
        rejects_with("WRONG_DEPOSIT", || {
            c.create_gift(ID.into(), pk.clone(), U128(ONE_NEAR), HOUR, "".into(), 0);
        });
    }
    assert_eq!(acct(&c, "giftCount"), 0);
    assert_eq!(acct(&c, "depositedYocto"), 0);
}

// ---------- 14. balance and storage invariants ----------

#[test]
fn t14_fee_covers_worst_case_storage_and_callbacks_never_grow() {
    let (mut e, mut c) = setup();
    let long_creator = format!("{}.near", "c".repeat(56));
    let long_claimant = format!("{}.near", "d".repeat(56));
    assert_eq!(long_claimant.len(), 64);
    let before = env::storage_usage();
    e.ctx(&long_creator, ONE_NEAR + GIFT_FEE, NOW, vec![]);
    c.create_gift(
        ID.into(),
        pk_hex(&link_key()),
        U128(ONE_NEAR),
        HOUR,
        "🎁".repeat(70),
        MAX_DESIGN,
    );
    e.balance += ONE_NEAR + GIFT_FEE;
    claim(&mut e, &mut c, &long_claimant, NOW);
    let after_claim = env::storage_usage();
    let used = after_claim - before;
    assert!(
        (used as u128) * env::storage_byte_cost().as_yoctonear() <= GIFT_FEE,
        "worst-case record {used} bytes must be covered by the fee"
    );
    callback(&e, &mut c, 1, PromiseResult::Failed);
    e.balance += ONE_NEAR;
    assert_eq!(
        env::storage_usage(),
        after_claim,
        "callback must not grow storage"
    );
    e.ctx(&long_claimant, 0, NOW, vec![]);
    c.retry_payout(ID.into());
    assert_eq!(
        env::storage_usage(),
        after_claim,
        "retry must not grow storage"
    );
    println!("MEASURE worst-case gift record incl. settlement: {used} bytes");
}

#[test]
fn t14_conservation_and_liquidity_across_many_gifts() {
    let (mut e, mut c) = setup();
    let ids: Vec<String> = (0..6).map(|i| format!("{i:032x}")).collect();
    for id in &ids {
        create(&mut e, &mut c, id);
    }
    let pk = link_key();
    // 0: claimed+confirmed, 1: claimed+failed, 2: claimed+unknown, 3: refunded, 4,5: held
    for (i, who) in [(0, BOB), (1, CAROL), (2, BOB)] {
        e.ctx(who, 0, NOW, vec![]);
        c.claim_gift(ids[i].clone(), sign_for(&pk, CONTRACT, &ids[i], who));
        e.balance -= ONE_NEAR;
    }
    e.ctx(CONTRACT, 0, NOW, vec![PromiseResult::Successful(vec![])]);
    c.on_payout(ids[0].clone(), 1);
    e.ctx(CONTRACT, 0, NOW, vec![PromiseResult::Failed]);
    c.on_payout(ids[1].clone(), 1);
    e.balance += ONE_NEAR;
    e.ctx(CREATOR, 0, expiry(), vec![]);
    c.refund_gift(ids[3].clone());
    e.balance -= ONE_NEAR;
    let a = |f: &str| acct(&c, f);
    assert_eq!(a("depositedYocto"), 6 * ONE_NEAR);
    assert_eq!(a("heldYocto"), 2 * ONE_NEAR);
    assert_eq!(a("claimedPaidYocto"), ONE_NEAR);
    assert_eq!(a("failedHeldYocto"), ONE_NEAR);
    assert_eq!(a("inFlightYocto"), 2 * ONE_NEAR);
    assert_eq!(
        a("depositedYocto"),
        a("heldYocto")
            + a("inFlightYocto")
            + a("failedHeldYocto")
            + a("claimedPaidYocto")
            + a("refundedYocto")
    );
    // The simulated balance still covers storage + held + failed obligations.
    let required = env::storage_usage() as u128 * env::storage_byte_cost().as_yoctonear()
        + a("heldYocto")
        + a("failedHeldYocto");
    assert!(e.balance >= required);
    // A contract that somehow lost funds refuses to pay out reserved money.
    let mut starving = Env {
        balance: required - 1 + ONE_NEAR,
    };
    starving.balance -= 2 * ONE_NEAR; // pretend 2 NEAR are missing
    starving.ctx(BOB, 0, NOW, vec![]);
    rejects_with("INSUFFICIENT_LIQUIDITY", || {
        c.claim_gift(ids[4].clone(), sign_for(&pk, CONTRACT, &ids[4], BOB))
    });
    assert_eq!(c.get_gift(ids[4].clone()).unwrap().status, "AVAILABLE");
}

#[test]
fn t14_no_admin_surface() {
    // The ABI has no owner, no withdraw, no upgrade: only these mutating methods.
    let src = include_str!("lib.rs");
    let methods: Vec<&str> = src
        .lines()
        .filter_map(|l| l.trim().strip_prefix("pub fn "))
        .map(|l| l.split('(').next().unwrap())
        .collect();
    for forbidden in [
        "withdraw",
        "set_owner",
        "upgrade",
        "migrate",
        "drain",
        "admin",
    ] {
        assert!(
            !methods.iter().any(|m| m.contains(forbidden)),
            "{forbidden} must not exist"
        );
    }
    assert!(methods.contains(&"claim_gift") && methods.contains(&"refund_gift"));
}

#[test]
fn init_only_once() {
    let (e, _c) = setup();
    e.ctx(CONTRACT, 0, NOW, vec![]);
    near_sdk::env::state_write(&Gifts::new("near-mainnet".into(), CONTRACT.parse().unwrap(), U128(MIN_AMOUNT), U128(MAX_AMOUNT), U128(GIFT_FEE)));
    rejects_with("ALREADY_INITIALIZED", || {
        let _ = Gifts::new("near-mainnet".into(), CONTRACT.parse().unwrap(), U128(MIN_AMOUNT), U128(MAX_AMOUNT), U128(GIFT_FEE));
    });
}

/// Cross-implementation vector: produced by the web client's Web Crypto signer
/// (packages/near-client/src/gift.ts, seed = [7; 32]); must verify on chain.
#[test]
fn web_crypto_signature_vector_verifies() {
    let (mut e, mut c) = setup();
    assert_eq!(
        pk_hex(&link_key()),
        "ea4a6c63e29c520abef5507b132ec5f9954776aebebe7b92421eea691446d22c"
    );
    let web = "f785fc6e9542641187fd9a1717a018637af8252a6e6e74dbcc16388a6616c42ad61aba14f66e87c6c80fb96288ae1053cdf8cec0253c4ade689033a1e1c42e05";
    assert_eq!(
        sig(ID, BOB),
        web,
        "ed25519 is deterministic: dalek == Web Crypto"
    );
    create(&mut e, &mut c, ID);
    e.ctx(BOB, 0, NOW, vec![]);
    c.claim_gift(ID.into(), web.into());
    assert_eq!(status(&c).1.as_deref(), Some(BOB));
}

#[test]
fn explicit_mainnet_configuration_and_limits_are_required() {
    let e = Env::new();
    e.ctx(CONTRACT, 0, NOW, vec![]);
    rejects_with("WRONG_NETWORK", || {
        Gifts::new("near-testnet".into(), CONTRACT.parse().unwrap(), U128(1), U128(2), U128(1));
    });
    rejects_with("WRONG_CONTRACT", || {
        Gifts::new("near-mainnet".into(), "other.near".parse().unwrap(), U128(1), U128(2), U128(1));
    });
    for (min, max, fee) in [(0, 1, 1), (2, 1, 1), (1, 2, 0), (1, u128::MAX, 1)] {
        rejects_with("INVALID_LIMITS", || {
            Gifts::new("near-mainnet".into(), CONTRACT.parse().unwrap(), U128(min), U128(max), U128(fee));
        });
    }
    e.ctx(BOB, 0, NOW, vec![]);
    rejects_with("PRIVATE_INIT", || {
        Gifts::new("near-mainnet".into(), CONTRACT.parse().unwrap(), U128(1), U128(2), U128(1));
    });
}

#[test]
fn testnet_claim_domain_cannot_claim_mainnet_gift() {
    let (mut e, mut c) = setup();
    create(&mut e, &mut c, ID);
    let foreign = hex(&link_key().sign(format!("taply-gift-claim:v1:{CONTRACT}:{ID}:{BOB}").as_bytes()).to_bytes());
    e.ctx(BOB, 0, NOW, vec![]);
    rejects_with("BAD_CLAIM_SIGNATURE", || c.claim_gift(ID.into(), foreign));
}
