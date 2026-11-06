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
        require!(self.asset_id == "near:native", "TOKEN_DISABLED");
        require!(
            self.mode == "instant" && self.cancel_duration_ns.is_none(),
            "PROTECTED_DISABLED"
        );
        #[cfg(not(feature = "merchant-bound-v1"))]
        require!(
            self.merchant_account_id.is_none() && self.session_binding.is_none(),
            "HANDSHAKE_DISABLED"
        );
        #[cfg(feature = "merchant-bound-v1")]
        crate::merchant::validate_binding(self);
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
}
impl Status {
    pub fn wire(self) -> &'static str {
        match self {
            Self::Open => "OPEN",
            Self::Cancelled => "CANCELLED_UNFUNDED",
            Self::InFlight => "PAYOUT_IN_FLIGHT",
            Self::Failed => "PAYOUT_FAILED_RECOVERABLE",
            Self::Paid => "FINAL_PAID",
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
    pub nonce: u64,
    pub started_at: u64,
    pub resolved_at: u64,
    pub terminal_height: u64,
    pub terminal_at: u64,
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
            nonce: 0,
            started_at: 0,
            resolved_at: 0,
            terminal_height: 0,
            terminal_at: 0,
        }
    }
    pub fn amount(&self) -> u128 {
        decimal128(&self.terms.amount_base_units)
    }
    pub fn view(&self) -> Value {
        let funded = self.payer_len > 0;
        let payer = funded
            .then(|| String::from_utf8(self.payer[..self.payer_len as usize].to_vec()).unwrap());
        let op = (self.nonce > 0).then(|| json!({
            "nonce": self.nonce.to_string(), "kind": "INSTANT_PAYOUT",
            "destinationAccountId": self.terms.creator_account_id,
            "amountBaseUnits": self.terms.amount_base_units,
            "status": match self.status { Status::InFlight => "IN_FLIGHT", Status::Failed => "FAILED", Status::Paid => "SUCCEEDED", _ => unreachable!() },
            "startedAtNs": self.started_at.to_string(),
            "resolvedAtNs": (self.status != Status::InFlight).then(|| self.resolved_at.to_string()),
            "failureCode": (self.status == Status::Failed).then_some("NATIVE_TRANSFER_FAILED")
        }));
        #[cfg(not(feature = "merchant-bound-v1"))]
        let commitment: Option<String> = None;
        #[cfg(feature = "merchant-bound-v1")]
        let commitment = self
            .terms
            .session_binding
            .as_ref()
            .map(|_| domain_hash("taply.session.v1", &hex(&self.terms_hash)));
        json!({"terms": self.terms, "termsHash": hex(&self.terms_hash), "sessionCommitment": commitment,
            "recipientAccountId": self.terms.creator_account_id, "status": self.status.wire(),
            "revision": self.revision.to_string(), "createdAtNs": self.created_at.to_string(),
            "payerAccountId": payer, "fundedAtNs": funded.then(|| self.funded_at.to_string()),
            "cancelUntilNs": null, "settlementBranch": funded.then_some("RECIPIENT"), "latestOperation": op})
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
    pub operation_nonce: String,
    pub kind: String,
}
