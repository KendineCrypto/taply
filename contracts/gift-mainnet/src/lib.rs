//! Taply Gift — isolated NEAR Mainnet candidate contract for claimable NEAR gifts.
//!
//! NOT REVIEWED, NOT FOR REAL FUNDS. Native NEAR only. No owner, no admin,
//! no upgrade method, no withdrawal of anything that is not a gift's own
//! principal to that gift's own beneficiary.
//!
//! Design (see README.md and docs/GIFT.md):
//!  - The creator deposits EXACTLY `amount + GIFT_FEE` with a random 128-bit
//!    gift id and the 32-byte ed25519 public key of a one-off "link key".
//!    The link key's secret lives only in the share URL fragment.
//!  - `claim_gift` must carry an ed25519 signature by the link key over
//!    `taply-gift-claim:near-mainnet:v1:<contract>:<gift id>:<claimant>`. The claimant is
//!    always the predecessor, so a signature seen on chain cannot be replayed
//!    for another account and the payout destination cannot be substituted.
//!  - The FIRST accepted claim flips the record AVAILABLE -> CLAIMED in the same
//!    receipt that schedules the transfer (debit first). Every later claim fails
//!    with ALREADY_SETTLED. Same-contract receipts execute sequentially, so there
//!    is exactly one winner.
//!  - Payout goes only to the account that signed the claim (pull pattern,
//!    "design B" in docs/R2_REACHABILITY.md). A private callback records the
//!    transfer result as PENDING -> CONFIRMED or FAILED. It never sends money.
//!    If the callback itself cannot run, the payout stays PENDING forever and is
//!    NEVER re-sent automatically: unknown is not success and not failure.
//!  - Only a CONFIRMED failure (the funds provably came back) can be retried, by
//!    the same beneficiary, to itself.
//!  - Before expiry only a claim is possible; at or after expiry only the creator
//!    can refund. There is no window in which claim and refund race.
#![allow(clippy::too_many_arguments)]

use near_sdk::borsh;
use near_sdk::json_types::U128;
use near_sdk::serde::Serialize;
use near_sdk::serde_json::json;
use near_sdk::{
    AccountId, Gas, NearToken, PanicOnDefault, Promise, PromiseError, env, near, require,
};

/// Non-refundable per-gift record fee. Covers the record (checked at creation,
/// including the growth a claim adds) so gifts never spend each other's principal.
pub const MIN_LIFETIME_S: u64 = 600; // 10 minutes
pub const MAX_LIFETIME_S: u64 = 30 * 24 * 3600; // 30 days
pub const MAX_MESSAGE_BYTES: usize = 280;
pub const MAX_DESIGN: u8 = 7;
pub const CLAIM_DOMAIN: &str = "taply-gift-claim:near-mainnet:v1";
pub const REVIEW_STATUS: &str = "UNREVIEWED_NOT_FOR_REAL_FUNDS";
const CALLBACK_GAS: Gas = Gas::from_tgas(10);
/// Minimum prepaid gas for claim/refund/retry: the call itself + transfer + callback.
const MIN_SETTLE_GAS: Gas = Gas::from_tgas(30);
/// Worst-case growth when AVAILABLE becomes CLAIMED/REFUNDED (longest account id).
const MAX_SETTLEMENT_GROWTH: u64 = 4 + 64 + 8 + 8 + 1 + 4;

#[near(serializers = [borsh])]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Payout {
    Pending,
    Confirmed,
    Failed,
}

#[near(serializers = [borsh])]
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct Settlement {
    pub beneficiary: AccountId,
    pub at_ns: u64,
    pub height: u64,
    pub payout: Payout,
    pub nonce: u32,
}

#[near(serializers = [borsh])]
#[derive(Clone, PartialEq, Eq, Debug)]
pub enum Outcome {
    Available,
    Claimed(Settlement),
    Refunded(Settlement),
}

#[near(serializers = [borsh])]
#[derive(Clone, Debug)]
pub struct Gift {
    pub creator: AccountId,
    pub amount: u128,
    pub public_key: [u8; 32],
    pub message: String,
    pub design: u8,
    pub created_at_ns: u64,
    pub created_height: u64,
    pub expires_at_ns: u64,
    pub outcome: Outcome,
}

impl Gift {
    fn settlement(&self) -> Option<&Settlement> {
        match &self.outcome {
            Outcome::Available => None,
            Outcome::Claimed(s) | Outcome::Refunded(s) => Some(s),
        }
    }
    fn settlement_mut(&mut self) -> Option<&mut Settlement> {
        match &mut self.outcome {
            Outcome::Available => None,
            Outcome::Claimed(s) | Outcome::Refunded(s) => Some(s),
        }
    }
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde", rename_all = "camelCase")]
pub struct GiftView {
    pub id: String,
    pub creator: AccountId,
    pub amount_yocto: U128,
    pub public_key: String,
    pub message: String,
    pub design: u8,
    pub created_at_ns: String,
    pub created_height: String,
    pub expires_at_ns: String,
    /// AVAILABLE | EXPIRED (derived from the view block's time) | CLAIMED | REFUNDED
    pub status: &'static str,
    pub beneficiary: Option<AccountId>,
    pub settled_at_ns: Option<String>,
    pub settled_height: Option<String>,
    /// PENDING | CONFIRMED | FAILED (only once CLAIMED or REFUNDED)
    pub payout: Option<&'static str>,
    pub payout_nonce: Option<u32>,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Gifts {
    min_amount: u128,
    max_amount: u128,
    fee: u128,
    gift_count: u64,
    /// Every principal ever accepted.
    deposited: u128,
    /// Principal of AVAILABLE gifts (owed to a future claimant or the creator).
    held: u128,
    /// Principal whose transfer was scheduled and whose result is not recorded yet.
    in_flight: u128,
    /// Principal whose transfer provably failed (back in this account, owed to the beneficiary).
    failed_held: u128,
    claimed_paid: u128,
    refunded: u128,
    fees: u128,
}

#[near]
impl Gifts {
    #[init]
    #[private]
    pub fn new(network: String, contract_id: AccountId, min_amount: U128, max_amount: U128, fee: U128) -> Self {
        require!(!env::state_exists(), "ALREADY_INITIALIZED");
        require!(env::predecessor_account_id() == env::current_account_id(), "PRIVATE_INIT");
        require!(network == "near-mainnet", "WRONG_NETWORK");
        require!(contract_id == env::current_account_id(), "WRONG_CONTRACT");
        mainnet_account(&contract_id);
        require!(!matches!(contract_id.as_str(), "taply-pay.kendinecrypto.near" | "devkendinecrypto.near" | "kendinecrypto.near" | "intents.near"), "SEPARATE_GIFT_ACCOUNT_REQUIRED");
        require!(min_amount.0 > 0 && max_amount.0 >= min_amount.0 && fee.0 > 0, "INVALID_LIMITS");
        require!(max_amount.0.checked_add(fee.0).is_some(), "INVALID_LIMITS");
        Self {
            min_amount: min_amount.0,
            max_amount: max_amount.0,
            fee: fee.0,
            gift_count: 0,
            deposited: 0,
            held: 0,
            in_flight: 0,
            failed_held: 0,
            claimed_paid: 0,
            refunded: 0,
            fees: 0,
        }
    }

    /// Funds a new open gift. Attached deposit must be exactly `amount + GIFT_FEE`.
    #[payable]
    pub fn create_gift(
        &mut self,
        gift_id: String,
        public_key: String,
        amount: U128,
        lifetime_s: u64,
        message: String,
        design: u8,
    ) -> GiftView {
        mainnet_account(&env::predecessor_account_id());
        require!(env::predecessor_account_id() != env::current_account_id(), "SELF_GIFT");
        valid_id(&gift_id);
        let key = hex32(&public_key);
        let amount = amount.0;
        require!(
            (self.min_amount..=self.max_amount).contains(&amount),
            "AMOUNT_OUT_OF_RANGE"
        );
        require!(
            (MIN_LIFETIME_S..=MAX_LIFETIME_S).contains(&lifetime_s),
            "LIFETIME_OUT_OF_RANGE"
        );
        require!(message.len() <= MAX_MESSAGE_BYTES, "MESSAGE_TOO_LONG");
        require!(
            !message.chars().any(|c| c.is_control() && c != '\n'),
            "MESSAGE_INVALID"
        );
        require!(design <= MAX_DESIGN, "DESIGN_INVALID");
        require!(
            env::attached_deposit().as_yoctonear() == add(amount, self.fee),
            "WRONG_DEPOSIT"
        );
        require!(read(&gift_id).is_none(), "GIFT_ID_TAKEN");
        let now = env::block_timestamp();
        let expires_at_ns = now
            .checked_add(
                lifetime_s
                    .checked_mul(1_000_000_000)
                    .unwrap_or_else(|| env::panic_str("OVERFLOW")),
            )
            .unwrap_or_else(|| env::panic_str("OVERFLOW"));
        let gift = Gift {
            creator: env::predecessor_account_id(),
            amount,
            public_key: key,
            message,
            design,
            created_at_ns: now,
            created_height: env::block_height(),
            expires_at_ns,
            outcome: Outcome::Available,
        };
        let before = env::storage_usage();
        env::storage_write(&record_key(&gift_id), &borsh::to_vec(&gift).unwrap());
        let added = env::storage_usage()
            .checked_sub(before)
            .unwrap_or_else(|| env::panic_str("STORAGE_ACCOUNTING"));
        // The fee must cover this record including its largest possible settlement.
        require!(
            mul(
                env::storage_byte_cost().as_yoctonear(),
                (added + MAX_SETTLEMENT_GROWTH) as u128
            ) <= self.fee,
            "FEE_DOES_NOT_COVER_STORAGE"
        );
        self.gift_count = self
            .gift_count
            .checked_add(1)
            .unwrap_or_else(|| env::panic_str("OVERFLOW"));
        self.deposited = add(self.deposited, amount);
        self.held = add(self.held, amount);
        self.fees = add(self.fees, self.fee);
        self.conservation();
        self.check_liquidity(0);
        event("gift_created", &gift_id, &gift);
        view(&gift_id, &gift, now)
    }

    /// First accepted claim wins. Pays only the predecessor, which must be the
    /// account the link key signed for.
    pub fn claim_gift(&mut self, gift_id: String, signature: String) {
        mainnet_account(&env::predecessor_account_id());
        valid_id(&gift_id);
        no_deposit();
        enough_gas();
        let mut gift = load(&gift_id);
        require!(gift.outcome == Outcome::Available, "ALREADY_SETTLED");
        require!(env::block_timestamp() < gift.expires_at_ns, "GIFT_EXPIRED");
        let claimant = env::predecessor_account_id();
        require!(claimant != gift.creator, "CREATOR_CANNOT_CLAIM");
        let sig = hex64(&signature);
        require!(
            env::ed25519_verify(
                &sig,
                claim_message(&env::current_account_id(), &gift_id, &claimant),
                &gift.public_key
            ),
            "BAD_CLAIM_SIGNATURE"
        );
        gift.outcome = Outcome::Claimed(settlement(claimant));
        self.held = sub(self.held, gift.amount);
        self.in_flight = add(self.in_flight, gift.amount);
        self.start_payout(&gift_id, gift);
    }

    /// Creator only, at or after expiry, only while nobody claimed it.
    pub fn refund_gift(&mut self, gift_id: String) {
        valid_id(&gift_id);
        no_deposit();
        enough_gas();
        let mut gift = load(&gift_id);
        require!(
            env::predecessor_account_id() == gift.creator,
            "CREATOR_ONLY"
        );
        require!(gift.outcome == Outcome::Available, "ALREADY_SETTLED");
        require!(env::block_timestamp() >= gift.expires_at_ns, "NOT_EXPIRED");
        gift.outcome = Outcome::Refunded(settlement(gift.creator.clone()));
        self.held = sub(self.held, gift.amount);
        self.in_flight = add(self.in_flight, gift.amount);
        self.start_payout(&gift_id, gift);
    }

    /// Only after the callback RECORDED a failed transfer (funds came back).
    /// Same beneficiary, same amount, to itself; a fresh nonce.
    pub fn retry_payout(&mut self, gift_id: String) {
        valid_id(&gift_id);
        no_deposit();
        enough_gas();
        let mut gift = load(&gift_id);
        let s = gift
            .settlement_mut()
            .unwrap_or_else(|| env::panic_str("NOT_SETTLED"));
        require!(s.payout == Payout::Failed, "PAYOUT_NOT_FAILED");
        require!(
            env::predecessor_account_id() == s.beneficiary,
            "BENEFICIARY_ONLY"
        );
        s.payout = Payout::Pending;
        s.nonce = s
            .nonce
            .checked_add(1)
            .unwrap_or_else(|| env::panic_str("OVERFLOW"));
        self.failed_held = sub(self.failed_held, gift.amount);
        self.in_flight = add(self.in_flight, gift.amount);
        self.start_payout(&gift_id, gift);
    }

    /// Records the transfer result. Never transfers. Unknown result panics and
    /// leaves PENDING (fail closed, never re-paid).
    #[private]
    pub fn on_payout(&mut self, gift_id: String, nonce: u32) -> bool {
        require!(
            env::predecessor_account_id() == env::current_account_id(),
            "PRIVATE_CALLBACK"
        );
        let mut gift = load(&gift_id);
        let amount = gift.amount;
        let claimed = matches!(gift.outcome, Outcome::Claimed(_));
        let s = gift
            .settlement_mut()
            .unwrap_or_else(|| env::panic_str("STALE_CALLBACK"));
        require!(
            s.payout == Payout::Pending && s.nonce == nonce,
            "STALE_CALLBACK"
        );
        require!(env::promise_results_count() == 1, "UNKNOWN_PROMISE_RESULT");
        let success = match env::promise_result_checked(0, 0) {
            Ok(_) => true,
            Err(PromiseError::Failed) => false,
            Err(_) => env::panic_str("UNKNOWN_PROMISE_RESULT"),
        };
        if cfg!(feature = "sandbox-fail-callback") {
            env::panic_str("SANDBOX_CALLBACK_FAULT");
        }
        self.in_flight = sub(self.in_flight, amount);
        if success {
            s.payout = Payout::Confirmed;
            if claimed {
                self.claimed_paid = add(self.claimed_paid, amount);
            } else {
                self.refunded = add(self.refunded, amount);
            }
        } else {
            s.payout = Payout::Failed;
            self.failed_held = add(self.failed_held, amount);
        }
        self.conservation();
        save_same_size(&gift_id, &gift);
        event(
            if success {
                "payout_confirmed"
            } else {
                "payout_failed"
            },
            &gift_id,
            &gift,
        );
        success
    }

    pub fn get_gift(&self, gift_id: String) -> Option<GiftView> {
        if !is_valid_id(&gift_id) {
            return None;
        }
        read(&gift_id).map(|g| view(&gift_id, &g, env::block_timestamp()))
    }

    pub fn get_config(&self) -> near_sdk::serde_json::Value {
        json!({
            "contract": "taply-gift-mainnet",
            "network": "near-mainnet",
            "contractId": env::current_account_id(),
            "testFaultBuild": cfg!(feature = "sandbox-fail-callback"),
            "unknownCallbackPolicy": "PENDING_NO_RETRY_NO_ADMIN_OVERRIDE",
            "version": env!("CARGO_PKG_VERSION"),
            "reviewStatus": REVIEW_STATUS,
            "asset": "near:native",
            "giftFeeYocto": self.fee.to_string(),
            "minAmountYocto": self.min_amount.to_string(),
            "maxAmountYocto": self.max_amount.to_string(),
            "minLifetimeS": MIN_LIFETIME_S.to_string(),
            "maxLifetimeS": MAX_LIFETIME_S.to_string(),
            "maxMessageBytes": MAX_MESSAGE_BYTES,
            "maxDesign": MAX_DESIGN,
            "claimDomain": CLAIM_DOMAIN,
        })
    }

    pub fn get_accounting(&self) -> near_sdk::serde_json::Value {
        json!({
            "giftCount": self.gift_count.to_string(),
            "depositedYocto": self.deposited.to_string(),
            "heldYocto": self.held.to_string(),
            "inFlightYocto": self.in_flight.to_string(),
            "failedHeldYocto": self.failed_held.to_string(),
            "claimedPaidYocto": self.claimed_paid.to_string(),
            "refundedYocto": self.refunded.to_string(),
            "feesYocto": self.fees.to_string(),
            "storageUsageBytes": env::storage_usage().to_string(),
        })
    }
}

impl Gifts {
    fn start_payout(&mut self, gift_id: &str, gift: Gift) {
        let s = gift.settlement().expect("settled");
        let beneficiary = s.beneficiary.clone();
        let nonce = s.nonce;
        self.conservation();
        // Liquidity is checked BEFORE anything is written, including the bytes
        // this settlement adds, so a refusal leaves no trace even in unit tests.
        let growth = settled_growth(gift_id, &gift);
        self.check_liquidity_with(gift.amount, growth);
        // Debit first: the record and buckets are committed before the promise.
        save_settled(gift_id, &gift);
        event(
            match (&gift.outcome, nonce) {
                (_, n) if n > 1 => "payout_retried",
                (Outcome::Claimed(_), _) => "gift_claimed",
                _ => "gift_refund_started",
            },
            gift_id,
            &gift,
        );
        Promise::new(beneficiary)
            .transfer(NearToken::from_yoctonear(gift.amount))
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(CALLBACK_GAS)
                    .on_payout(gift_id.to_string(), nonce),
            )
            .detach();
    }

    fn conservation(&self) {
        require!(
            self.deposited
                == add(
                    add(self.held, self.in_flight),
                    add(self.failed_held, add(self.claimed_paid, self.refunded))
                ),
            "CONSERVATION_FAILURE"
        );
    }

    /// The balance must cover all storage, every AVAILABLE principal, every
    /// recorded-failed principal and the transfer about to leave.
    fn check_liquidity(&self, outgoing: u128) {
        self.check_liquidity_with(outgoing, 0)
    }
    fn check_liquidity_with(&self, outgoing: u128, extra_bytes: u64) {
        let bytes = env::storage_usage()
            .checked_add(extra_bytes)
            .unwrap_or_else(|| env::panic_str("OVERFLOW"));
        let required = add(
            mul(env::storage_byte_cost().as_yoctonear(), bytes as u128),
            add(add(self.held, self.failed_held), outgoing),
        );
        require!(
            env::account_balance().as_yoctonear() >= required,
            "INSUFFICIENT_LIQUIDITY"
        );
    }
}

fn settlement(beneficiary: AccountId) -> Settlement {
    Settlement {
        beneficiary,
        at_ns: env::block_timestamp(),
        height: env::block_height(),
        payout: Payout::Pending,
        nonce: 1,
    }
}

pub fn claim_message(contract: &AccountId, gift_id: &str, claimant: &AccountId) -> String {
    format!("{CLAIM_DOMAIN}:{contract}:{gift_id}:{claimant}")
}

fn view(id: &str, g: &Gift, now: u64) -> GiftView {
    let s = g.settlement();
    GiftView {
        id: id.to_string(),
        creator: g.creator.clone(),
        amount_yocto: U128(g.amount),
        public_key: hex(&g.public_key),
        message: g.message.clone(),
        design: g.design,
        created_at_ns: g.created_at_ns.to_string(),
        created_height: g.created_height.to_string(),
        expires_at_ns: g.expires_at_ns.to_string(),
        status: match g.outcome {
            Outcome::Available if now >= g.expires_at_ns => "EXPIRED",
            Outcome::Available => "AVAILABLE",
            Outcome::Claimed(_) => "CLAIMED",
            Outcome::Refunded(_) => "REFUNDED",
        },
        beneficiary: s.map(|s| s.beneficiary.clone()),
        settled_at_ns: s.map(|s| s.at_ns.to_string()),
        settled_height: s.map(|s| s.height.to_string()),
        payout: s.map(|s| match s.payout {
            Payout::Pending => "PENDING",
            Payout::Confirmed => "CONFIRMED",
            Payout::Failed => "FAILED",
        }),
        payout_nonce: s.map(|s| s.nonce),
    }
}

fn no_deposit() {
    require!(env::attached_deposit().is_zero(), "NO_DEPOSIT_ALLOWED");
}
fn mainnet_account(account: &AccountId) {
    require!(!account.as_str().ends_with(".testnet") && !account.as_str().ends_with(".test"), "WRONG_NETWORK");
}
fn enough_gas() {
    require!(env::prepaid_gas() >= MIN_SETTLE_GAS, "NOT_ENOUGH_GAS");
}
pub fn is_valid_id(id: &str) -> bool {
    id.len() == 32 && id.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
}
fn valid_id(id: &str) {
    require!(is_valid_id(id), "INVALID_GIFT_ID");
}
fn record_key(id: &str) -> Vec<u8> {
    let mut k = b"g:".to_vec();
    k.extend_from_slice(id.as_bytes());
    k
}
fn read(id: &str) -> Option<Gift> {
    env::storage_read(&record_key(id))
        .map(|b| borsh::from_slice(&b).unwrap_or_else(|_| env::panic_str("CORRUPT_RECORD")))
}
fn load(id: &str) -> Gift {
    read(id).unwrap_or_else(|| env::panic_str("GIFT_NOT_FOUND"))
}
/// Bytes a settlement adds to the stored record (bounded by MAX_SETTLEMENT_GROWTH,
/// which GIFT_FEE prepaid at creation). Retries add nothing.
fn settled_growth(id: &str, g: &Gift) -> u64 {
    let previous = env::storage_read(&record_key(id))
        .unwrap_or_else(|| env::panic_str("GIFT_NOT_FOUND"))
        .len();
    let next = borsh::to_vec(g).unwrap().len();
    require!(
        next >= previous && ((next - previous) as u64) <= MAX_SETTLEMENT_GROWTH,
        "STORAGE_GROWTH_FORBIDDEN"
    );
    (next - previous) as u64
}
/// AVAILABLE -> settled may grow the record (checked by settled_growth).
fn save_settled(id: &str, g: &Gift) {
    settled_growth(id, g);
    env::storage_write(&record_key(id), &borsh::to_vec(g).unwrap());
}
/// Callbacks and retries never change the record size.
fn save_same_size(id: &str, g: &Gift) {
    let k = record_key(id);
    let previous = env::storage_read(&k).unwrap_or_else(|| env::panic_str("GIFT_NOT_FOUND"));
    let next = borsh::to_vec(g).unwrap();
    require!(previous.len() == next.len(), "STORAGE_GROWTH_FORBIDDEN");
    env::storage_write(&k, &next);
}
fn event(name: &str, id: &str, g: &Gift) {
    let v = view(id, g, env::block_timestamp());
    env::log_str(&format!(
        "EVENT_JSON:{}",
        json!({"standard": "taply-gift", "version": "1.0.0", "event": name,
            "data": [{"id": id, "creator": v.creator, "amountYocto": v.amount_yocto, "status": v.status,
                "beneficiary": v.beneficiary, "payout": v.payout, "payoutNonce": v.payout_nonce}]})
    ));
}
fn add(a: u128, b: u128) -> u128 {
    a.checked_add(b)
        .unwrap_or_else(|| env::panic_str("OVERFLOW"))
}
fn sub(a: u128, b: u128) -> u128 {
    a.checked_sub(b)
        .unwrap_or_else(|| env::panic_str("UNDERFLOW"))
}
fn mul(a: u128, b: u128) -> u128 {
    a.checked_mul(b)
        .unwrap_or_else(|| env::panic_str("OVERFLOW"))
}
fn nibble(c: u8) -> u8 {
    match c {
        b'0'..=b'9' => c - b'0',
        b'a'..=b'f' => c - b'a' + 10,
        _ => env::panic_str("INVALID_HEX"),
    }
}
fn hex_bytes<const N: usize>(s: &str, code: &str) -> [u8; N] {
    require!(s.len() == N * 2, code);
    let b = s.as_bytes();
    let mut out = [0u8; N];
    for (i, o) in out.iter_mut().enumerate() {
        *o = (nibble(b[2 * i]) << 4) | nibble(b[2 * i + 1]);
    }
    out
}
fn hex32(s: &str) -> [u8; 32] {
    hex_bytes::<32>(s, "INVALID_PUBLIC_KEY")
}
fn hex64(s: &str) -> [u8; 64] {
    hex_bytes::<64>(s, "INVALID_SIGNATURE")
}
fn hex(b: &[u8]) -> String {
    const D: &[u8; 16] = b"0123456789abcdef";
    let mut s = String::with_capacity(b.len() * 2);
    for x in b {
        s.push(D[(x >> 4) as usize] as char);
        s.push(D[(x & 15) as usize] as char);
    }
    s
}

#[cfg(test)]
mod tests;
