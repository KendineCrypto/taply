//! Candidate 0.5.0-merchant.1. Frozen v1 hashes and settlement remain unchanged.
use crate::model::{IntentTerms, canonical, decimal64, domain_hash, hash_bytes};
use near_sdk::serde_json::json;
use near_sdk::{env, require};

pub fn validate_binding(terms: &IntentTerms) {
    match (&terms.merchant_account_id, &terms.session_binding) {
        (None, None) => return, // Existing ordinary Instant semantics.
        (Some(merchant), Some(_)) => require!(
            merchant == &terms.creator_account_id,
            "MERCHANT_RECIPIENT_MISMATCH"
        ),
        _ => env::panic_str("INCOMPLETE_MERCHANT_SESSION_BINDING"),
    }
    let binding = terms.session_binding.as_ref().unwrap();
    // Exact lowercase UUIDv4 syntax used by frozen SessionIdSchema.
    let id = binding.id.as_bytes();
    require!(
        id.len() == 36
            && id.iter().enumerate().all(|(i, b)| {
                if [8, 13, 18, 23].contains(&i) {
                    *b == b'-'
                } else {
                    b.is_ascii_digit() || (b'a'..=b'f').contains(b)
                }
            })
            && id[14] == b'4'
            && matches!(id[19], b'8' | b'9' | b'a' | b'b'),
        "INVALID_SESSION_ID"
    );
    hash_bytes(&binding.nonce);
    let expires = decimal64(&binding.expires_at_ns);
    let now = env::block_timestamp();
    require!(
        expires > now && expires - now <= 120_000_000_000,
        "INVALID_SESSION_EXPIRY"
    );
    require!(
        expires <= decimal64(&terms.funding_expires_at_ns),
        "SESSION_EXCEEDS_FUNDING_EXPIRY"
    );
}

/// Permanent creator-scoped sale tombstone. A new creation nonce must not mint a
/// second request for the same session ID, even with a substituted session nonce.
pub fn sale_key(terms: &IntentTerms) -> Option<Vec<u8>> {
    terms.session_binding.as_ref().map(|session| {
        let hash = domain_hash(
            "taply.merchant-sale.v1",
            &canonical(&json!({
                "creatorAccountId": terms.creator_account_id, "sessionId": session.id
            })),
        );
        let mut key = vec![b's'];
        key.extend_from_slice(&hash_bytes(&hash));
        key
    })
}

pub fn unconsumed(terms: &IntentTerms) {
    if let Some(key) = sale_key(terms) {
        require!(!env::storage_has_key(&key), "SESSION_ALREADY_USED");
    }
}
