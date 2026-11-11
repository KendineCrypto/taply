use near_sdk::borsh::{self, BorshDeserialize, BorshSerialize};
use near_sdk::serde::{Deserialize, Deserializer, Serialize};
use near_sdk::serde_json::{self, Value, json};
use near_sdk::{AccountId, env, require};

// deserialize_with makes these nullable fields REQUIRED, unlike plain Option<T>.
fn nullable<'de, D, T>(d: D) -> Result<Option<T>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::<T>::deserialize(d)
}

#[derive(Clone, Debug, Serialize, Deserialize, BorshSerialize, BorshDeserialize)]
#[serde(
    crate = "near_sdk::serde",
    rename_all = "camelCase",
    deny_unknown_fields
)]
pub struct SessionBinding {
    pub id: String,
    pub nonce: String,
    pub expires_at_ns: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, BorshSerialize, BorshDeserialize)]
#[serde(
    crate = "near_sdk::serde",
    rename_all = "camelCase",
    deny_unknown_fields
)]
pub struct IntentTerms {
    pub schema_version: String,
    pub id: String,
    pub network: String,
    pub contract_id: AccountId,
    pub creation_nonce: String,
    pub creator_account_id: AccountId,
    pub asset_id: String,
    pub amount_base_units: String,
    pub mode: String,
    #[serde(deserialize_with = "nullable")]
    pub cancel_duration_ns: Option<String>,
    pub funding_expires_at_ns: String,
    #[serde(deserialize_with = "nullable")]
    pub permitted_payer_account_id: Option<AccountId>,
    #[serde(deserialize_with = "nullable")]
    pub merchant_account_id: Option<AccountId>,
    pub memo: String,
    #[serde(deserialize_with = "nullable")]
    pub session_binding: Option<SessionBinding>,
}

// Freeze section 4: Protected cancellation windows are 60-3600 seconds.
pub const MIN_CANCEL_DURATION_NS: u64 = 60_000_000_000;
pub const MAX_CANCEL_DURATION_NS: u64 = 3_600_000_000_000;
pub const CONSENT_VERSION: &str = "taply.protected-consent.v1";

/// `nep141:<token account>` -> token account. The allowlist is checked by the contract.
pub fn nep141_token(asset_id: &str) -> Option<AccountId> {
    asset_id
        .strip_prefix("nep141:")
        .and_then(|t| t.parse().ok())
}

pub fn decimal128(s: &str) -> u128 {
    require!(
        !s.is_empty()
            && s.len() <= 39
            && s.bytes().all(|c| c.is_ascii_digit())
            && (s == "0" || !s.starts_with('0')),
        "NONCANONICAL_DECIMAL"
    );
    s.parse()
        .unwrap_or_else(|_| env::panic_str("U128_OVERFLOW"))
}
pub fn decimal64(s: &str) -> u64 {
    u64::try_from(decimal128(s)).unwrap_or_else(|_| env::panic_str("U64_OVERFLOW"))
}
pub fn hash_bytes(s: &str) -> [u8; 32] {
    require!(
        s.len() == 64
            && s.bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)),
        "INVALID_HASH"
    );
    let mut out = [0; 32];
    for (i, byte) in out.iter_mut().enumerate() {
        *byte = u8::from_str_radix(&s[i * 2..i * 2 + 2], 16).unwrap();
    }
    out
}
pub fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

// This frozen schema has ASCII object keys, strings and null ONLY (no numbers).
// Sorting object keys and serde_json string escaping therefore implements exactly
// its RFC8785 subset, including Unicode and control characters; no normalization.
pub fn canonical(value: &Value) -> String {
    match value {
        Value::Object(map) => {
            let mut keys: Vec<_> = map.keys().collect();
            keys.sort_by(|a, b| a.encode_utf16().cmp(b.encode_utf16()));
            format!(
                "{{{}}}",
                keys.iter()
                    .map(|k| format!(
                        "{}:{}",
                        serde_json::to_string(k).unwrap(),
                        canonical(&map[*k])
                    ))
                    .collect::<Vec<_>>()
                    .join(",")
            )
        }
        Value::String(_) | Value::Null => serde_json::to_string(value).unwrap(),
        _ => env::panic_str("CANONICAL_SCHEMA_TYPE"),
    }
}
pub fn domain_hash(domain: &str, content: &str) -> String {
    hex(&env::sha256(format!("{domain}\n{content}").as_bytes()))
}
impl IntentTerms {
    pub fn request_id(&self) -> String {
        domain_hash(
            "taply.id.v1",
            &canonical(&json!({
                "contractId": self.contract_id, "creationNonce": self.creation_nonce,
                "creatorAccountId": self.creator_account_id, "network": self.network
            })),
        )
    }
    pub fn terms_hash(&self) -> String {
        domain_hash(
            "taply.terms.v1",
            &canonical(&serde_json::to_value(self).unwrap()),
        )
    }
    pub fn validate(&self) {
        require!(
            self.schema_version == "taply.intent.v1",
            "UNSUPPORTED_SCHEMA"
        );
        require!(self.network == "near-testnet", "WRONG_NETWORK");
        require!(
            self.contract_id == env::current_account_id(),
            "WRONG_CONTRACT"
        );
        require!(
            self.creator_account_id != self.contract_id,
            "SELF_RECIPIENT"
        );
        require!(
            self.asset_id == "near:native" || nep141_token(&self.asset_id).is_some(),
            "TOKEN_DISABLED"
        );
        match self.mode.as_str() {
            "instant" => require!(self.cancel_duration_ns.is_none(), "INVALID_CANCEL_DURATION"),
            "protected" => {
                let d = self
                    .cancel_duration_ns
                    .as_deref()
                    .map(decimal64)
                    .unwrap_or_else(|| env::panic_str("INVALID_CANCEL_DURATION"));
                require!(
                    (MIN_CANCEL_DURATION_NS..=MAX_CANCEL_DURATION_NS).contains(&d),
                    "INVALID_CANCEL_DURATION"
                );
            }
            _ => env::panic_str("UNSUPPORTED_MODE"),
        }
        require!(
            self.merchant_account_id.is_none() && self.session_binding.is_none(),
            "HANDSHAKE_DISABLED"
        );
        require!(self.memo.len() <= 256, "MEMO_TOO_LONG");
        hash_bytes(&self.creation_nonce);
        hash_bytes(&self.id);
        require!(self.id == self.request_id(), "REQUEST_ID_MISMATCH");
        require!(decimal128(&self.amount_base_units) > 0, "ZERO_AMOUNT");
        let expiry = decimal64(&self.funding_expires_at_ns);
        let now = env::block_timestamp();
        require!(
            expiry > now && expiry - now <= 86_400_000_000_000,
            "INVALID_FUNDING_EXPIRY"
        );
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, BorshSerialize, BorshDeserialize)]
pub enum Status {
    Open,
    Cancelled,
    InFlight,
    Failed,
    Paid,
    Locked,
    RefundInFlight,
    RefundFailed,
    Refunded,
    ReleaseInFlight,
    ReleaseFailed,
}
impl Status {
    pub fn wire(self) -> &'static str {
        match self {
            Self::Open => "OPEN",
            Self::Cancelled => "CANCELLED_UNFUNDED",
            Self::InFlight => "PAYOUT_IN_FLIGHT",
            Self::Failed => "PAYOUT_FAILED_RECOVERABLE",
            Self::Paid => "FINAL_PAID",
            Self::Locked => "LOCKED",
            Self::RefundInFlight => "REFUND_IN_FLIGHT",
            Self::RefundFailed => "REFUND_FAILED_RECOVERABLE",
            Self::Refunded => "CANCELLED_REFUNDED",
            Self::ReleaseInFlight => "RELEASE_IN_FLIGHT",
            Self::ReleaseFailed => "RELEASE_FAILED_RECOVERABLE",
        }
    }
    pub fn in_flight(self) -> bool {
        matches!(
            self,
            Self::InFlight | Self::RefundInFlight | Self::ReleaseInFlight
        )
    }
    pub fn failed(self) -> bool {
        matches!(
            self,
            Self::Failed | Self::RefundFailed | Self::ReleaseFailed
        )
    }
}

/// Which outgoing transfer a funded obligation committed to. Chosen once,
/// atomically, before any promise is created; it never changes afterwards.
#[derive(Clone, Copy, Debug, PartialEq, Eq, BorshSerialize, BorshDeserialize)]
pub enum Branch {
    None,
    Recipient,
    Payer,
}
impl Branch {
    pub fn kind(self, mode: &str) -> &'static str {
        match (self, mode) {
            (Self::Recipient, "instant") => "INSTANT_PAYOUT",
            (Self::Recipient, _) => "PROTECTED_RELEASE",
            (Self::Payer, _) => "PROTECTED_REFUND",
            (Self::None, _) => env::panic_str("NO_SETTLEMENT_BRANCH"),
        }
    }
}

/// R-2 candidate: delivery of an already-settled obligation, tracked apart from
/// the request status. The request is FINAL_PAID / CANCELLED_REFUNDED as soon as
/// the branch is settled; this only says whether the outgoing transfer is known
/// to have arrived.
#[derive(Clone, Copy, Debug, PartialEq, Eq, BorshSerialize, BorshDeserialize)]
pub enum Delivery {
    /// Not settled yet.
    None,
    /// Debited and transfer scheduled; no callback has recorded the outcome.
    /// Stays here forever if the callback fails (no retry, no override).
    Sent,
    /// The callback saw a non-Failed transfer result.
    Delivered,
    /// The callback saw an explicit Failed result: the amount is owed again and
    /// only the beneficiary may resend it, to the same destination.
    Returned,
}
impl Delivery {
    pub fn wire(self) -> &'static str {
        match self {
            Self::None => "NOT_STARTED",
            Self::Sent => "SENT_UNCONFIRMED",
            Self::Delivered => "DELIVERED",
            Self::Returned => "RETURNED_RESENDABLE",
        }
    }
}

#[derive(Clone, BorshSerialize, BorshDeserialize)]
pub struct Record {
    pub terms: IntentTerms,
    pub terms_hash: [u8; 32],
    pub status: Status,
    pub revision: u64,
    pub created_at: u64,
    pub payer: [u8; 64],
    pub payer_len: u8,
    pub funded_at: u64,
    pub cancel_until: u64,
    pub branch: Branch,
    pub nonce: u64,
    pub started_at: u64,
    pub resolved_at: u64,
    pub terminal_height: u64,
    pub terminal_at: u64,
    pub delivery: Delivery,
}
impl Record {
    pub fn new(terms: IntentTerms) -> Self {
        Self {
            terms_hash: hash_bytes(&terms.terms_hash()),
            terms,
            status: Status::Open,
            revision: 1,
            created_at: env::block_timestamp(),
            payer: [0; 64],
            payer_len: 0,
            funded_at: 0,
            cancel_until: 0,
            branch: Branch::None,
            nonce: 0,
            started_at: 0,
            resolved_at: 0,
            terminal_height: 0,
            terminal_at: 0,
            delivery: Delivery::None,
        }
    }
    pub fn amount(&self) -> u128 {
        decimal128(&self.terms.amount_base_units)
    }
    pub fn protected(&self) -> bool {
        self.terms.mode == "protected"
    }
    pub fn payer_id(&self) -> Option<AccountId> {
        (self.payer_len > 0).then(|| {
            String::from_utf8(self.payer[..self.payer_len as usize].to_vec())
                .unwrap()
                .parse()
                .unwrap()
        })
    }
    /// Destination of the committed branch. Recipient = creator; refunds go only
    /// to the recorded payer, never to a caller-chosen account.
    pub fn destination(&self) -> AccountId {
        match self.branch {
            Branch::Recipient => self.terms.creator_account_id.clone(),
            Branch::Payer => self
                .payer_id()
                .unwrap_or_else(|| env::panic_str("NO_RECORDED_PAYER")),
            Branch::None => env::panic_str("NO_SETTLEMENT_BRANCH"),
        }
    }
    /// Request view in the UNCHANGED shared wire schema. In this candidate the
    /// operation is the settlement, which commits in one receipt, so a settled
    /// request is always FINAL_PAID / CANCELLED_REFUNDED with a SUCCEEDED
    /// operation. Whether the transfer arrived is reported by `delivery_view`.
    pub fn view(&self) -> Value {
        let funded = self.payer_len > 0;
        let payer = self.payer_id();
        let op = (self.branch != Branch::None).then(|| {
            json!({
                "nonce": self.nonce.to_string(), "kind": self.branch.kind(&self.terms.mode),
                "destinationAccountId": self.destination(),
                "amountBaseUnits": self.terms.amount_base_units,
                "status": "SUCCEEDED",
                "startedAtNs": self.terminal_at.to_string(),
                "resolvedAtNs": self.terminal_at.to_string(),
                "failureCode": null
            })
        });
        let branch = match self.branch {
            Branch::None => None,
            Branch::Recipient => Some("RECIPIENT"),
            Branch::Payer => Some("PAYER"),
        };
        json!({"terms": self.terms, "termsHash": hex(&self.terms_hash), "sessionCommitment": null,
            "recipientAccountId": self.terms.creator_account_id, "status": self.status.wire(),
            "revision": self.revision.to_string(), "createdAtNs": self.created_at.to_string(),
            "payerAccountId": payer, "fundedAtNs": funded.then(|| self.funded_at.to_string()),
            "cancelUntilNs": (funded && self.protected()).then(|| self.cancel_until.to_string()),
            "settlementBranch": branch, "latestOperation": op})
    }
    pub fn delivery_view(&self) -> Value {
        let settled = self.branch != Branch::None;
        json!({"schemaVersion": "taply.delivery.v1", "requestId": self.terms.id,
        "requestStatus": self.status.wire(), "delivery": self.delivery.wire(),
        "deliveryNonce": self.nonce.to_string(),
        "kind": settled.then(|| self.branch.kind(&self.terms.mode)),
        "destinationAccountId": settled.then(|| self.destination()),
        "assetId": self.terms.asset_id, "amountBaseUnits": self.terms.amount_base_units,
        "sentAtNs": (self.delivery != Delivery::None).then(|| self.started_at.to_string()),
        "resolvedAtNs": matches!(self.delivery, Delivery::Delivered | Delivery::Returned).then(|| self.resolved_at.to_string()),
        "resendAllowed": self.delivery == Delivery::Returned,
        "note": match self.delivery {
            Delivery::Sent => "Settled. The transfer was sent; no callback has recorded its outcome. Check the transfer receipt off-chain. This contract never re-sends an unconfirmed transfer.",
            Delivery::Returned => "The transfer failed and the amount is held for the beneficiary, who alone may resend it to the same account.",
            Delivery::Delivered => "The transfer outcome was recorded by the contract's own callback.",
            Delivery::None => "Not settled.",
        }})
    }
}

// Re-parse actual runtime input into strict argument structs: the SDK generated
// wrappers alone don't reject unknown top-level fields. Struct deserialization
// also rejects duplicate keys, including escaped aliases, before hashing.
pub fn strict_input<T: for<'de> Deserialize<'de>>() {
    if let Some(input) = env::input() {
        // Direct Rust unit calls have no ABI input; WASM never has this bypass.
        #[cfg(test)]
        if input.is_empty() {
            return;
        }
        require!(input.len() <= 8192, "INPUT_TOO_LARGE");
        serde_json::from_slice::<T>(&input).unwrap_or_else(|_| env::panic_str("INVALID_ARGUMENTS"));
    }
}
#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde", deny_unknown_fields)]
pub struct EmptyArgs {}
#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde", deny_unknown_fields)]
pub struct IdArgs {
    pub id: String,
}
#[derive(Deserialize)]
#[serde(
    crate = "near_sdk::serde",
    rename_all = "camelCase",
    deny_unknown_fields
)]
pub struct TermsArgs {
    pub id: String,
    pub expected_terms_hash: String,
}
#[derive(Deserialize)]
#[serde(
    crate = "near_sdk::serde",
    rename_all = "camelCase",
    deny_unknown_fields
)]
pub struct CreateArgs {
    pub terms: IntentTerms,
    pub quote_version: String,
}
#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde", deny_unknown_fields)]
pub struct QuoteArgs {
    pub terms: IntentTerms,
}
#[derive(Deserialize)]
#[serde(
    crate = "near_sdk::serde",
    rename_all = "camelCase",
    deny_unknown_fields
)]
pub struct RetryArgs {
    pub id: String,
    pub expected_operation_nonce: String,
}
#[derive(Deserialize)]
#[serde(
    crate = "near_sdk::serde",
    rename_all = "camelCase",
    deny_unknown_fields
)]
pub struct CallbackArgs {
    pub id: String,
    pub delivery_nonce: String,
}
#[derive(Deserialize)]
#[serde(
    crate = "near_sdk::serde",
    rename_all = "camelCase",
    deny_unknown_fields
)]
pub struct FundProtectedArgs {
    pub id: String,
    pub expected_terms_hash: String,
    pub accepted_cancel_duration_ns: String,
    pub consent_version: String,
}

#[derive(Serialize, Deserialize)]
#[serde(
    crate = "near_sdk::serde",
    rename_all = "camelCase",
    deny_unknown_fields
)]
pub struct TokenSpec {
    pub account_id: AccountId,
    pub decimals: u8,
    pub symbol: String,
}
#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde", deny_unknown_fields)]
pub struct NewArgs {
    pub tokens: Vec<TokenSpec>,
}
#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde", deny_unknown_fields)]
pub struct FtOnTransferArgs {
    pub sender_id: AccountId,
    pub amount: near_sdk::json_types::U128,
    pub msg: String,
}
/// Strict `msg` for ft_transfer_call. It can name a request but never a payee.
#[derive(Deserialize)]
#[serde(
    crate = "near_sdk::serde",
    rename_all = "camelCase",
    deny_unknown_fields
)]
pub struct FtMessage {
    pub id: String,
    pub expected_terms_hash: String,
    pub action: String,
    #[serde(default)]
    pub accepted_cancel_duration_ns: Option<String>,
    #[serde(default)]
    pub consent_version: Option<String>,
}
