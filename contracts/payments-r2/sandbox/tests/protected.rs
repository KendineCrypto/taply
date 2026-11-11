//! Protected Pay candidate on a REAL local NEAR node (near-workspaces sandbox).
//! No Testnet/Mainnet access, no real keys: the sandbox creates disposable
//! local accounts. Proves the actual runtime refund and release transfers and
//! measures gas, which unit tests cannot.
use anyhow::Result;
use near_workspaces::{
    Account, Contract, Worker,
    network::Sandbox,
    result::ExecutionFinalResult,
    types::{Gas, NearToken},
};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

const PRINCIPAL: u128 = 1_000_000_000_000_000_000_000_000; // 1 NEAR
const DURATION_NS: u64 = 60_000_000_000;

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

async fn setup() -> Result<(Worker<Sandbox>, Contract, Account, Account, Account)> {
    let w = near_workspaces::sandbox().await?;
    let c = w
        .dev_deploy(&std::fs::read("../artifacts/payments-r2.wasm")?)
        .await?;
    c.call("new")
        .args_json(json!({"tokens": []}))
        .max_gas()
        .transact()
        .await?
        .into_result()?;
    let recipient = w.dev_create_account().await?;
    let payer = w.dev_create_account().await?;
    let stranger = w.dev_create_account().await?;
    Ok((w, c, recipient, payer, stranger))
}

async fn protected_terms(
    w: &Worker<Sandbox>,
    c: &Contract,
    recipient: &Account,
    n: u64,
) -> Result<Value> {
    let now = w.view_block().await?.timestamp();
    let identity = json!({"contractId": c.id(), "creationNonce": format!("{n:064x}"),
        "creatorAccountId": recipient.id(), "network": "near-testnet"});
    Ok(
        json!({"schemaVersion":"taply.intent.v1", "id":digest("taply.id.v1", &canonical(&identity)),
        "network":"near-testnet", "contractId":c.id(), "creationNonce":format!("{n:064x}"),
        "creatorAccountId":recipient.id(), "assetId":"near:native", "amountBaseUnits":PRINCIPAL.to_string(),
        "mode":"protected", "cancelDurationNs":DURATION_NS.to_string(),
        "fundingExpiresAtNs":(now + 3_600_000_000_000u64).to_string(),
        "permittedPayerAccountId":null, "merchantAccountId":null, "memo":"", "sessionBinding":null}),
    )
}

fn measure(step: &str, r: &ExecutionFinalResult) {
    println!("MEASURE {step} gas_burnt={}", r.total_gas_burnt.as_gas());
}

async fn create(c: &Contract, recipient: &Account, t: &Value) -> Result<()> {
    let q: Value = c
        .view("quote_create_request")
        .args_json(json!({"terms": t}))
        .await?
        .json()?;
    let r = recipient
        .call(c.id(), "create_request")
        .args_json(json!({"terms": t, "quoteVersion": "1"}))
        .deposit(NearToken::from_yoctonear(
            q["depositYocto"].as_str().unwrap().parse()?,
        ))
        .gas(Gas::from_tgas(30))
        .transact()
        .await?;
    measure("create_protected", &r);
    println!("MEASURE quote {q}");
    r.into_result()?;
    Ok(())
}

async fn lock(c: &Contract, payer: &Account, t: &Value) -> Result<ExecutionFinalResult> {
    let r = payer
        .call(c.id(), "fund_protected_native")
        .args_json(json!({"id": t["id"], "expectedTermsHash": terms_hash(t),
            "acceptedCancelDurationNs": DURATION_NS.to_string(), "consentVersion": "taply.protected-consent.v1"}))
        .deposit(NearToken::from_yoctonear(PRINCIPAL))
        .gas(Gas::from_tgas(20))
        .transact()
        .await?;
    measure("fund_protected_native", &r);
    Ok(r)
}

async fn request(c: &Contract, t: &Value) -> Result<Value> {
    Ok(c.view("get_request")
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

fn snapshot(name: &str, v: &Value) -> Result<()> {
    std::fs::create_dir_all("../artifacts/sandbox-requests")?;
    std::fs::write(
        format!("../artifacts/sandbox-requests/{name}.json"),
        serde_json::to_string_pretty(v)?,
    )?;
    Ok(())
}

/// Advances sandbox blocks until chain time reaches `target_ns`.
async fn wait_until(w: &Worker<Sandbox>, target_ns: u64) -> Result<()> {
    for _ in 0..40 {
        if w.view_block().await?.timestamp() >= target_ns {
            return Ok(());
        }
        w.fast_forward(50).await?;
    }
    anyhow::bail!("chain time never reached {target_ns}")
}

fn failure_text(r: &ExecutionFinalResult) -> String {
    format!("{:?}", r.clone().into_result().err())
}

#[tokio::test]
async fn real_refund_before_cutoff_returns_principal_to_payer() -> Result<()> {
    let (w, c, recipient, payer, stranger) = setup().await?;
    let t = protected_terms(&w, &c, &recipient, 1).await?;
    create(&c, &recipient, &t).await?;
    lock(&c, &payer, &t).await?.into_result()?;
    let locked = request(&c, &t).await?;
    snapshot("locked", &locked)?;
    assert_eq!(locked["status"], "LOCKED");
    assert_eq!(locked["latestOperation"], Value::Null);

    // Recipient and strangers cannot cancel.
    for who in [&recipient, &stranger] {
        let r = who
            .call(c.id(), "cancel_protected")
            .args_json(json!({"id": t["id"], "expectedTermsHash": terms_hash(&t)}))
            .deposit(NearToken::from_yoctonear(1))
            .gas(Gas::from_tgas(50))
            .transact()
            .await?;
        assert!(
            failure_text(&r).contains("PAYER_ONLY"),
            "{}",
            failure_text(&r)
        );
    }

    let before = payer.view_account().await?.balance.as_yoctonear();
    let r = payer
        .call(c.id(), "cancel_protected")
        .args_json(json!({"id": t["id"], "expectedTermsHash": terms_hash(&t)}))
        .deposit(NearToken::from_yoctonear(1))
        .gas(Gas::from_tgas(50))
        .transact()
        .await?;
    measure("cancel_protected", &r);
    let burnt: u128 = r
        .outcomes()
        .iter()
        .map(|o| o.tokens_burnt.as_yoctonear())
        .sum();
    r.into_result()?;
    let refunded = request(&c, &t).await?;
    snapshot("cancelled-refunded", &refunded)?;
    assert_eq!(refunded["status"], "CANCELLED_REFUNDED");
    assert_eq!(refunded["settlementBranch"], "PAYER");
    assert_eq!(refunded["latestOperation"]["status"], "SUCCEEDED");
    // Let the signer's unused-gas refund land (it arrives after transact() returns).
    w.fast_forward(5).await?;
    // The payer got exactly the principal back, minus the gas burnt for this call
    // and the 1 yoctoNEAR authentication deposit.
    let after = payer.view_account().await?.balance.as_yoctonear();
    let delta = after as i128 - before as i128;
    println!("MEASURE refund payer_delta={delta} burnt={burnt}");
    assert_eq!(
        delta,
        PRINCIPAL as i128 - 1 - burnt as i128,
        "payer delta {delta}"
    );

    // Release can no longer happen, even after the cutoff.
    wait_until(&w, refunded["cancelUntilNs"].as_str().unwrap().parse()?).await?;
    let r = stranger
        .call(c.id(), "release_protected")
        .args_json(json!({"id": t["id"]}))
        .deposit(NearToken::from_yoctonear(1))
        .gas(Gas::from_tgas(50))
        .transact()
        .await?;
    assert!(failure_text(&r).contains("NOT_LOCKED"));

    let a = accounting(&c).await?;
    println!("MEASURE accounting {a}");
    assert_eq!(a["deliveredRefundedYocto"], PRINCIPAL.to_string());
    assert_eq!(a["lockedPrincipalYocto"], "0");
    assert_eq!(a["deliveredPaidYocto"], "0");
    Ok(())
}

#[tokio::test]
async fn real_release_only_at_or_after_cutoff_pays_recipient() -> Result<()> {
    let (w, c, recipient, payer, stranger) = setup().await?;
    let t = protected_terms(&w, &c, &recipient, 2).await?;
    create(&c, &recipient, &t).await?;
    lock(&c, &payer, &t).await?.into_result()?;
    let locked = request(&c, &t).await?;
    let cutoff: u64 = locked["cancelUntilNs"].as_str().unwrap().parse()?;

    let early = stranger
        .call(c.id(), "release_protected")
        .args_json(json!({"id": t["id"]}))
        .deposit(NearToken::from_yoctonear(1))
        .gas(Gas::from_tgas(50))
        .transact()
        .await?;
    assert!(
        failure_text(&early).contains("CANCELLATION_WINDOW_OPEN"),
        "{}",
        failure_text(&early)
    );

    wait_until(&w, cutoff).await?;
    // At/after the cutoff the payer can no longer cancel.
    let late = payer
        .call(c.id(), "cancel_protected")
        .args_json(json!({"id": t["id"], "expectedTermsHash": terms_hash(&t)}))
        .deposit(NearToken::from_yoctonear(1))
        .gas(Gas::from_tgas(50))
        .transact()
        .await?;
    assert!(
        failure_text(&late).contains("CANCELLATION_WINDOW_CLOSED"),
        "{}",
        failure_text(&late)
    );

    let before = recipient.view_account().await?.balance.as_yoctonear();
    let r = stranger
        .call(c.id(), "release_protected")
        .args_json(json!({"id": t["id"]}))
        .deposit(NearToken::from_yoctonear(1))
        .gas(Gas::from_tgas(50))
        .transact()
        .await?;
    measure("release_protected", &r);
    r.into_result()?;
    let paid = request(&c, &t).await?;
    snapshot("final-paid", &paid)?;
    assert_eq!(paid["status"], "FINAL_PAID");
    assert_eq!(paid["settlementBranch"], "RECIPIENT");
    assert_eq!(paid["latestOperation"]["kind"], "PROTECTED_RELEASE");
    // The recipient did not sign anything here, so it receives exactly the principal.
    let after = recipient.view_account().await?.balance.as_yoctonear();
    assert_eq!(after - before, PRINCIPAL);

    let a = accounting(&c).await?;
    println!("MEASURE accounting {a}");
    assert_eq!(a["deliveredPaidYocto"], PRINCIPAL.to_string());
    assert_eq!(a["lockedPrincipalYocto"], "0");
    Ok(())
}

#[tokio::test]
async fn consent_and_exact_principal_are_enforced_by_the_runtime() -> Result<()> {
    let (w, c, recipient, payer, _) = setup().await?;
    let t = protected_terms(&w, &c, &recipient, 3).await?;
    create(&c, &recipient, &t).await?;
    let wrong_window = payer
        .call(c.id(), "fund_protected_native")
        .args_json(json!({"id": t["id"], "expectedTermsHash": terms_hash(&t),
            "acceptedCancelDurationNs": "120000000000", "consentVersion": "taply.protected-consent.v1"}))
        .deposit(NearToken::from_yoctonear(PRINCIPAL))
        .gas(Gas::from_tgas(20))
        .transact()
        .await?;
    assert!(failure_text(&wrong_window).contains("CANCEL_DURATION_NOT_ACCEPTED"));
    let instant_path = payer
        .call(c.id(), "pay_instant_native")
        .args_json(json!({"id": t["id"], "expectedTermsHash": terms_hash(&t)}))
        .deposit(NearToken::from_yoctonear(PRINCIPAL))
        .gas(Gas::from_tgas(50))
        .transact()
        .await?;
    assert!(failure_text(&instant_path).contains("WRONG_MODE"));
    assert_eq!(request(&c, &t).await?["status"], "OPEN");
    lock(&c, &payer, &t).await?.into_result()?;
    let twice = lock(&c, &payer, &t).await?;
    assert!(failure_text(&twice).contains("NOT_OPEN"));
    let a = accounting(&c).await?;
    assert_eq!(a["receivedPrincipalYocto"], PRINCIPAL.to_string());
    assert_eq!(a["lockedPrincipalYocto"], PRINCIPAL.to_string());
    Ok(())
}
