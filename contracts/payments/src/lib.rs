// The SDK also generates camelCase argument fields outside the impl block.
#![allow(non_snake_case)]
pub mod model;

use model::*;
use near_sdk::borsh;
use near_sdk::serde_json::{Value, json};
use near_sdk::{Gas, NearToken, PanicOnDefault, Promise, PromiseError, env, near, require};

const CALLBACK_GAS: Gas = Gas::from_tgas(15);
const PAY_GAS: Gas = Gas::from_tgas(50);
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
    storage_bonds: u128,
    auth_deposits: u128,
    request_count: u64,
}

#[near]
#[allow(non_snake_case)] // Frozen camelCase JSON argument names.
impl Payments {
    #[init]
    #[private]
    pub fn new() -> Self {
        strict_input::<EmptyArgs>();
        require!(
            env::predecessor_account_id() == env::current_account_id(),
            "PRIVATE_INIT"
        );
        Self {
            received: 0,
            confirmed_paid: 0,
            in_flight: 0,
            failed_held: 0,
            storage_bonds: 0,
            auth_deposits: 0,
            request_count: 0,
        }
    }

    pub fn get_config(&self) -> Value {
        strict_input::<EmptyArgs>();
        json!({"schemaVersion": "taply.contract-config.v1", "contractVersion": "0.4.0",
            "network": "near-testnet", "contractId": env::current_account_id(),
            "intentVersion": "taply.intent.v1", "eventVersion": "0.4.0",
            "capabilities": {"instantNative": true, "protectedPay": false, "handshake": false,
                "merchantProfiles": false, "nep141": false, "sponsoredGas": false},
            "quoteVersion": QUOTE_VERSION, "storageByteCostYocto": env::storage_byte_cost().as_yoctonear().to_string(),
            "gas": {"createRequest": CREATE_GAS.as_gas().to_string(), "payInstantNative": PAY_GAS.as_gas().to_string(),
                "retryNativeTransfer": PAY_GAS.as_gas().to_string(), "cancelUnfunded": CANCEL_GAS.as_gas().to_string(),
                "callback": CALLBACK_GAS.as_gas().to_string()},
            "storageRefundPolicy": "PERMANENT_RECORD_NO_WITHDRAWAL",
            "unknownCallbackPolicy": "IN_FLIGHT_NO_RETRY_NO_ADMIN_OVERRIDE",
            "testFaultBuild": cfg!(feature = "sandbox-fail-callback")})
    }

    pub fn quote_create_request(&self, terms: IntentTerms) -> Value {
        strict_input::<QuoteArgs>();
        terms.validate();
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
            matches!(r.status, Status::Paid | Status::Cancelled).then(|| json!({
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
        require!(r.status == Status::Open, "NOT_OPEN");
        require!(
            env::block_timestamp() < decimal64(&r.terms.funding_expires_at_ns),
            "FUNDING_EXPIRED"
        );
        let payer = env::predecessor_account_id();
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
        r.payer[..payer.as_str().len()].copy_from_slice(payer.as_bytes());
        r.payer_len = payer.as_str().len() as u8;
        r.funded_at = env::block_timestamp();
        self.start_transfer(r)
    }

    #[payable]
    pub fn retry_native_transfer(&mut self, id: String, expectedOperationNonce: String) -> Promise {
        strict_input::<RetryArgs>();
        direct();
        one_yocto();
        gas_at_least(PAY_GAS);
        let mut r = load(&id);
        require!(r.status == Status::Failed, "NO_RECORDED_TRANSFER_FAILURE");
        require!(
            env::predecessor_account_id() == r.terms.creator_account_id,
            "RECIPIENT_ONLY"
        );
        require!(
            decimal64(&expectedOperationNonce) == r.nonce,
            "OPERATION_NONCE_MISMATCH"
        );
        // Check all failed obligations before removing this one from the held pool.
        self.check_liquidity(0);
        self.failed_held = sub(self.failed_held, r.amount());
        self.in_flight = add(self.in_flight, r.amount());
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
        require!(kind == "INSTANT_PAYOUT", "WRONG_OPERATION_KIND");
        let mut r = load(&id);
        require!(
            r.status == Status::InFlight && r.nonce == decimal64(&operationNonce),
            "STALE_CALLBACK"
        );
        require!(env::promise_results_count() == 1, "UNKNOWN_PROMISE_RESULT");
        // Native Transfer returns empty bytes. TooLong/unknown is NOT Failed.
        let success = match env::promise_result_checked(0, 0) {
            Ok(_) => true,
            Err(PromiseError::Failed) => false,
            Err(_) => env::panic_str("UNKNOWN_PROMISE_RESULT"),
        };
        // A distinct test-only WASM proves real transfer-success/callback-panic
        // behavior without any production admin/fault-injection method.
        if cfg!(feature = "sandbox-fail-callback") {
            env::panic_str("SANDBOX_CALLBACK_FAULT");
        }
        self.in_flight = sub(self.in_flight, r.amount());
        if success {
            self.confirmed_paid = add(self.confirmed_paid, r.amount());
            r.status = Status::Paid;
            r.terminal_at = env::block_timestamp();
            r.terminal_height = env::block_height();
        } else {
            self.failed_held = add(self.failed_held, r.amount());
            r.status = Status::Failed;
        }
        r.resolved_at = env::block_timestamp();
        r.revision = inc(r.revision);
        self.conservation();
        save(&r);
        event(
            if success {
                "payout_succeeded"
            } else {
                "payout_failed"
            },
            &r,
        );
        success
    }

    pub fn get_accounting(&self) -> Value {
        strict_input::<EmptyArgs>();
        self.conservation();
        json!({"receivedPrincipalYocto": self.received.to_string(), "confirmedPaidYocto": self.confirmed_paid.to_string(),
            "inFlightPrincipalYocto": self.in_flight.to_string(), "failedHeldPrincipalYocto": self.failed_held.to_string(),
            "permanentStorageBondsYocto": self.storage_bonds.to_string(), "authenticationDepositsYocto": self.auth_deposits.to_string(),
            "requestCount": self.request_count.to_string(), "runtimeStorageBytes": env::storage_usage().to_string(),
            "runtimeStorageCostYocto": storage_cost(env::storage_usage()).to_string(),
            "runtimeAccountBalanceYocto": env::account_balance().as_yoctonear().to_string(),
            "inFlightMayAlreadyHaveTransferred": true})
    }
}

impl Payments {
    fn start_transfer(&mut self, mut r: Record) -> Promise {
        r.nonce = inc(r.nonce);
        r.revision = inc(r.revision);
        r.started_at = env::block_timestamp();
        r.status = Status::InFlight;
        self.conservation();
        save(&r);
        event("payout_started", &r);
        Promise::new(r.terms.creator_account_id.clone())
            .transfer(NearToken::from_yoctonear(r.amount()))
            .then(
                Promise::new(env::current_account_id()).function_call(
                    "on_native_transfer_complete".to_owned(),
                    near_sdk::serde_json::to_vec(&json!({"id": r.terms.id,
                    "operationNonce": r.nonce.to_string(), "kind": "INSTANT_PAYOUT"}))
                    .unwrap(),
                    NearToken::from_yoctonear(0),
                    CALLBACK_GAS,
                ),
            )
    }
    fn conservation(&self) {
        require!(
            self.received == add(self.confirmed_paid, add(self.failed_held, self.in_flight)),
            "CONSERVATION_FAILURE"
        );
    }
    fn check_liquidity(&self, outgoing: u128) {
        let required = add(
            storage_cost(env::storage_usage()),
            add(self.failed_held, outgoing),
        );
        require!(
            env::account_balance().as_yoctonear() >= required,
            "INSUFFICIENT_OPERATIONAL_LIQUIDITY"
        );
    }
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
mod tests;
