use anyhow::Result;
use near_jsonrpc_client::{JsonRpcClient, methods};
use near_primitives::{
    hash::CryptoHash,
    views::{
        ActionView, FinalExecutionOutcomeViewEnum, FinalExecutionOutcomeWithReceiptView,
        ReceiptEnumView, TxExecutionStatus,
    },
};
use near_workspaces::{
    Account, Contract, Worker,
    network::Sandbox,
    types::{Gas, NearToken},
};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

const PRINCIPAL: u128 = 1_000_000_000_000_000_000_000_000;
const GAS: Gas = Gas::from_tgas(50);
fn merchant_build() -> bool {
    assert_eq!(std::env::var("TAPLY_SANDBOX_MERCHANT_V1").as_deref(), Ok("1"));
    true
}
fn digest(domain: &str, bytes: &str) -> String {
    format!("{:x}", Sha256::digest(format!("{domain}\n{bytes}")))
}
fn canonical(v: &Value) -> String {
    if let Value::Object(m) = v {
        let mut keys: Vec<_> = m.keys().collect();
        keys.sort(); // Frozen protocol keys are ASCII.
        format!(
            "{{{}}}",
            keys.into_iter()
                .map(|k| format!("{}:{}", serde_json::to_string(k).unwrap(), canonical(&m[k])))
                .collect::<Vec<_>>()
                .join(",")
        )
    } else {
        v.to_string()
    }
}
fn hash(t: &Value) -> String {
    digest("taply.terms.v1", &canonical(t))
}
async fn terms(w: &Worker<Sandbox>, c: &Contract, recipient: &Account, n: u64) -> Result<Value> {
    let now = w.view_block().await?.timestamp();
    let identity = json!({"contractId": c.id(), "creationNonce": format!("{n:064x}"), "creatorAccountId": recipient.id(), "network": "near-testnet"});
    let mut t = json!({"schemaVersion":"taply.intent.v1", "id":digest("taply.id.v1", &canonical(&identity)),
        "network":"near-testnet", "contractId":c.id(), "creationNonce":format!("{n:064x}"),
        "creatorAccountId":recipient.id(), "assetId":"near:native", "amountBaseUnits":PRINCIPAL.to_string(),
        "mode":"instant", "cancelDurationNs":null, "fundingExpiresAtNs":(now + 86_000_000_000_000u64).to_string(),
        "permittedPayerAccountId":null, "merchantAccountId":null, "memo":"", "sessionBinding":null});
    if merchant_build() {
        t["merchantAccountId"] = json!(recipient.id());
        t["sessionBinding"] = json!({"id":format!("11111111-1111-4111-8111-{n:012x}"),
            "nonce":format!("{n:064x}"), "expiresAtNs":(now + 120_000_000_000u64).to_string()});
    }
    Ok(t)
}
async fn setup(fault: bool) -> Result<(Worker<Sandbox>, Contract, Account, Account)> {
    let w = near_workspaces::sandbox().await?;
    let directory = if merchant_build() {
        "../artifacts/merchant-v1"
    } else {
        "../artifacts"
    };
    let path = format!(
        "{directory}/{}",
        if fault {
            "payments.callback-fault.wasm"
        } else {
            "payments.wasm"
        }
    );
    let c = w.dev_deploy(&std::fs::read(path)?).await?;
    c.call("new")
        .args_json(json!({}))
        .max_gas()
        .transact()
        .await?
        .into_result()?;
    let merchant = w.dev_create_account().await?;
    let payer = w.dev_create_account().await?;
    Ok((w, c, merchant, payer))
}
/// `transact()` returns at EXECUTED_OPTIMISTIC, which by definition excludes gas-refund
/// receipts. The signer's refund can therefore land after a test snapshots its balance
/// (observed: +0.0306 NEAR on the recipient during the pay window). Wait for FINAL, which
/// includes refund receipts, so later balance deltas contain only the measured transaction.
async fn settle(
    w: &Worker<Sandbox>,
    signer: &Account,
    tx: near_workspaces::CryptoHash,
) -> Result<methods::tx_status::RpcTransactionResponse> {
    let client = JsonRpcClient::connect(w.rpc_addr());
    let mut last = String::new();
    for _ in 0..20 {
        let status = client
            .call(methods::tx_status::RpcTransactionStatusRequest {
                transaction_info: methods::tx_status::TransactionInfo::TransactionId {
                    tx_hash: CryptoHash(tx.0),
                    sender_account_id: signer.id().clone(),
                },
                wait_until: TxExecutionStatus::Final,
            })
            .await;
        match status {
            Ok(r) if matches!(r.final_execution_status, TxExecutionStatus::Final) => return Ok(r),
            Ok(r) => last = format!("{:?}", r.final_execution_status),
            Err(e) => last = format!("{e:?}"),
        }
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
    }
    anyhow::bail!(
        "transaction {} never reached FINAL: {last}",
        CryptoHash(tx.0)
    )
}
async fn settle_result(
    w: &Worker<Sandbox>,
    signer: &Account,
    r: &near_workspaces::result::ExecutionFinalResult,
) -> Result<()> {
    settle(w, signer, r.outcome().transaction_hash).await?;
    Ok(())
}
/// FINAL outcome of a transaction together with every receipt it produced (`tx_status`).
async fn finalized(
    w: &Worker<Sandbox>,
    signer: &Account,
    r: &near_workspaces::result::ExecutionFinalResult,
) -> Result<FinalExecutionOutcomeWithReceiptView> {
    match settle(w, signer, r.outcome().transaction_hash)
        .await?
        .final_execution_outcome
    {
        Some(FinalExecutionOutcomeViewEnum::FinalExecutionOutcomeWithReceipt(v)) => Ok(v),
        other => anyhow::bail!("tx_status returned no receipts: {other:?}"),
    }
}
/// Tokens the signer paid for gas: burnt by the transaction conversion and by every receipt
/// it spawned. Unused prepaid gas comes back to the signer in refund receipts, which burn 0.
fn burnt(v: &FinalExecutionOutcomeWithReceiptView) -> u128 {
    std::iter::once(&v.final_outcome.transaction_outcome)
        .chain(&v.final_outcome.receipts_outcome)
        .map(|o| o.outcome.tokens_burnt.as_yoctonear())
        .sum()
}
/// Transfer deposits that `v`'s receipts deliver to `to` from anyone except `system`
/// (the runtime account that sends gas and deposit refunds).
fn transfers_to(v: &FinalExecutionOutcomeWithReceiptView, to: &Account) -> Vec<(String, u128)> {
    v.receipts
        .iter()
        .filter(|r| r.receiver_id == *to.id() && r.predecessor_id.as_str() != "system")
        .flat_map(|r| match &r.receipt {
            ReceiptEnumView::Action { actions, .. } => actions
                .iter()
                .filter_map(|a| match a {
                    ActionView::Transfer { deposit } => {
                        Some((r.predecessor_id.to_string(), deposit.as_yoctonear()))
                    }
                    _ => None,
                })
                .collect(),
            _ => vec![],
        })
        .collect()
}
async fn create(w: &Worker<Sandbox>, c: &Contract, merchant: &Account, t: &Value) -> Result<Value> {
    let q: Value = c
        .view("quote_create_request")
        .args_json(json!({"terms":t}))
        .await?
        .json()?;
    let r = merchant
        .call(c.id(), "create_request")
        .args_json(json!({"terms":t,"quoteVersion":"1"}))
        .deposit(NearToken::from_yoctonear(
            q["depositYocto"].as_str().unwrap().parse()?,
        ))
        .gas(Gas::from_tgas(30))
        .transact()
        .await?;
    println!(
        "MEASURE create gas={} quote={q}",
        r.total_gas_burnt.as_gas()
    );
    let tx = r.into_result()?.outcome().transaction_hash;
    let optimistic = merchant.view_account().await?.balance.as_yoctonear();
    settle(w, merchant, tx).await?;
    let settled = merchant.view_account().await?.balance.as_yoctonear();
    // Diagnostic only: signer gas refund that arrived after transact() returned.
    println!(
        "MEASURE create late_refund_to_signer={}",
        settled as i128 - optimistic as i128
    );
    Ok(q)
}
async fn request(c: &Contract, t: &Value) -> Result<Value> {
    let state: Value = c
        .view("get_request")
        .args_json(json!({"id":t["id"]}))
        .await?
        .json()?;
    std::fs::create_dir_all("../artifacts/requests")?;
    std::fs::write(
        format!(
            "../artifacts/requests/{}-{}.json",
            t["id"].as_str().unwrap(),
            state["revision"].as_str().unwrap()
        ),
        serde_json::to_vec_pretty(&state)?,
    )?;
    Ok(state)
}
async fn accounting(c: &Contract) -> Result<Value> {
    let a: Value = c
        .view("get_accounting")
        .args_json(json!({}))
        .await?
        .json()?;
    let n = |k: &str| a[k].as_str().unwrap().parse::<u128>().unwrap();
    assert_eq!(
        n("receivedPrincipalYocto"),
        n("confirmedPaidYocto") + n("inFlightPrincipalYocto") + n("failedHeldPrincipalYocto")
    );
    assert!(
        n("runtimeAccountBalanceYocto")
            >= n("runtimeStorageCostYocto") + n("failedHeldPrincipalYocto")
    );
    Ok(a)
}
fn pay_args(t: &Value) -> Value {
    json!({"id":t["id"], "expectedTermsHash":hash(t)})
}
async fn pay(
    c: &Contract,
    payer: &Account,
    t: &Value,
) -> Result<near_workspaces::result::ExecutionFinalResult> {
    Ok(payer
        .call(c.id(), "pay_instant_native")
        .args_json(pay_args(t))
        .deposit(NearToken::from_yoctonear(PRINCIPAL))
        .gas(GAS)
        .transact()
        .await?)
}

#[tokio::test]
async fn actual_transfer_callback_receipts_and_conservation() -> Result<()> {
    let (w, c, merchant, payer) = setup(false).await?;
    let t = terms(&w, &c, &merchant, 1).await?;
    let q = create(&w, &c, &merchant, &t).await?;
    let before = merchant.view_account().await?.balance.as_yoctonear();
    let a0 = accounting(&c).await?;
    let r = pay(&c, &payer, &t).await?;
    println!(
        "MEASURE pay total_gas={} receipts={:?}",
        r.total_gas_burnt.as_gas(),
        r.receipt_outcomes()
    );
    assert!(r.is_success());
    assert!(r.receipt_failures().is_empty());
    assert_eq!(
        merchant.view_account().await?.balance.as_yoctonear() - before,
        PRINCIPAL
    );
    let state = request(&c, &t).await?;
    assert_eq!(state["status"], "FINAL_PAID");
    assert_eq!(state["latestOperation"]["status"], "SUCCEEDED");
    let facts: Value = c
        .view("get_receipt")
        .args_json(json!({"id":t["id"]}))
        .await?
        .json()?;
    assert_eq!(facts["payoutConfirmed"], true);
    assert_eq!(facts["evidenceKind"], "CONTRACT_FACTS_NOT_FINALITY_PROOF");
    let a = accounting(&c).await?;
    assert_eq!(a["confirmedPaidYocto"], PRINCIPAL.to_string());
    assert_eq!(a["permanentStorageBondsYocto"], q["depositYocto"]);
    assert_eq!(a["runtimeStorageBytes"], a0["runtimeStorageBytes"]);
    let duplicate = pay(&c, &payer, &t).await?;
    assert!(duplicate.is_failure());
    assert_eq!(
        merchant.view_account().await?.balance.as_yoctonear() - before,
        PRINCIPAL
    );
    assert_eq!(request(&c, &t).await?, state);
    let unauthorized = payer
        .call(c.id(), "on_native_transfer_complete")
        .args_json(json!({"id":t["id"],"operationNonce":"1","kind":"INSTANT_PAYOUT"}))
        .max_gas()
        .transact()
        .await?;
    assert!(unauthorized.is_failure());
    accounting(&c).await?;
    Ok(())
}

#[tokio::test]
async fn transfer_failure_refund_then_recipient_retry_succeeds() -> Result<()> {
    let (w, c, _, payer) = setup(false).await?;
    let root = w.root_account()?;
    let merchant = root
        .create_subaccount("recipient")
        .initial_balance(NearToken::from_near(10))
        .transact()
        .await?
        .into_result()?;
    let t = terms(&w, &c, &merchant, 2).await?;
    create(&w, &c, &merchant, &t).await?;
    merchant.delete_account(root.id()).await?.into_result()?;
    let outcome = pay(&c, &payer, &t).await?;
    println!(
        "MEASURE failed payout gas={}",
        outcome.total_gas_burnt.as_gas()
    );
    assert!(!outcome.receipt_failures().is_empty());
    assert_eq!(
        request(&c, &t).await?["status"],
        "PAYOUT_FAILED_RECOVERABLE"
    );
    assert_eq!(
        accounting(&c).await?["failedHeldPrincipalYocto"],
        PRINCIPAL.to_string()
    );
    let wrong = payer
        .call(c.id(), "retry_native_transfer")
        .args_json(json!({"id":t["id"],"expectedOperationNonce":"1"}))
        .deposit(NearToken::from_yoctonear(1))
        .gas(GAS)
        .transact()
        .await?;
    assert!(wrong.is_failure());
    let restored = root
        .create_subaccount("recipient")
        .initial_balance(NearToken::from_near(10))
        .transact()
        .await?
        .into_result()?;
    let stale = restored
        .call(c.id(), "retry_native_transfer")
        .args_json(json!({"id":t["id"],"expectedOperationNonce":"2"}))
        .deposit(NearToken::from_yoctonear(1))
        .gas(GAS)
        .transact()
        .await?;
    assert!(stale.is_failure());
    let retry = restored
        .call(c.id(), "retry_native_transfer")
        .args_json(json!({"id":t["id"],"expectedOperationNonce":"1"}))
        .deposit(NearToken::from_yoctonear(1))
        .gas(GAS)
        .transact()
        .await?;
    println!("MEASURE retry gas={}", retry.total_gas_burnt.as_gas());
    assert!(retry.is_success());
    let state = request(&c, &t).await?;
    assert_eq!(state["status"], "FINAL_PAID");
    assert_eq!(state["latestOperation"]["nonce"], "2");
    assert_eq!(accounting(&c).await?["failedHeldPrincipalYocto"], "0");
    assert!(pay(&c, &payer, &t).await?.is_failure());
    Ok(())
}

#[tokio::test]
async fn actual_successful_transfer_with_panicking_callback_never_retries() -> Result<()> {
    let (w, c, merchant, payer) = setup(true).await?;
    let t = terms(&w, &c, &merchant, 3).await?;
    create(&w, &c, &merchant, &t).await?;
    let before = merchant.view_account().await?.balance.as_yoctonear();
    let result = pay(&c, &payer, &t).await?;
    assert!(result.is_failure());
    assert_eq!(
        merchant.view_account().await?.balance.as_yoctonear() - before,
        PRINCIPAL
    );
    assert_eq!(request(&c, &t).await?["status"], "PAYOUT_IN_FLIGHT");
    let facts: Value = c
        .view("get_receipt")
        .args_json(json!({"id":t["id"]}))
        .await?
        .json()?;
    assert!(facts.is_null());
    for _ in 0..2 {
        let retry = merchant
            .call(c.id(), "retry_native_transfer")
            .args_json(json!({"id":t["id"],"expectedOperationNonce":"1"}))
            .deposit(NearToken::from_yoctonear(1))
            .gas(GAS)
            .transact()
            .await?;
        assert!(retry.is_failure());
        assert!(pay(&c, &payer, &t).await?.is_failure());
    }
    let a = accounting(&c).await?;
    assert_eq!(a["confirmedPaidYocto"], "0");
    assert_eq!(a["inFlightPrincipalYocto"], PRINCIPAL.to_string());
    assert_eq!(a["failedHeldPrincipalYocto"], "0");
    Ok(())
}

#[tokio::test]
async fn rejected_deposits_are_refunded_and_invalid_wire_fails_closed() -> Result<()> {
    let (w, c, merchant, payer) = setup(false).await?;
    let t = terms(&w, &c, &merchant, 4).await?;
    create(&w, &c, &merchant, &t).await?;
    let initial = request(&c, &t).await?;
    for amount in [0, PRINCIPAL - 1, PRINCIPAL + 1] {
        let before = payer.view_account().await?.balance.as_yoctonear();
        let r = payer
            .call(c.id(), "pay_instant_native")
            .args_json(pay_args(&t))
            .deposit(NearToken::from_yoctonear(amount))
            .gas(GAS)
            .transact()
            .await?;
        assert!(r.is_failure());
        settle_result(&w, &payer, &r).await?;
        // Deposit is refunded. Only gas is spent (bounded well below principal).
        let spent = before - payer.view_account().await?.balance.as_yoctonear();
        assert!(spent < PRINCIPAL / 100, "deposit not refunded: {spent}");
        assert_eq!(request(&c, &t).await?, initial);
    }
    let bad_args = [
        format!(
            r#"{{"id":{},"expectedTermsHash":"{}","paid":true}}"#,
            t["id"],
            hash(&t)
        ),
        format!(
            r#"{{"id":{},"id":{},"expectedTermsHash":"{}"}}"#,
            t["id"],
            t["id"],
            hash(&t)
        ),
    ];
    for args in bad_args {
        assert!(
            payer
                .call(c.id(), "pay_instant_native")
                .args(args.into_bytes())
                .deposit(NearToken::from_yoctonear(PRINCIPAL))
                .gas(GAS)
                .transact()
                .await?
                .is_failure()
        );
    }
    assert!(
        payer
            .call(c.id(), "pay_instant_native")
            .args_json(pay_args(&t))
            .deposit(NearToken::from_yoctonear(PRINCIPAL))
            .gas(Gas::from_tgas(49))
            .transact()
            .await?
            .is_failure()
    );
    let q: Value = c
        .view("quote_create_request")
        .args_json(json!({"terms":terms(&w,&c,&merchant,5).await?}))
        .await?
        .json()?;
    let dup = merchant
        .call(c.id(), "create_request")
        .args_json(json!({"terms":t,"quoteVersion":"1"}))
        .deposit(NearToken::from_yoctonear(
            q["depositYocto"].as_str().unwrap().parse()?,
        ))
        .gas(Gas::from_tgas(30))
        .transact()
        .await?;
    assert!(dup.is_failure());
    for method in [
        "fund_protected_native",
        "cancel_protected",
        "release_protected",
        "ft_on_transfer",
        "set_paid",
        "withdraw",
    ] {
        assert!(
            payer
                .call(c.id(), method)
                .args_json(json!({}))
                .max_gas()
                .transact()
                .await?
                .is_failure()
        );
    }
    let cancelled = merchant
        .call(c.id(), "cancel_unfunded")
        .args_json(pay_args(&t))
        .deposit(NearToken::from_yoctonear(1))
        .gas(Gas::from_tgas(15))
        .transact()
        .await?;
    println!("MEASURE cancel gas={}", cancelled.total_gas_burnt.as_gas());
    cancelled.into_result()?;
    assert!(pay(&c, &payer, &t).await?.is_failure());
    assert_eq!(request(&c, &t).await?["status"], "CANCELLED_UNFUNDED");
    assert_eq!(accounting(&c).await?["receivedPrincipalYocto"], "0");
    Ok(())
}

#[tokio::test]
async fn competing_funders_and_other_held_obligations_conserve_principal() -> Result<()> {
    let (w, c, merchant, payer) = setup(false).await?;
    let payer2 = w.dev_create_account().await?;
    let root = w.root_account()?;
    let gone = root
        .create_subaccount("gone")
        .initial_balance(NearToken::from_near(10))
        .transact()
        .await?
        .into_result()?;
    let failed = terms(&w, &c, &gone, 6).await?;
    create(&w, &c, &gone, &failed).await?;
    gone.delete_account(root.id()).await?.into_result()?;
    assert!(
        !pay(&c, &payer, &failed)
            .await?
            .receipt_failures()
            .is_empty()
    );
    assert_eq!(
        request(&c, &failed).await?["status"],
        "PAYOUT_FAILED_RECOVERABLE"
    );
    let t = terms(&w, &c, &merchant, 7).await?;
    let mut t2 = terms(&w, &c, &merchant, 8).await?;
    t2["memo"] = json!("é".repeat(128));
    create(&w, &c, &merchant, &t).await?;
    create(&w, &c, &merchant, &t2).await?;
    let before = merchant.view_account().await?.balance.as_yoctonear();
    let (a, b) = tokio::join!(pay(&c, &payer, &t), pay(&c, &payer2, &t));
    let (a, b) = (a?, b?);
    assert_ne!(
        a.is_success(),
        b.is_success(),
        "Exactly one competing funding succeeds"
    );
    assert!(pay(&c, &payer, &t2).await?.is_success());
    assert_eq!(
        merchant.view_account().await?.balance.as_yoctonear() - before,
        PRINCIPAL * 2
    );
    assert_eq!(request(&c, &t).await?["status"], "FINAL_PAID");
    assert_eq!(request(&c, &t2).await?["status"], "FINAL_PAID");
    let a = accounting(&c).await?;
    assert_eq!(a["receivedPrincipalYocto"], (PRINCIPAL * 3).to_string());
    assert_eq!(a["confirmedPaidYocto"], (PRINCIPAL * 2).to_string());
    assert_eq!(a["failedHeldPrincipalYocto"], PRINCIPAL.to_string());
    assert_eq!(a["inFlightPrincipalYocto"], "0");
    Ok(())
}

#[tokio::test]
async fn self_signed_callback_without_promise_result_is_rejected() -> Result<()> {
    // The contract's own full-access key passes `#[private]` (predecessor ==
    // current account). Only the exactly-one-promise-result guard stops it.
    let (w, c, merchant, payer) = setup(true).await?;
    let t = terms(&w, &c, &merchant, 10).await?;
    create(&w, &c, &merchant, &t).await?;
    assert!(pay(&c, &payer, &t).await?.is_failure());
    let stuck = request(&c, &t).await?;
    assert_eq!(stuck["status"], "PAYOUT_IN_FLIGHT");
    let forged = c
        .call("on_native_transfer_complete")
        .args_json(json!({"id":t["id"],"operationNonce":"1","kind":"INSTANT_PAYOUT"}))
        .max_gas()
        .transact()
        .await?;
    assert!(forged.is_failure());
    let text = format!("{forged:?}");
    assert!(
        text.contains("UNKNOWN_PROMISE_RESULT"),
        "expected UNKNOWN_PROMISE_RESULT in: {text}"
    );
    assert_eq!(request(&c, &t).await?, stuck);
    let a = accounting(&c).await?;
    assert_eq!(a["inFlightPrincipalYocto"], PRINCIPAL.to_string());
    assert_eq!(a["confirmedPaidYocto"], "0");
    Ok(())
}

#[tokio::test]
async fn expired_or_unpermitted_funding_is_refunded_and_cancel_still_works() -> Result<()> {
    let (w, c, merchant, payer) = setup(false).await?;
    let other = w.dev_create_account().await?;
    // Restricted payer.
    let mut restricted = terms(&w, &c, &merchant, 11).await?;
    restricted["permittedPayerAccountId"] = json!(payer.id());
    create(&w, &c, &merchant, &restricted).await?;
    let before = other.view_account().await?.balance.as_yoctonear();
    let wrong = pay(&c, &other, &restricted).await?;
    assert!(wrong.is_failure());
    let text = format!("{wrong:?}");
    assert!(
        text.contains("WRONG_PAYER"),
        "expected WRONG_PAYER in: {text}"
    );
    settle_result(&w, &other, &wrong).await?;
    assert!(before - other.view_account().await?.balance.as_yoctonear() < PRINCIPAL / 100);
    assert_eq!(request(&c, &restricted).await?["status"], "OPEN");
    assert!(pay(&c, &payer, &restricted).await?.is_success());
    assert_eq!(request(&c, &restricted).await?["status"], "FINAL_PAID");

    // Short funding window, then advance real chain time past it.
    let mut short = terms(&w, &c, &merchant, 12).await?;
    let now = w.view_block().await?.timestamp();
    let expiry = now + 20_000_000_000;
    short["fundingExpiresAtNs"] = json!(expiry.to_string());
    if merchant_build() {
        short["sessionBinding"]["expiresAtNs"] = json!(expiry.to_string());
    }
    create(&w, &c, &merchant, &short).await?;
    while w.view_block().await?.timestamp() <= expiry {
        w.fast_forward(50).await?;
    }
    let before = payer.view_account().await?.balance.as_yoctonear();
    let late = pay(&c, &payer, &short).await?;
    assert!(late.is_failure());
    let text = format!("{late:?}");
    assert!(
        text.contains("FUNDING_EXPIRED"),
        "expected FUNDING_EXPIRED in: {text}"
    );
    settle_result(&w, &payer, &late).await?;
    assert!(before - payer.view_account().await?.balance.as_yoctonear() < PRINCIPAL / 100);
    assert_eq!(request(&c, &short).await?["status"], "OPEN");
    merchant
        .call(c.id(), "cancel_unfunded")
        .args_json(pay_args(&short))
        .deposit(NearToken::from_yoctonear(1))
        .gas(Gas::from_tgas(15))
        .transact()
        .await?
        .into_result()?;
    assert_eq!(request(&c, &short).await?["status"], "CANCELLED_UNFUNDED");
    let a = accounting(&c).await?;
    assert_eq!(a["receivedPrincipalYocto"], PRINCIPAL.to_string());
    assert_eq!(a["confirmedPaidYocto"], PRINCIPAL.to_string());
    Ok(())
}

#[tokio::test]
async fn retry_pays_exactly_once_and_cannot_be_replayed() -> Result<()> {
    let (w, c, _, payer) = setup(false).await?;
    let root = w.root_account()?;
    let merchant = root
        .create_subaccount("once")
        .initial_balance(NearToken::from_near(10))
        .transact()
        .await?
        .into_result()?;
    let t = terms(&w, &c, &merchant, 13).await?;
    create(&w, &c, &merchant, &t).await?;
    merchant.delete_account(root.id()).await?.into_result()?;
    assert!(!pay(&c, &payer, &t).await?.receipt_failures().is_empty());
    assert_eq!(
        request(&c, &t).await?["status"],
        "PAYOUT_FAILED_RECOVERABLE"
    );
    let restored = root
        .create_subaccount("once")
        .initial_balance(NearToken::from_near(10))
        .transact()
        .await?
        .into_result()?;
    let balance =
        async || -> Result<u128> { Ok(restored.view_account().await?.balance.as_yoctonear()) };
    let start = balance().await?;
    // Each retry is settled to FINAL before and after, so a balance delta contains exactly one
    // transaction: its finalized receipts are the whole explanation of the delta, with no
    // tolerance. The recipient pays `burnt` gas and 1 yocto authorization deposit per call;
    // rejected calls refund that deposit (and unused gas) through `system` refund receipts.
    let retry = async |nonce: &'static str| -> Result<_> {
        let before = balance().await?;
        let r = restored
            .call(c.id(), "retry_native_transfer")
            .args_json(json!({"id":t["id"],"expectedOperationNonce":nonce}))
            .deposit(NearToken::from_yoctonear(1))
            .gas(GAS)
            .transact()
            .await?;
        let v = finalized(&w, &restored, &r).await?;
        let delta = balance().await? as i128 - before as i128;
        let gas = burnt(&v);
        let incoming = transfers_to(&v, &restored);
        println!(
            "MEASURE retry nonce={nonce} success={} delta={delta} burnt={gas} incoming={incoming:?}",
            r.is_success()
        );
        Ok((r, delta, gas, incoming))
    };
    let (ok, delta, gas, incoming) = retry("1").await?;
    for o in ok.receipt_outcomes() {
        println!(
            "MEASURE retry receipt gas={} executor={}",
            o.gas_burnt.as_gas(),
            o.executor_id
        );
    }
    assert!(ok.is_success());
    assert!(ok.receipt_failures().is_empty());
    // The finalized receipts carry exactly one principal transfer, from the contract.
    assert_eq!(incoming, vec![(c.id().to_string(), PRINCIPAL)]);
    // Exact: principal in, minus the kept 1 yocto authorization deposit, minus gas burnt.
    assert_eq!(
        delta,
        PRINCIPAL as i128 - 1 - gas as i128,
        "success retry accounting"
    );
    let mut total = delta;
    for nonce in ["1", "2", "3"] {
        let (r, delta, gas, incoming) = retry(nonce).await?;
        assert!(r.is_failure(), "replayed retry {nonce}");
        assert!(
            incoming.is_empty(),
            "replayed retry {nonce} delivered {incoming:?}"
        );
        // Exact: a rejected retry costs only its gas; the 1 yocto deposit is refunded.
        assert_eq!(delta, -(gas as i128), "replayed retry {nonce} accounting");
        total += delta;
    }
    // No balance movement outside the four measured transactions.
    assert_eq!(balance().await? as i128 - start as i128, total);
    let state = request(&c, &t).await?;
    assert_eq!(state["status"], "FINAL_PAID");
    assert_eq!(state["latestOperation"]["nonce"], "2");
    let a = accounting(&c).await?;
    assert_eq!(a["confirmedPaidYocto"], PRINCIPAL.to_string());
    assert_eq!(a["failedHeldPrincipalYocto"], "0");
    assert_eq!(a["inFlightPrincipalYocto"], "0");
    Ok(())
}

#[tokio::test]
async fn failed_transfer_and_failed_callback_also_stays_unresolved() -> Result<()> {
    let (w, c, _, payer) = setup(true).await?;
    let root = w.root_account()?;
    let merchant = root
        .create_subaccount("gone")
        .initial_balance(NearToken::from_near(10))
        .transact()
        .await?
        .into_result()?;
    let t = terms(&w, &c, &merchant, 9).await?;
    create(&w, &c, &merchant, &t).await?;
    merchant.delete_account(root.id()).await?.into_result()?;
    assert!(pay(&c, &payer, &t).await?.is_failure());
    assert_eq!(request(&c, &t).await?["status"], "PAYOUT_IN_FLIGHT");
    let restored = root
        .create_subaccount("gone")
        .initial_balance(NearToken::from_near(10))
        .transact()
        .await?
        .into_result()?;
    assert!(
        restored
            .call(c.id(), "retry_native_transfer")
            .args_json(json!({"id":t["id"],"expectedOperationNonce":"1"}))
            .deposit(NearToken::from_yoctonear(1))
            .gas(GAS)
            .transact()
            .await?
            .is_failure()
    );
    let a = accounting(&c).await?;
    assert_eq!(a["inFlightPrincipalYocto"], PRINCIPAL.to_string());
    assert_eq!(a["failedHeldPrincipalYocto"], "0");
    Ok(())
}

#[tokio::test]
async fn merchant_authorization_commitment_and_substitution_guards() -> Result<()> {
    let (w, c, merchant, payer) = setup(false).await?;
    let mut t = terms(&w, &c, &merchant, 100).await?;
    let now = w.view_block().await?.timestamp();
    t["merchantAccountId"] = json!(merchant.id());
    t["sessionBinding"] = json!({"id":"11111111-1111-4111-8111-111111111111",
        "nonce":"a".repeat(64), "expiresAtNs":(now + 120_000_000_000u64).to_string()});
    if !merchant_build() {
        assert!(
            c.view("quote_create_request")
                .args_json(json!({"terms":t}))
                .await
                .is_err()
        );
        return Ok(()); // Default artifact must continue refusing bound terms.
    }
    for case in ["merchant", "missing", "nonce", "uuid", "expiry"] {
        let mut bad = t.clone();
        match case {
            "merchant" => bad["merchantAccountId"] = json!(payer.id()),
            "missing" => bad["sessionBinding"] = Value::Null,
            "nonce" => bad["sessionBinding"]["nonce"] = json!("A".repeat(64)),
            "uuid" => bad["sessionBinding"]["id"] = json!("1".repeat(8192)),
            _ => bad["sessionBinding"]["expiresAtNs"] = json!(now.to_string()),
        }
        assert!(
            c.view("quote_create_request")
                .args_json(json!({"terms":bad}))
                .await
                .is_err()
        );
    }
    t["memo"] = json!("é".repeat(128));
    let q: Value = c
        .view("quote_create_request")
        .args_json(json!({"terms":t}))
        .await?
        .json()?;
    let deposit = NearToken::from_yoctonear(q["depositYocto"].as_str().unwrap().parse()?);
    let forged = payer
        .call(c.id(), "create_request")
        .args_json(json!({"terms":t,"quoteVersion":"1"}))
        .deposit(deposit)
        .gas(Gas::from_tgas(30))
        .transact()
        .await?;
    assert!(forged.is_failure());
    create(&w, &c, &merchant, &t).await?;
    let original = request(&c, &t).await?;
    assert_eq!(
        original["sessionCommitment"],
        digest("taply.session.v1", &hash(&t))
    );
    for field in ["amount", "expiry", "session"] {
        let mut changed = t.clone();
        match field {
            "amount" => changed["amountBaseUnits"] = json!("2"),
            "expiry" => {
                changed["fundingExpiresAtNs"] = json!((now + 500_000_000_000u64).to_string())
            }
            _ => changed["sessionBinding"]["nonce"] = json!("f".repeat(64)),
        }
        let result = payer
            .call(c.id(), "pay_instant_native")
            .args_json(pay_args(&changed))
            .deposit(NearToken::from_yoctonear(PRINCIPAL))
            .gas(GAS)
            .transact()
            .await?;
        assert!(result.is_failure());
        let replay = merchant
            .call(c.id(), "create_request")
            .args_json(json!({"terms":changed,"quoteVersion":"1"}))
            .deposit(deposit)
            .gas(Gas::from_tgas(30))
            .transact()
            .await?;
        assert!(replay.is_failure());
        assert_eq!(request(&c, &t).await?, original);
    }
    pay(&c, &payer, &t).await?.into_result()?;
    let state = request(&c, &t).await?;
    assert_eq!(state["status"], "FINAL_PAID");
    assert_eq!(state["sessionCommitment"], original["sessionCommitment"]);
    Ok(())
}
