// The SDK also generates camelCase argument fields outside the impl block.
#![allow(non_snake_case)]
pub mod model;

use model::*;
use near_sdk::borsh;
use near_sdk::json_types::U128;
use near_sdk::serde_json::{Value, json};
use near_sdk::{
    AccountId, Gas, NearToken, PanicOnDefault, Promise, PromiseError, PromiseOrValue, env, near,
    require,
};

const CALLBACK_GAS: Gas = Gas::from_tgas(15);
const PAY_GAS: Gas = Gas::from_tgas(50);
const FUND_PROTECTED_GAS: Gas = Gas::from_tgas(20);
const SETTLE_GAS: Gas = Gas::from_tgas(50);
// NEP-141: gas the token forwards into ft_on_transfer must cover payout + callback.
const FT_ON_TRANSFER_GAS: Gas = Gas::from_tgas(40);
const FT_TRANSFER_GAS: Gas = Gas::from_tgas(15);
const MAX_TOKENS: usize = 1;
const USDC: &str = "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const NATIVE_CAP: u128 = 1_000_000_000_000_000_000_000_000;
const USDC_CAP: u128 = 25_000_000;
const CREATE_GAS: Gas = Gas::from_tgas(30);
const CANCEL_GAS: Gas = Gas::from_tgas(15);
// NEAR protocol storage_amount_per_byte charges key+value+40 bytes per record.
// Creation verifies the actual delta, failing closed if protocol costs change.
const RECORD_OVERHEAD: u64 = 40;
const QUOTE_VERSION: &str = "1";

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Payments {
    received: u128,
    confirmed_paid: u128,
    in_flight: u128,
    failed_held: u128,
    // Protected Pay: principal held in escrow (LOCKED) and principal refunded.
    locked: u128,
    refunded: u128,
    storage_bonds: u128,
    auth_deposits: u128,
    request_count: u64,
    /// NEP-141 allowlist with one ledger per token. Fixed at init; no admin can change it.
    tokens: Vec<TokenEntry>,
    router: AccountId,
    recovery: AccountId,
    recovery_nonce: u64,
    recovery_amount: u128,
    recovery_receiver: [u8; 64],
    recovery_receiver_len: u8,
}

#[near(serializers = [borsh])]
#[derive(Clone)]
pub struct TokenEntry {
    account_id: AccountId,
    decimals: u8,
    symbol: String,
    received: u128,
    confirmed_paid: u128,
    in_flight: u128,
    failed_held: u128,
    locked: u128,
    refunded: u128,
    unclaimed_held: u128,
    unclaimed_in_flight: u128,
    unclaimed_withdrawn: u128,
    router_received: u128,
}

#[derive(Clone, Copy)]
enum F {
    Received,
    Paid,
    InFlight,
    Failed,
    Locked,
    Refunded,
}

#[near]
#[allow(non_snake_case)] // Frozen camelCase JSON argument names.
impl Payments {
    #[init]
    #[private]
    pub fn new(tokens: Vec<TokenSpec>, routerAccountId: AccountId, recoveryAccountId: AccountId,
        nativeCapYocto: U128, usdcCapBaseUnits: U128) -> Self {
        strict_input::<NewArgs>();
        require!(
            env::predecessor_account_id() == env::current_account_id(),
            "PRIVATE_INIT"
        );
        require!(tokens.len() == MAX_TOKENS, "INVALID_TOKEN_ALLOWLIST");
        require!(matches!(env::current_account_id().as_str(), "taply-pay.kendinecrypto.near" | "devkendinecrypto.near"), "WRONG_CONTRACT");
        require!(routerAccountId.as_str() == "intents.near" && recoveryAccountId.as_str() == "kendinecrypto.near", "INVALID_MAINNET_CONFIG");
        require!(nativeCapYocto.0 == NATIVE_CAP && usdcCapBaseUnits.0 == USDC_CAP, "INVALID_CAPS");
        let mut entries: Vec<TokenEntry> = Vec::new();
        for t in tokens {
            require!(t.account_id.as_str() == USDC && t.decimals == 6 && t.symbol == "USDC", "INVALID_TOKEN_ALLOWLIST");
            require!(
                t.account_id != env::current_account_id()
                    && entries.iter().all(|e| e.account_id != t.account_id),
                "INVALID_TOKEN_ALLOWLIST"
            );
            require!(
                t.decimals <= 24
                    && !t.symbol.is_empty()
                    && t.symbol.len() <= 16
                    && t.symbol
                        .bytes()
                        .all(|b| b.is_ascii_alphanumeric() || b == b'-'),
                "INVALID_TOKEN_METADATA"
            );
            entries.push(TokenEntry {
                account_id: t.account_id,
                decimals: t.decimals,
                symbol: t.symbol,
                received: 0,
                confirmed_paid: 0,
                in_flight: 0,
                failed_held: 0,
                locked: 0,
                refunded: 0,
                unclaimed_held: 0, unclaimed_in_flight: 0, unclaimed_withdrawn: 0, router_received: 0,
            });
        }
        Self {
            tokens: entries,
            router: routerAccountId, recovery: recoveryAccountId,
            recovery_nonce: 0, recovery_amount: 0, recovery_receiver: [0; 64], recovery_receiver_len: 0,
            received: 0,
            confirmed_paid: 0,
            in_flight: 0,
            failed_held: 0,
            locked: 0,
            refunded: 0,
            storage_bonds: 0,
            auth_deposits: 0,
            request_count: 0,
        }
    }

    pub fn get_config(&self) -> Value {
        strict_input::<EmptyArgs>();
        json!({"schemaVersion": "taply.contract-config.v1", "contractVersion": "0.6.0-mainnet",
            "network": "near-mainnet", "contractId": env::current_account_id(),
            "routerAccountId": self.router, "recoveryAccountId": self.recovery,
            "nativeCapYocto": NATIVE_CAP.to_string(), "usdcCapBaseUnits": USDC_CAP.to_string(),
            "intentVersion": "taply.intent.v1", "eventVersion": "0.4.0",
            "capabilities": {"instantNative": true, "protectedPay": false, "intentsRouter": false, "handshake": false,
                "merchantProfiles": false, "nep141": !self.tokens.is_empty(), "sponsoredGas": false},
            "tokens": self.tokens.iter().map(|t| json!({"assetId": format!("nep141:{}", t.account_id),
                "accountId": t.account_id, "decimals": t.decimals, "symbol": t.symbol})).collect::<Vec<_>>(),
            "quoteVersion": QUOTE_VERSION, "storageByteCostYocto": env::storage_byte_cost().as_yoctonear().to_string(),
            "gas": {"createRequest": CREATE_GAS.as_gas().to_string(), "payInstantNative": PAY_GAS.as_gas().to_string(),
                "retryNativeTransfer": PAY_GAS.as_gas().to_string(), "cancelUnfunded": CANCEL_GAS.as_gas().to_string(),
                "callback": CALLBACK_GAS.as_gas().to_string(),
                "withdrawUnclaimed": SETTLE_GAS.as_gas().to_string(),
                "recoveryCallback": CALLBACK_GAS.as_gas().to_string(),
                "fundProtectedNative": FUND_PROTECTED_GAS.as_gas().to_string(),
                "cancelProtected": SETTLE_GAS.as_gas().to_string(),
                "releaseProtected": SETTLE_GAS.as_gas().to_string(),
                "ftOnTransfer": FT_ON_TRANSFER_GAS.as_gas().to_string(), "ftTransfer": FT_TRANSFER_GAS.as_gas().to_string()},
            "protected": {"consentVersion": CONSENT_VERSION,
                "minCancelDurationNs": MIN_CANCEL_DURATION_NS.to_string(),
                "maxCancelDurationNs": MAX_CANCEL_DURATION_NS.to_string(),
                "cutoffRule": "CANCEL_IF_BLOCK_TIME_LT_CUTOFF_RELEASE_IF_GTE",
                "reviewStatus": "UNREVIEWED_OWNER_ACCEPTED_CAPPED"},
            "storageRefundPolicy": "PERMANENT_RECORD_NO_WITHDRAWAL",
            "unknownCallbackPolicy": "IN_FLIGHT_NO_RETRY_NO_ADMIN_OVERRIDE",
            "testFaultBuild": cfg!(feature = "sandbox-fail-callback")})
    }

    pub fn quote_create_request(&self, terms: IntentTerms) -> Value {
        strict_input::<QuoteArgs>();
        terms.validate();
        self.require_asset(&terms.asset_id);
        require!(decimal128(&terms.amount_base_units) <= if terms.asset_id == NATIVE { NATIVE_CAP } else { USDC_CAP },
            if terms.asset_id == NATIVE { "NATIVE_CAP_EXCEEDED" } else { "USDC_CAP_EXCEEDED" });
        require!(!env::storage_has_key(&key(&terms.id)), "NONCE_CONSUMED");
        let r = Record::new(terms);
        let bytes = storage_bytes(&r);
        json!({"quoteVersion": QUOTE_VERSION, "requestId": r.terms.id,
            "termsHash": hex(&r.terms_hash), "storageBytes": bytes.to_string(),
            "depositYocto": storage_cost(bytes).to_string(), "gas": CREATE_GAS.as_gas().to_string()})
    }

    #[payable]
    pub fn create_request(&mut self, terms: IntentTerms, quoteVersion: String) -> Value {
        strict_input::<CreateArgs>();
        direct();
        gas_at_least(CREATE_GAS);
        require!(quoteVersion == QUOTE_VERSION, "STALE_QUOTE");
        terms.validate();
        self.require_asset(&terms.asset_id);
        require!(decimal128(&terms.amount_base_units) <= if terms.asset_id == NATIVE { NATIVE_CAP } else { USDC_CAP },
            if terms.asset_id == NATIVE { "NATIVE_CAP_EXCEEDED" } else { "USDC_CAP_EXCEEDED" });
        require!(
            terms.creator_account_id == env::predecessor_account_id(),
            "RECIPIENT_ONLY"
        );
        let k = key(&terms.id);
        require!(!env::storage_has_key(&k), "NONCE_CONSUMED");
        let r = Record::new(terms);
        let bytes = storage_bytes(&r);
        let bond = storage_cost(bytes);
        require!(
            env::attached_deposit().as_yoctonear() == bond,
            "EXACT_STORAGE_DEPOSIT_REQUIRED"
        );
        let before = env::storage_usage();
        require!(
            !env::storage_write(&k, &borsh::to_vec(&r).unwrap()),
            "NONCE_CONSUMED"
        );
        require!(
            env::storage_usage() - before == bytes,
            "STORAGE_QUOTE_MISMATCH"
        );
        self.storage_bonds = add(self.storage_bonds, bond);
        self.request_count = inc(self.request_count);
        self.check_liquidity(0);
        event("request_created", &r);
        r.view()
    }

    pub fn get_request(&self, id: String) -> Option<Value> {
        strict_input::<IdArgs>();
        read(&id).map(|r| r.view())
    }

    // Terminal facts only. Neither transaction IDs nor chain finality are visible
    // to a contract; an external receipt graph verifier must supply that evidence.
    pub fn get_receipt(&self, id: String) -> Option<Value> {
        strict_input::<IdArgs>();
        read(&id).and_then(|r| {
            matches!(r.status, Status::Paid | Status::Cancelled | Status::Refunded).then(|| json!({
                "schemaVersion": "taply.terminal-facts.v1", "request": r.view(),
                "terminalBlockHeight": r.terminal_height.to_string(), "terminalAtNs": r.terminal_at.to_string(),
                "payoutConfirmed": r.status == Status::Paid,
                "evidenceKind": "CONTRACT_FACTS_NOT_FINALITY_PROOF"
            }))
        })
    }

    #[payable]
    pub fn cancel_unfunded(&mut self, id: String, expectedTermsHash: String) -> Value {
        strict_input::<TermsArgs>();
        direct();
        one_yocto();
        gas_at_least(CANCEL_GAS);
        let mut r = load_matching(&id, &expectedTermsHash);
        require!(
            env::predecessor_account_id() == r.terms.creator_account_id,
            "RECIPIENT_ONLY"
        );
        require!(r.status == Status::Open, "NOT_OPEN");
        self.auth_deposits = add(self.auth_deposits, 1);
        r.status = Status::Cancelled;
        r.revision = inc(r.revision);
        r.terminal_at = env::block_timestamp();
        r.terminal_height = env::block_height();
        save(&r);
        event("request_cancelled", &r);
        r.view()
    }

    #[payable]
    pub fn pay_instant_native(&mut self, id: String, expectedTermsHash: String) -> Promise {
        strict_input::<TermsArgs>();
        direct();
        gas_at_least(PAY_GAS);
        let mut r = load_matching(&id, &expectedTermsHash);
        require!(!r.protected(), "WRONG_MODE");
        require!(r.terms.asset_id == NATIVE, "WRONG_ASSET");
        let payer = fundable(&r, env::predecessor_account_id());
        require!(
            r.terms
                .permitted_payer_account_id
                .as_ref()
                .is_none_or(|p| *p == payer),
            "WRONG_PAYER"
        );
        require!(
            env::attached_deposit().as_yoctonear() == r.amount(),
            "EXACT_PRINCIPAL_REQUIRED"
        );
        self.check_liquidity(r.amount());
        self.received = add(self.received, r.amount());
        self.in_flight = add(self.in_flight, r.amount());
        record_payer(&mut r, &payer);
        r.branch = Branch::Recipient;
        self.start_transfer(r)
    }

    /// Payer consent: the wallet-signed call echoes the exact cancellation
    /// duration and consent version the payer was shown, plus the terms hash.
    /// The cutoff is computed from chain time at this execution, never supplied.
    #[payable]
    pub fn fund_protected_native(
        &mut self,
        id: String,
        expectedTermsHash: String,
        acceptedCancelDurationNs: String,
        consentVersion: String,
    ) -> Value {
        strict_input::<FundProtectedArgs>();
        direct();
        gas_at_least(FUND_PROTECTED_GAS);
        require!(
            consentVersion == CONSENT_VERSION,
            "UNSUPPORTED_CONSENT_VERSION"
        );
        let mut r = load_matching(&id, &expectedTermsHash);
        require!(r.protected(), "WRONG_MODE");
        let duration = decimal64(r.terms.cancel_duration_ns.as_deref().unwrap());
        require!(
            decimal64(&acceptedCancelDurationNs) == duration,
            "CANCEL_DURATION_NOT_ACCEPTED"
        );
        require!(r.terms.asset_id == NATIVE, "WRONG_ASSET");
        let payer = fundable(&r, env::predecessor_account_id());
        require!(
            env::attached_deposit().as_yoctonear() == r.amount(),
            "EXACT_PRINCIPAL_REQUIRED"
        );
        self.received = add(self.received, r.amount());
        self.locked = add(self.locked, r.amount());
        record_payer(&mut r, &payer);
        r.cancel_until = r
            .funded_at
            .checked_add(duration)
            .unwrap_or_else(|| env::panic_str("CUTOFF_OVERFLOW"));
        r.status = Status::Locked;
        r.revision = inc(r.revision);
        self.check_liquidity(0);
        self.conservation();
        save(&r);
        event("request_locked", &r);
        r.view()
    }

    /// Payer-only refund, strictly before the chain cutoff. Commits the PAYER
    /// branch irreversibly before the transfer promise is created.
    #[payable]
    pub fn cancel_protected(&mut self, id: String, expectedTermsHash: String) -> Promise {
        strict_input::<TermsArgs>();
        direct();
        one_yocto();
        gas_at_least(SETTLE_GAS);
        let mut r = load_matching(&id, &expectedTermsHash);
        require!(r.status == Status::Locked, "NOT_LOCKED");
        require!(
            r.payer_id()
                .is_some_and(|p| p == env::predecessor_account_id()),
            "PAYER_ONLY"
        );
        require!(
            env::block_timestamp() < r.cancel_until,
            "CANCELLATION_WINDOW_CLOSED"
        );
        self.auth_deposits = add(self.auth_deposits, 1);
        self.check_liquidity(native_outgoing(&r));
        self.mv(
            &r.terms.asset_id.clone(),
            F::Locked,
            F::InFlight,
            r.amount(),
        );
        r.branch = Branch::Payer;
        self.start_transfer(r)
    }

    /// Anyone may trigger release once chain time reaches the cutoff; funds can
    /// only go to the recipient fixed in the signed terms.
    #[payable]
    pub fn release_protected(&mut self, id: String) -> Promise {
        strict_input::<IdArgs>();
        direct();
        one_yocto();
        gas_at_least(SETTLE_GAS);
        let mut r = load(&id);
        require!(r.status == Status::Locked, "NOT_LOCKED");
        require!(
            env::block_timestamp() >= r.cancel_until,
            "CANCELLATION_WINDOW_OPEN"
        );
        self.auth_deposits = add(self.auth_deposits, 1);
        self.check_liquidity(native_outgoing(&r));
        self.mv(
            &r.terms.asset_id.clone(),
            F::Locked,
            F::InFlight,
            r.amount(),
        );
        r.branch = Branch::Recipient;
        self.start_transfer(r)
    }

    #[payable]
    pub fn retry_native_transfer(&mut self, id: String, expectedOperationNonce: String) -> Promise {
        strict_input::<RetryArgs>();
        direct();
        one_yocto();
        gas_at_least(PAY_GAS);
        let mut r = load(&id);
        require!(r.status.failed(), "NO_RECORDED_TRANSFER_FAILURE");
        // Only the beneficiary of the committed branch may retry, and only to the
        // same destination: a failed refund can never become a release or vice versa.
        match r.branch {
            Branch::Recipient => require!(
                env::predecessor_account_id() == r.terms.creator_account_id,
                "RECIPIENT_ONLY"
            ),
            Branch::Payer => require!(
                r.payer_id()
                    .is_some_and(|p| p == env::predecessor_account_id()),
                "PAYER_ONLY"
            ),
            Branch::None => env::panic_str("NO_SETTLEMENT_BRANCH"),
        }
        require!(
            decimal64(&expectedOperationNonce) == r.nonce,
            "OPERATION_NONCE_MISMATCH"
        );
        // Check all failed obligations before removing this one from the held pool.
        self.check_liquidity(0);
        self.mv(
            &r.terms.asset_id.clone(),
            F::Failed,
            F::InFlight,
            r.amount(),
        );
        self.auth_deposits = add(self.auth_deposits, 1);
        r.resolved_at = 0;
        self.start_transfer(r)
    }

    #[private]
    pub fn on_native_transfer_complete(
        &mut self,
        id: String,
        operationNonce: String,
        kind: String,
    ) -> bool {
        strict_input::<CallbackArgs>();
        require!(
            env::predecessor_account_id() == env::current_account_id(),
            "PRIVATE_CALLBACK"
        );
        let mut r = load(&id);
        require!(
            r.status.in_flight() && r.nonce == decimal64(&operationNonce),
            "STALE_CALLBACK"
        );
        require!(kind == r.branch.kind(&r.terms.mode), "WRONG_OPERATION_KIND");
        require!(env::promise_results_count() == 1, "UNKNOWN_PROMISE_RESULT");
        // Native Transfer returns empty bytes. TooLong/unknown is NOT Failed.
        // Native Transfer returns empty bytes. NEP-141 ft_transfer returns nothing by the
        // standard, but a token's return value must not turn a SUCCESS into "unknown"
        // (that would strand the obligation in flight), so token payouts accept a small value.
        let max_len = if nep141_token(&r.terms.asset_id).is_some() {
            256
        } else {
            0
        };
        let success = match env::promise_result_checked(0, max_len) {
            Ok(_) => true,
            Err(PromiseError::Failed) => false,
            Err(_) => env::panic_str("UNKNOWN_PROMISE_RESULT"),
        };
        // A distinct test-only WASM proves real transfer-success/callback-panic
        // behavior without any production admin/fault-injection method.
        if cfg!(feature = "sandbox-fail-callback") {
            env::panic_str("SANDBOX_CALLBACK_FAULT");
        }
        let refund = r.branch == Branch::Payer;
        let asset = r.terms.asset_id.clone();
        if success {
            if refund {
                self.mv(&asset, F::InFlight, F::Refunded, r.amount());
                r.status = Status::Refunded;
            } else {
                self.mv(&asset, F::InFlight, F::Paid, r.amount());
                r.status = Status::Paid;
            }
            r.terminal_at = env::block_timestamp();
            r.terminal_height = env::block_height();
        } else {
            self.mv(&asset, F::InFlight, F::Failed, r.amount());
            r.status = match (refund, r.protected()) {
                (true, _) => Status::RefundFailed,
                (false, true) => Status::ReleaseFailed,
                (false, false) => Status::Failed,
            };
        }
        r.resolved_at = env::block_timestamp();
        r.revision = inc(r.revision);
        self.conservation();
        save(&r);
        event(
            match (success, refund) {
                (true, false) => "payout_succeeded",
                (false, false) => "payout_failed",
                (true, true) => "refund_succeeded",
                (false, true) => "refund_failed",
            },
            &r,
        );
        success
    }

    /// NEP-141 funding. The caller MUST be the allowlisted token named in the
    /// signed terms (a fake token's call fails WRONG_ASSET); `sender_id` is the
    /// payer. Any failure panics, so the token's ft_resolve_transfer returns the
    /// whole amount to the payer and no state changes here. On success all of
    /// `amount` is used ("0" unused); an instant payout is scheduled as a
    /// separate promise whose outcome only this contract's callback records.
    pub fn ft_on_transfer(
        &mut self,
        sender_id: AccountId,
        amount: U128,
        msg: String,
    ) -> PromiseOrValue<U128> {
        let token = env::predecessor_account_id();
        require!(token.as_str() == USDC, "TOKEN_DISABLED");
        if sender_id == self.router {
            return self.router_delivery(amount.0, &msg);
        }
        strict_input::<FtOnTransferArgs>();
        require!(msg.len() <= 1024, "INVALID_FT_MESSAGE");
        let m: FtMessage = near_sdk::serde_json::from_str(&msg)
            .unwrap_or_else(|_| env::panic_str("INVALID_FT_MESSAGE"));
        let token = env::predecessor_account_id();
        let mut r = load_matching(&m.id, &m.expected_terms_hash);
        require!(r.terms.asset_id == format!("nep141:{token}"), "WRONG_ASSET");
        self.require_asset(&r.terms.asset_id);
        let payer = fundable(&r, sender_id);
        require!(amount.0 == r.amount(), "EXACT_PRINCIPAL_REQUIRED");
        let asset = r.terms.asset_id.clone();
        match m.action.as_str() {
            "pay_instant" => {
                require!(!r.protected(), "WRONG_MODE");
                gas_at_least(FT_ON_TRANSFER_GAS);
                self.credit(&asset, F::Received, r.amount());
                self.credit(&asset, F::InFlight, r.amount());
                record_payer(&mut r, &payer);
                r.branch = Branch::Recipient;
                // Detached: scheduled when dropped. Its result never reaches the resolver.
                let _payout = self.start_transfer(r);
            }
            "fund_protected" => {
                require!(r.protected(), "WRONG_MODE");
                require!(
                    m.consent_version.as_deref() == Some(CONSENT_VERSION),
                    "UNSUPPORTED_CONSENT_VERSION"
                );
                let duration = decimal64(r.terms.cancel_duration_ns.as_deref().unwrap());
                require!(
                    m.accepted_cancel_duration_ns.as_deref().map(decimal64) == Some(duration),
                    "CANCEL_DURATION_NOT_ACCEPTED"
                );
                self.credit(&asset, F::Received, r.amount());
                self.credit(&asset, F::Locked, r.amount());
                record_payer(&mut r, &payer);
                r.cancel_until = r
                    .funded_at
                    .checked_add(duration)
                    .unwrap_or_else(|| env::panic_str("CUTOFF_OVERFLOW"));
                r.status = Status::Locked;
                r.revision = inc(r.revision);
                self.conservation();
                save(&r);
                event("request_locked", &r);
            }
            _ => env::panic_str("INVALID_FT_MESSAGE"),
        }
        PromiseOrValue::Value(U128(0))
    }

    #[payable]
    pub fn withdraw_unclaimed(&mut self, token: AccountId, amount: U128, receiver: AccountId) -> Promise {
        direct();
        one_yocto();
        gas_at_least(SETTLE_GAS);
        require!(env::predecessor_account_id() == self.recovery, "RECOVERY_ONLY");
        require!(token.as_str() == USDC, "TOKEN_DISABLED");
        require!(receiver != env::current_account_id() && receiver != self.router, "INVALID_RECOVERY_RECEIVER");
        require!(self.recovery_amount == 0, "RECOVERY_IN_FLIGHT");
        require!(amount.0 > 0 && amount.0 <= self.tokens[0].unclaimed_held, "INSUFFICIENT_UNCLAIMED");
        self.check_liquidity(1);
        self.auth_deposits = add(self.auth_deposits, 1);
        self.recovery_nonce = inc(self.recovery_nonce);
        self.recovery_amount = amount.0;
        self.recovery_receiver = [0; 64];
        self.recovery_receiver[..receiver.as_str().len()].copy_from_slice(receiver.as_bytes());
        self.recovery_receiver_len = receiver.as_str().len() as u8;
        let t = &mut self.tokens[0];
        t.unclaimed_held = sub(t.unclaimed_held, amount.0);
        t.unclaimed_in_flight = add(t.unclaimed_in_flight, amount.0);
        self.conservation();
        self.recovery_event("unclaimed_withdrawal_started");
        Promise::new(token).function_call("ft_transfer".into(),
            near_sdk::serde_json::to_vec(&json!({"receiver_id":receiver,"amount":amount,"memo":"Taply unclaimed recovery"})).unwrap(),
            NearToken::from_yoctonear(1), FT_TRANSFER_GAS)
            .then(Promise::new(env::current_account_id()).function_call("on_unclaimed_transfer_complete".into(),
                near_sdk::serde_json::to_vec(&json!({"operationNonce":self.recovery_nonce.to_string()})).unwrap(),
                NearToken::from_yoctonear(0), CALLBACK_GAS))
    }

    #[private]
    pub fn on_unclaimed_transfer_complete(&mut self, operationNonce: String) -> bool {
        require!(env::predecessor_account_id() == env::current_account_id(), "PRIVATE_CALLBACK");
        require!(self.recovery_amount > 0 && decimal64(&operationNonce) == self.recovery_nonce, "STALE_CALLBACK");
        require!(env::promise_results_count() == 1, "UNKNOWN_PROMISE_RESULT");
        let success = match env::promise_result_checked(0, 256) {
            Ok(_) => true,
            Err(PromiseError::Failed) => false,
            Err(_) => env::panic_str("UNKNOWN_PROMISE_RESULT"),
        };
        let t = &mut self.tokens[0];
        t.unclaimed_in_flight = sub(t.unclaimed_in_flight, self.recovery_amount);
        if success { t.unclaimed_withdrawn = add(t.unclaimed_withdrawn, self.recovery_amount); }
        else { t.unclaimed_held = add(t.unclaimed_held, self.recovery_amount); }
        self.conservation();
        self.recovery_event(if success { "unclaimed_withdrawal_succeeded" } else { "unclaimed_withdrawal_failed" });
        self.recovery_amount = 0;
        success
    }

    pub fn get_accounting(&self) -> Value {
        strict_input::<EmptyArgs>();
        self.conservation();
        json!({"receivedPrincipalYocto": self.received.to_string(), "confirmedPaidYocto": self.confirmed_paid.to_string(),
            "inFlightPrincipalYocto": self.in_flight.to_string(), "failedHeldPrincipalYocto": self.failed_held.to_string(),
            "lockedPrincipalYocto": self.locked.to_string(), "refundedPrincipalYocto": self.refunded.to_string(),
            "permanentStorageBondsYocto": self.storage_bonds.to_string(), "authenticationDepositsYocto": self.auth_deposits.to_string(),
            "requestCount": self.request_count.to_string(), "runtimeStorageBytes": env::storage_usage().to_string(),
            "tokens": self.tokens.iter().map(|t| json!({"assetId": format!("nep141:{}", t.account_id),
                "received": t.received.to_string(), "confirmedPaid": t.confirmed_paid.to_string(),
                "inFlight": t.in_flight.to_string(), "failedHeld": t.failed_held.to_string(),
                "locked": t.locked.to_string(), "refunded": t.refunded.to_string(),
                "unclaimedHeld": t.unclaimed_held.to_string(), "unclaimedInFlight": t.unclaimed_in_flight.to_string(),
                "unclaimedWithdrawn": t.unclaimed_withdrawn.to_string(), "routerReceived": t.router_received.to_string()})).collect::<Vec<_>>(),
            "runtimeStorageCostYocto": storage_cost(env::storage_usage()).to_string(),
            "runtimeAccountBalanceYocto": env::account_balance().as_yoctonear().to_string(),
            "recovery": {"operationNonce":self.recovery_nonce.to_string(), "amount":self.recovery_amount.to_string(),
                "receiver":String::from_utf8_lossy(&self.recovery_receiver[..self.recovery_receiver_len as usize]),
                "inFlight":self.recovery_amount > 0},
            "inFlightMayAlreadyHaveTransferred": true})
    }
}

impl Payments {
    fn recovery_event(&self, name: &str) {
        env::log_str(&format!("EVENT_JSON:{}", json!({"standard":"taply","version":"0.4.0","event":name,
            "data":[{"operationNonce":self.recovery_nonce.to_string(),"amount":self.recovery_amount.to_string(),
            "receiver":String::from_utf8_lossy(&self.recovery_receiver[..self.recovery_receiver_len as usize]),"token":USDC}]})));
    }

    // Fixed-size accounting only on rejection: no attacker-controlled storage allocation.
    // Runtime gas/deserialization failure remains a release blocker; see docs/MAINNET.md.
    fn router_delivery(&mut self, amount: u128, msg: &str) -> PromiseOrValue<U128> {
        let parsed = if msg.len() <= 1024 { near_sdk::serde_json::from_str::<FtMessage>(msg).ok() } else { None };
        let mut id: Option<String> = None;
        let mut candidate = None;
        let mut reason = "INVALID_MESSAGE";
        if let Some(m) = parsed {
            let valid_hash = |s: &str| s.len() == 64 && s.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b));
            if valid_hash(&m.id) && valid_hash(&m.expected_terms_hash) {
                id = Some(m.id.clone());
                if let Some(r) = read(&m.id) {
                    reason = if m.action != "pay_instant" || r.protected() { "WRONG_MODE" }
                    else if m.accepted_cancel_duration_ns.is_some() || m.consent_version.is_some() { "INVALID_MESSAGE" }
                    else if hex(&r.terms_hash) != m.expected_terms_hash { "WRONG_HASH" }
                    else if r.terms.asset_id != format!("nep141:{USDC}") { "WRONG_ASSET" }
                    else if r.status != Status::Open { "NOT_OPEN" }
                    else if r.terms.permitted_payer_account_id.as_ref().is_some_and(|p| p != &self.router) { "WRONG_PAYER" }
                    else if amount < r.amount() { "UNDERPAYMENT" }
                    else if env::prepaid_gas().as_gas().saturating_sub(env::used_gas().as_gas()) < FT_ON_TRANSFER_GAS.as_gas() { "LOW_GAS" }
                    else if env::account_balance().as_yoctonear() < storage_cost(env::storage_usage()).saturating_add(self.failed_held).saturating_add(self.locked).saturating_add(1) { "LOW_LIQUIDITY" }
                    else { "SURPLUS" };
                    if reason == "SURPLUS" { candidate = Some(r); }
                } else { reason = "UNKNOWN_REQUEST"; }
            }
        }
        let principal = candidate.as_ref().map_or(0, Record::amount);
        let unclaimed = amount - principal;
        let t = &mut self.tokens[0];
        t.received = add(t.received, amount);
        t.router_received = add(t.router_received, amount);
        t.unclaimed_held = add(t.unclaimed_held, unclaimed);
        t.in_flight = add(t.in_flight, principal);
        if unclaimed > 0 {
            env::log_str(&format!("EVENT_JSON:{}", json!({"standard":"taply","version":"0.4.0","event":"router_unclaimed",
                "data":[{"id":id,"token":USDC,"reason":reason,"amount":unclaimed.to_string()}]})));
        }
        if let Some(mut r) = candidate {
            record_payer(&mut r, &self.router);
            r.branch = Branch::Recipient;
            let _payout = self.start_transfer(r);
        }
        self.conservation();
        PromiseOrValue::Value(U128(0))
    }

    fn start_transfer(&mut self, mut r: Record) -> Promise {
        r.nonce = inc(r.nonce);
        r.revision = inc(r.revision);
        r.started_at = env::block_timestamp();
        let kind = r.branch.kind(&r.terms.mode);
        r.status = match kind {
            "INSTANT_PAYOUT" => Status::InFlight,
            "PROTECTED_RELEASE" => Status::ReleaseInFlight,
            _ => Status::RefundInFlight,
        };
        self.conservation();
        save(&r);
        event(
            if kind == "PROTECTED_REFUND" {
                "refund_started"
            } else {
                "payout_started"
            },
            &r,
        );
        let transfer = match nep141_token(&r.terms.asset_id) {
            None => Promise::new(r.destination()).transfer(NearToken::from_yoctonear(r.amount())),
            // NEP-141 requires exactly 1 yoctoNEAR on ft_transfer; it comes from the contract.
            Some(token) => Promise::new(token).function_call(
                "ft_transfer".to_owned(),
                near_sdk::serde_json::to_vec(&json!({"receiver_id": r.destination(),
                    "amount": r.terms.amount_base_units, "memo": "Taply settlement"}))
                .unwrap(),
                NearToken::from_yoctonear(1),
                FT_TRANSFER_GAS,
            ),
        };
        transfer.then(
            Promise::new(env::current_account_id()).function_call(
                "on_native_transfer_complete".to_owned(),
                near_sdk::serde_json::to_vec(&json!({"id": r.terms.id,
                    "operationNonce": r.nonce.to_string(), "kind": kind}))
                .unwrap(),
                NearToken::from_yoctonear(0),
                CALLBACK_GAS,
            ),
        )
    }
    fn require_asset(&self, asset: &str) {
        if asset != NATIVE {
            require!(
                self.tokens
                    .iter()
                    .any(|t| format!("nep141:{}", t.account_id) == asset),
                "TOKEN_DISABLED"
            );
        }
    }
    fn slot(&mut self, asset: &str, f: F) -> &mut u128 {
        if asset == NATIVE {
            return match f {
                F::Received => &mut self.received,
                F::Paid => &mut self.confirmed_paid,
                F::InFlight => &mut self.in_flight,
                F::Failed => &mut self.failed_held,
                F::Locked => &mut self.locked,
                F::Refunded => &mut self.refunded,
            };
        }
        let t = self
            .tokens
            .iter_mut()
            .find(|t| format!("nep141:{}", t.account_id) == asset)
            .unwrap_or_else(|| env::panic_str("TOKEN_DISABLED"));
        match f {
            F::Received => &mut t.received,
            F::Paid => &mut t.confirmed_paid,
            F::InFlight => &mut t.in_flight,
            F::Failed => &mut t.failed_held,
            F::Locked => &mut t.locked,
            F::Refunded => &mut t.refunded,
        }
    }
    fn credit(&mut self, asset: &str, f: F, amount: u128) {
        let s = self.slot(asset, f);
        *s = add(*s, amount);
    }
    fn mv(&mut self, asset: &str, from: F, to: F, amount: u128) {
        let a = self.slot(asset, from);
        *a = sub(*a, amount);
        let b = self.slot(asset, to);
        *b = add(*b, amount);
    }
    fn conservation(&self) {
        for t in &self.tokens {
            require!(
                t.received
                    == add(
                        add(t.confirmed_paid, t.refunded),
                        add(add(add(t.failed_held, t.in_flight), t.locked), add(add(t.unclaimed_held, t.unclaimed_in_flight), t.unclaimed_withdrawn))
                    ),
                "CONSERVATION_FAILURE"
            );
        }
        require!(
            self.received
                == add(
                    add(self.confirmed_paid, self.refunded),
                    add(add(self.failed_held, self.in_flight), self.locked)
                ),
            "CONSERVATION_FAILURE"
        );
    }
    fn check_liquidity(&self, outgoing: u128) {
        let required = add(
            storage_cost(env::storage_usage()),
            add(add(self.failed_held, self.locked), outgoing),
        );
        require!(
            env::account_balance().as_yoctonear() >= required,
            "INSUFFICIENT_OPERATIONAL_LIQUIDITY"
        );
    }
}
/// Shared funding guards for both modes: OPEN, unexpired by chain time and the
/// optional payer restriction. Returns the payer.
const NATIVE: &str = "near:native";
/// Outgoing NEAR for the liquidity guard: token payouts move tokens, not NEAR.
fn native_outgoing(r: &Record) -> u128 {
    if r.terms.asset_id == NATIVE {
        r.amount()
    } else {
        0
    }
}
fn fundable(r: &Record, payer: AccountId) -> AccountId {
    require!(r.status == Status::Open, "NOT_OPEN");
    require!(
        env::block_timestamp() < decimal64(&r.terms.funding_expires_at_ns),
        "FUNDING_EXPIRED"
    );
    require!(
        r.terms
            .permitted_payer_account_id
            .as_ref()
            .is_none_or(|p| *p == payer),
        "WRONG_PAYER"
    );
    payer
}
fn record_payer(r: &mut Record, payer: &near_sdk::AccountId) {
    r.payer[..payer.as_str().len()].copy_from_slice(payer.as_bytes());
    r.payer_len = payer.as_str().len() as u8;
    r.funded_at = env::block_timestamp();
}
fn direct() {
    require!(
        env::signer_account_id() == env::predecessor_account_id()
            && env::predecessor_account_id() != env::current_account_id(),
        "DIRECT_WALLET_ONLY"
    );
}
fn one_yocto() {
    require!(
        env::attached_deposit().as_yoctonear() == 1,
        "ONE_YOCTO_REQUIRED"
    );
}
fn gas_at_least(gas: Gas) {
    require!(env::prepaid_gas() >= gas, "INSUFFICIENT_PREPAID_GAS");
}
fn add(a: u128, b: u128) -> u128 {
    a.checked_add(b)
        .unwrap_or_else(|| env::panic_str("ACCOUNTING_OVERFLOW"))
}
fn sub(a: u128, b: u128) -> u128 {
    a.checked_sub(b)
        .unwrap_or_else(|| env::panic_str("ACCOUNTING_UNDERFLOW"))
}
fn inc(n: u64) -> u64 {
    n.checked_add(1)
        .unwrap_or_else(|| env::panic_str("COUNTER_OVERFLOW"))
}
fn key(id: &str) -> Vec<u8> {
    let mut k = vec![b'r'];
    k.extend_from_slice(&hash_bytes(id));
    k
}
fn storage_bytes(r: &Record) -> u64 {
    33 + borsh::to_vec(r).unwrap().len() as u64 + RECORD_OVERHEAD
}
fn storage_cost(bytes: u64) -> u128 {
    u128::from(bytes)
        .checked_mul(env::storage_byte_cost().as_yoctonear())
        .unwrap()
}
fn read(id: &str) -> Option<Record> {
    env::storage_read(&key(id)).map(|b| borsh::from_slice(&b).unwrap())
}
fn load(id: &str) -> Record {
    read(id).unwrap_or_else(|| env::panic_str("REQUEST_NOT_FOUND"))
}
fn load_matching(id: &str, hash: &str) -> Record {
    let r = load(id);
    require!(hash_bytes(hash) == r.terms_hash, "TERMS_HASH_MISMATCH");
    r
}
fn save(r: &Record) {
    let k = key(&r.terms.id);
    let previous = env::storage_read(&k).unwrap();
    let next = borsh::to_vec(r).unwrap();
    require!(previous.len() == next.len(), "STORAGE_GROWTH_FORBIDDEN");
    env::storage_write(&k, &next);
}
fn event(name: &str, r: &Record) {
    env::log_str(&format!(
        "EVENT_JSON:{}",
        json!({"standard": "taply", "version": "0.4.0", "event": name,
        "data": [{"id": r.terms.id, "termsHash": hex(&r.terms_hash), "status": r.status.wire(),
            "revision": r.revision.to_string(), "operationNonce": r.nonce.to_string()}]})
    ));
}

#[cfg(test)]
mod mainnet_tests;
