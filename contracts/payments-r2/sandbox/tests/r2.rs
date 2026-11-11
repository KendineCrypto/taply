//! R-2 on a REAL local NEAR node: the current escrow source (legacy-g3, byte-identical
//! to the deployed `taply-e2e-ce38a238.testnet` code) side by side with the R-2
//! candidate, under real receipt execution and fault-injected callbacks.
//!
//! Fault builds are separate WASM files compiled with test-only cargo features
//! (`sandbox-fail-callback`: the callback panics after the real transfer;
//! `sandbox-tiny-callback-gas`: the callback gets 1 Tgas and runs out of gas).
//! No fault API exists in the contract itself.
use anyhow::Result;
use near_workspaces::{
    Account, Contract, Worker,
    network::Sandbox,
    result::ExecutionFinalResult,
    types::{Gas, NearToken},
};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

const AMOUNT: u128 = 1_000_000_000_000_000_000_000_000; // 1 NEAR
const DURATION_NS: u64 = 60_000_000_000;
const FEES: u128 = 10_000_000_000_000_000_000_000; // 0.01 NEAR: gas a caller may burn

fn digest(domain: &str, bytes: &str) -> String {
    format!("{:x}", Sha256::digest(format!("{domain}\n{bytes}")))
}
fn canonical(v: &Value) -> String {
    if let Value::Object(m) = v {
        let mut keys: Vec<_> = m.keys().collect();
        keys.sort();
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
fn terms_hash(t: &Value) -> String {
    digest("taply.terms.v1", &canonical(t))
}

async fn deploy(w: &Worker<Sandbox>, wasm: &str) -> Result<Contract> {
    let c = w
        .dev_deploy(&std::fs::read(format!("../artifacts/{wasm}"))?)
        .await?;
    c.call("new")
        .args_json(json!({"tokens": []}))
        .max_gas()
        .transact()
        .await?
        .into_result()?;
    Ok(c)
}

async fn terms(
    w: &Worker<Sandbox>,
    c: &Contract,
    recipient: &Account,
    n: u64,
    mode: &str,
) -> Result<Value> {
    let now = w.view_block().await?.timestamp();
    let identity = json!({"contractId": c.id(), "creationNonce": format!("{n:064x}"),
        "creatorAccountId": recipient.id(), "network": "near-testnet"});
    Ok(
        json!({"schemaVersion":"taply.intent.v1", "id":digest("taply.id.v1", &canonical(&identity)),
        "network":"near-testnet", "contractId":c.id(), "creationNonce":format!("{n:064x}"),
        "creatorAccountId":recipient.id(), "assetId":"near:native", "amountBaseUnits":AMOUNT.to_string(),
        "mode":mode, "cancelDurationNs": if mode == "protected" { json!(DURATION_NS.to_string()) } else { Value::Null },
        "fundingExpiresAtNs":(now + 3_600_000_000_000u64).to_string(),
        "permittedPayerAccountId":null, "merchantAccountId":null, "memo":"", "sessionBinding":null}),
    )
}

async fn create(c: &Contract, recipient: &Account, t: &Value) -> Result<()> {
    let q: Value = c
        .view("quote_create_request")
        .args_json(json!({"terms": t}))
        .await?
        .json()?;
    recipient
        .call(c.id(), "create_request")
        .args_json(json!({"terms": t, "quoteVersion": "1"}))
        .deposit(NearToken::from_yoctonear(
            q["depositYocto"].as_str().unwrap().parse()?,
        ))
        .gas(Gas::from_tgas(30))
        .transact()
        .await?
        .into_result()?;
    Ok(())
}
/// Lets the creator's own gas refund from create_request land, so balance
/// deltas measured afterwards contain only the payout.
async fn settle_refunds(w: &Worker<Sandbox>) -> Result<()> {
    w.fast_forward(5).await?;
    Ok(())
}

async fn pay(c: &Contract, payer: &Account, t: &Value) -> Result<ExecutionFinalResult> {
    Ok(payer
        .call(c.id(), "pay_instant_native")
        .args_json(json!({"id": t["id"], "expectedTermsHash": terms_hash(t)}))
        .deposit(NearToken::from_yoctonear(AMOUNT))
        .gas(Gas::from_tgas(50))
        .transact()
        .await?)
}

async fn retry(
    c: &Contract,
    who: &Account,
    t: &Value,
    nonce: &str,
) -> Result<ExecutionFinalResult> {
    Ok(who
        .call(c.id(), "retry_native_transfer")
        .args_json(json!({"id": t["id"], "expectedOperationNonce": nonce}))
        .deposit(NearToken::from_yoctonear(1))
        .gas(Gas::from_tgas(50))
        .transact()
        .await?)
}

async fn view(c: &Contract, method: &str, t: &Value) -> Result<Value> {
    Ok(c.view(method)
        .args_json(json!({"id": t["id"]}))
        .await?
        .json()?)
}
async fn accounting(c: &Contract) -> Result<Value> {
    Ok(c.view("get_accounting")
        .args_json(json!({}))
        .await?
        .json()?)
}
async fn balance(a: &Account) -> Result<u128> {
    Ok(a.view_account().await?.balance.as_yoctonear())
}
fn failure_text(r: &ExecutionFinalResult) -> String {
    format!("{:?}", r.receipt_failures())
}
/// The outbound Transfer receipt to `to` and whether it succeeded, read from the
/// real receipt outcomes of the paying transaction.
fn transfer_outcome(r: &ExecutionFinalResult, to: &str) -> Option<bool> {
    r.receipt_outcomes()
        .iter()
        .find(|o| o.executor_id.as_str() == to)
        .map(|o| o.is_success())
}
fn evidence(name: &str, v: Value) -> Result<()> {
    std::fs::create_dir_all("../artifacts/r2-evidence")?;
    std::fs::write(
        format!("../artifacts/r2-evidence/{name}.json"),
        serde_json::to_string_pretty(&v)?,
    )?;
    println!("EVIDENCE {name} {v}");
    Ok(())
}

/// R-2 case 1: the transfer SUCCEEDS, the callback PANICS.
/// Legacy: PAYOUT_IN_FLIGHT forever although the recipient was paid.
/// Candidate: FINAL_PAID at once, delivery SENT_UNCONFIRMED, no resend possible.
#[tokio::test]
async fn transfer_succeeds_callback_panics_legacy_vs_candidate() -> Result<()> {
    for (wasm, candidate) in [
        ("legacy-g3.callback-fault.wasm", false),
        ("payments-r2.callback-fault.wasm", true),
    ] {
        let w = near_workspaces::sandbox().await?;
        let c = deploy(&w, wasm).await?;
        let recipient = w.dev_create_account().await?;
        let payer = w.dev_create_account().await?;
        let t = terms(&w, &c, &recipient, 1, "instant").await?;
        create(&c, &recipient, &t).await?;
        settle_refunds(&w).await?;
        let before = balance(&recipient).await?;
        let r = pay(&c, &payer, &t).await?;
        let paid = balance(&recipient).await? - before;
        assert_eq!(
            paid, AMOUNT,
            "{wasm}: the real transfer happened exactly once"
        );
        assert_eq!(transfer_outcome(&r, recipient.id().as_str()), Some(true));
        assert!(
            failure_text(&r).contains("SANDBOX_CALLBACK_FAULT"),
            "{wasm}: {}",
            failure_text(&r)
        );
        let req = view(&c, "get_request", &t).await?;
        let acc = accounting(&c).await?;
        // Nobody can get it sent again.
        let again = retry(&c, &recipient, &t, "1").await?;
        assert!(again.is_failure());
        // The refused retry cost the recipient a little gas; a second payment would add ~1 NEAR.
        let total = balance(&recipient).await? - before;
        assert!(
            total <= AMOUNT && total + FEES >= AMOUNT,
            "{wasm}: never paid twice ({total})"
        );
        if candidate {
            assert_eq!(req["status"], "FINAL_PAID");
            let d = view(&c, "get_delivery", &t).await?;
            assert_eq!(d["delivery"], "SENT_UNCONFIRMED");
            assert_eq!(acc["sendingPrincipalYocto"], AMOUNT.to_string());
            assert!(failure_text(&again).contains("NO_RETURNED_DELIVERY"));
            evidence(
                "1-success-callback-panic-candidate",
                json!({"request": req, "delivery": d, "accounting": acc,
                "recipientDeltaYocto": paid.to_string(), "retry": failure_text(&again)}),
            )?;
        } else {
            assert_eq!(req["status"], "PAYOUT_IN_FLIGHT");
            assert_eq!(acc["inFlightPrincipalYocto"], AMOUNT.to_string());
            assert!(failure_text(&again).contains("NO_RECORDED_TRANSFER_FAILURE"));
            evidence(
                "1-success-callback-panic-legacy",
                json!({"request": req, "accounting": acc,
                "recipientDeltaYocto": paid.to_string(), "retry": failure_text(&again)}),
            )?;
        }
    }
    Ok(())
}

/// R-2 case 2: the transfer SUCCEEDS, the callback RUNS OUT OF GAS (candidate
/// built with a 1 Tgas callback). Same outcome as a panic: settled, unconfirmed.
#[tokio::test]
async fn transfer_succeeds_callback_out_of_gas_candidate() -> Result<()> {
    let w = near_workspaces::sandbox().await?;
    let c = deploy(&w, "payments-r2.callback-oog.wasm").await?;
    let recipient = w.dev_create_account().await?;
    let payer = w.dev_create_account().await?;
    let t = terms(&w, &c, &recipient, 2, "instant").await?;
    create(&c, &recipient, &t).await?;
    settle_refunds(&w).await?;
    let before = balance(&recipient).await?;
    let r = pay(&c, &payer, &t).await?;
    let text = failure_text(&r);
    assert!(
        text.contains("GasExceeded") || text.contains("Exceeded the prepaid gas"),
        "{text}"
    );
    assert_eq!(balance(&recipient).await? - before, AMOUNT);
    let req = view(&c, "get_request", &t).await?;
    let d = view(&c, "get_delivery", &t).await?;
    assert_eq!(req["status"], "FINAL_PAID");
    assert_eq!(d["delivery"], "SENT_UNCONFIRMED");
    assert!(failure_text(&retry(&c, &recipient, &t, "1").await?).contains("NO_RETURNED_DELIVERY"));
    let total = balance(&recipient).await? - before;
    assert!(
        total <= AMOUNT && total + FEES >= AMOUNT,
        "never paid twice ({total})"
    );
    evidence(
        "2-success-callback-oog-candidate",
        json!({"request": req, "delivery": d,
        "accounting": accounting(&c).await?, "callbackFailure": text}),
    )?;
    Ok(())
}

/// R-2 case 3 (the RESIDUAL): the transfer FAILS (recipient account deleted) AND
/// the callback PANICS. Neither contract can learn that the NEAR came back.
/// Both keep it unspendable and refuse any resend: no double payment, but the
/// recipient cannot get it either. The candidate makes it visible as
/// SENT_UNCONFIRMED / "sending" instead of an unexplained in-flight payment.
#[tokio::test]
async fn transfer_fails_and_callback_panics_is_the_residual_risk() -> Result<()> {
    for (wasm, candidate) in [
        ("legacy-g3.callback-fault.wasm", false),
        ("payments-r2.callback-fault.wasm", true),
    ] {
        let w = near_workspaces::sandbox().await?;
        let c = deploy(&w, wasm).await?;
        let root = w.root_account()?;
        let payer = w.dev_create_account().await?;
        let gone = root
            .create_subaccount("gone")
            .initial_balance(NearToken::from_near(10))
            .transact()
            .await?
            .into_result()?;
        let t = terms(&w, &c, &gone, 3, "instant").await?;
        create(&c, &gone, &t).await?;
        gone.clone()
            .delete_account(root.id())
            .await?
            .into_result()?;
        let r = pay(&c, &payer, &t).await?;
        assert_eq!(
            transfer_outcome(&r, gone.id().as_str()),
            Some(false),
            "{wasm}: the transfer failed"
        );
        let back = root
            .create_subaccount("gone")
            .initial_balance(NearToken::from_near(10))
            .transact()
            .await?
            .into_result()?;
        let again = retry(&c, &back, &t, "1").await?;
        assert!(
            again.is_failure(),
            "{wasm}: no resend of an unconfirmed transfer"
        );
        let req = view(&c, "get_request", &t).await?;
        let acc = accounting(&c).await?;
        if candidate {
            assert_eq!(req["status"], "FINAL_PAID");
            assert_eq!(
                view(&c, "get_delivery", &t).await?["delivery"],
                "SENT_UNCONFIRMED"
            );
            assert_eq!(acc["sendingPrincipalYocto"], AMOUNT.to_string());
            assert_eq!(acc["owedPrincipalYocto"], "0");
        } else {
            assert_eq!(req["status"], "PAYOUT_IN_FLIGHT");
            assert_eq!(acc["inFlightPrincipalYocto"], AMOUNT.to_string());
        }
        evidence(
            &format!(
                "3-failed-transfer-callback-panic-{}",
                if candidate { "candidate" } else { "legacy" }
            ),
            json!({"request": req, "accounting": acc, "retry": failure_text(&again),
                "contractBalanceYocto": acc["runtimeAccountBalanceYocto"]}),
        )?;
    }
    Ok(())
}

/// Transfer FAILS, callback WORKS (candidate): RETURNED_RESENDABLE. Only the
/// recipient can resend, to the same account, once; replay and stale nonces fail.
#[tokio::test]
async fn transfer_fails_callback_records_it_and_only_the_recipient_resends_once() -> Result<()> {
    let w = near_workspaces::sandbox().await?;
    let c = deploy(&w, "payments-r2.wasm").await?;
    let root = w.root_account()?;
    let payer = w.dev_create_account().await?;
    let stranger = w.dev_create_account().await?;
    let gone = root
        .create_subaccount("gone")
        .initial_balance(NearToken::from_near(10))
        .transact()
        .await?
        .into_result()?;
    let t = terms(&w, &c, &gone, 4, "instant").await?;
    create(&c, &gone, &t).await?;
    gone.clone()
        .delete_account(root.id())
        .await?
        .into_result()?;
    let paid = pay(&c, &payer, &t).await?;
    // Real gas per receipt; the delivery callback reserve is 15 Tgas.
    for o in paid.receipt_outcomes() {
        println!(
            "MEASURE pay receipt executor={} gas_burnt={} success={}",
            o.executor_id,
            o.gas_burnt.as_gas(),
            o.is_success()
        );
    }
    paid.into_result()?;
    let d = view(&c, "get_delivery", &t).await?;
    assert_eq!(d["delivery"], "RETURNED_RESENDABLE", "{d}");
    assert_eq!(
        accounting(&c).await?["owedPrincipalYocto"],
        AMOUNT.to_string()
    );
    for who in [&payer, &stranger] {
        assert!(failure_text(&retry(&c, who, &t, "1").await?).contains("RECIPIENT_ONLY"));
    }
    let back = root
        .create_subaccount("gone")
        .initial_balance(NearToken::from_near(10))
        .transact()
        .await?
        .into_result()?;
    assert!(failure_text(&retry(&c, &back, &t, "2").await?).contains("OPERATION_NONCE_MISMATCH"));
    let before = balance(&back).await?;
    let ok = retry(&c, &back, &t, "1").await?;
    for o in ok.receipt_outcomes() {
        println!(
            "MEASURE resend receipt executor={} gas_burnt={} success={}",
            o.executor_id,
            o.gas_burnt.as_gas(),
            o.is_success()
        );
    }
    ok.clone().into_result()?;
    let replay = retry(&c, &back, &t, "1").await?;
    assert!(failure_text(&replay).contains("NO_RETURNED_DELIVERY"));
    // The resender pays its own gas (< 0.01 NEAR) and 1 yocto per call; a double
    // payment would show about +2 NEAR.
    let received = balance(&back).await?.saturating_sub(before);
    assert!(
        received + FEES >= AMOUNT && received <= AMOUNT,
        "received {received}"
    );
    let d = view(&c, "get_delivery", &t).await?;
    assert_eq!(d["delivery"], "DELIVERED");
    assert_eq!(d["deliveryNonce"], "2");
    let acc = accounting(&c).await?;
    assert_eq!(acc["deliveredPaidYocto"], AMOUNT.to_string());
    assert_eq!(acc["owedPrincipalYocto"], "0");
    evidence(
        "4-failed-transfer-recorded-then-resent-once",
        json!({"delivery": d, "accounting": acc}),
    )?;
    Ok(())
}

/// Forged callback: the contract's own key (dev accounts keep one) calls the
/// callback directly. There is no promise result, so it is refused.
#[tokio::test]
async fn self_signed_callback_is_refused_and_changes_nothing() -> Result<()> {
    let w = near_workspaces::sandbox().await?;
    let c = deploy(&w, "payments-r2.callback-fault.wasm").await?;
    let recipient = w.dev_create_account().await?;
    let payer = w.dev_create_account().await?;
    let t = terms(&w, &c, &recipient, 5, "instant").await?;
    create(&c, &recipient, &t).await?;
    let _ = pay(&c, &payer, &t).await?;
    let stuck = (
        view(&c, "get_request", &t).await?,
        view(&c, "get_delivery", &t).await?,
    );
    let forged = c
        .call("on_delivery_complete")
        .args_json(json!({"id": t["id"], "deliveryNonce": "1"}))
        .max_gas()
        .transact()
        .await?;
    assert!(
        failure_text(&forged).contains("UNKNOWN_PROMISE_RESULT"),
        "{}",
        failure_text(&forged)
    );
    assert_eq!(
        (
            view(&c, "get_request", &t).await?,
            view(&c, "get_delivery", &t).await?
        ),
        stuck
    );
    Ok(())
}

/// Race: duplicate cancels and a release submitted together around the cutoff.
/// Exactly one settlement, exactly one transfer.
#[tokio::test]
async fn concurrent_cancel_and_release_settle_exactly_once() -> Result<()> {
    let w = near_workspaces::sandbox().await?;
    let c = deploy(&w, "payments-r2.wasm").await?;
    let recipient = w.dev_create_account().await?;
    let payer = w.dev_create_account().await?;
    let stranger = w.dev_create_account().await?;
    let t = terms(&w, &c, &recipient, 6, "protected").await?;
    create(&c, &recipient, &t).await?;
    payer
        .call(c.id(), "fund_protected_native")
        .args_json(json!({"id": t["id"], "expectedTermsHash": terms_hash(&t),
            "acceptedCancelDurationNs": DURATION_NS.to_string(), "consentVersion": "taply.protected-consent.v1"}))
        .deposit(NearToken::from_yoctonear(AMOUNT))
        .gas(Gas::from_tgas(20))
        .transact()
        .await?
        .into_result()?;
    settle_refunds(&w).await?;
    let rb = balance(&recipient).await?;
    let cancel = |who: Account| {
        let (c, t) = (c.clone(), t.clone());
        async move {
            who.call(c.id(), "cancel_protected")
                .args_json(json!({"id": t["id"], "expectedTermsHash": terms_hash(&t)}))
                .deposit(NearToken::from_yoctonear(1))
                .gas(Gas::from_tgas(50))
                .transact()
                .await
        }
    };
    let release = {
        let (c, t, s) = (c.clone(), t.clone(), stranger.clone());
        async move {
            s.call(c.id(), "release_protected")
                .args_json(json!({"id": t["id"]}))
                .deposit(NearToken::from_yoctonear(1))
                .gas(Gas::from_tgas(50))
                .transact()
                .await
        }
    };
    let (a, b, r) = tokio::join!(cancel(payer.clone()), cancel(payer.clone()), release);
    let outcomes = [a?, b?, r?];
    let ok = outcomes.iter().filter(|o| o.is_success()).count();
    assert_eq!(
        ok,
        1,
        "exactly one settlement: {:?}",
        outcomes.iter().map(failure_text).collect::<Vec<_>>()
    );
    let req = view(&c, "get_request", &t).await?;
    assert_eq!(
        req["status"], "CANCELLED_REFUNDED",
        "before the cutoff only the payer's cancel can win"
    );
    let acc = accounting(&c).await?;
    assert_eq!(acc["settledRefundedYocto"], AMOUNT.to_string());
    assert_eq!(acc["settledPaidYocto"], "0");
    assert_eq!(acc["deliveredRefundedYocto"], AMOUNT.to_string());
    assert_eq!(balance(&recipient).await?, rb, "the recipient got nothing");
    evidence(
        "6-concurrent-cancel-release",
        json!({"request": req, "accounting": acc,
        "outcomes": outcomes.iter().map(failure_text).collect::<Vec<_>>()}),
    )?;
    Ok(())
}
