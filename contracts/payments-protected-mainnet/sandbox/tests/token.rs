//! NEP-141 payments on a REAL local NEAR node: Taply's TEST-ONLY token
//! (contracts/test-token, standard near-contract-standards implementation) and
//! the candidate payments contract with that token allowlisted at init.
use anyhow::Result;
use near_workspaces::{
    AccessKey, Account, AccountDetailsPatch, Contract, Worker,
    network::Sandbox,
    result::ExecutionFinalResult,
    types::{Gas, KeyType, NearToken, SecretKey},
};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

const AMOUNT: u128 = 2_500_000; // 2.5 tUSD-TEST

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
fn fail(r: &ExecutionFinalResult) -> String {
    format!("{:?}", r.clone().into_result().err())
}
async fn token(w: &Worker<Sandbox>, owner: &Account, real_identity: bool) -> Result<Contract> {
    // Local-only patch keeps the production allowlist intact; this is a synthetic token.
    let name = if real_identity {
        "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1"
    } else {
        "fake-token.near"
    };
    let id = name.parse()?;
    let sk = SecretKey::from_seed(KeyType::ED25519, name);
    w.patch(&id)
        .account(
            AccountDetailsPatch::default()
                .balance(NearToken::from_near(100))
                .storage_usage(512),
        )
        .access_key(sk.public_key(), AccessKey::full_access())
        .transact()
        .await?;
    let t = Account::from_secret_key(id, sk, w)
        .deploy(&std::fs::read("../artifacts/taply_test_token.wasm")?)
        .await?
        .into_result()?;
    t.call("new")
        .args_json(json!({"owner_id": owner.id(), "total_supply": "1000000000"}))
        .max_gas()
        .transact()
        .await?
        .into_result()?;
    Ok(t)
}
async fn register(t: &Contract, who: &str) -> Result<()> {
    t.as_account()
        .call(t.id(), "storage_deposit")
        .args_json(json!({"account_id": who, "registration_only": true}))
        .deposit(NearToken::from_millinear(10))
        .max_gas()
        .transact()
        .await?
        .into_result()?;
    Ok(())
}
async fn balance(t: &Contract, who: &str) -> Result<u128> {
    let v: String = t
        .view("ft_balance_of")
        .args_json(json!({"account_id": who}))
        .await?
        .json()?;
    Ok(v.parse()?)
}
async fn setup() -> Result<(Worker<Sandbox>, Contract, Contract, Account, Account)> {
    let w = near_workspaces::sandbox().await?;
    let payer = w.dev_create_account().await?;
    let recipient = w.dev_create_account().await?;
    let t = token(&w, &payer, true).await?;
    let c = w
        .dev_deploy(&std::fs::read("../artifacts/payments-protected.wasm")?)
        .await?;
    c.call("new")
        .args_json(json!({"network":"near-mainnet","contractId":c.id(),"tokens": [{"accountId": t.id(), "decimals": 6, "symbol": "USDC"}]}))
        .max_gas()
        .transact()
        .await?
        .into_result()?;
    register(&t, c.id().as_str()).await?;
    Ok((w, c, t, payer, recipient))
}
async fn terms(
    w: &Worker<Sandbox>,
    c: &Contract,
    recipient: &Account,
    t: &Contract,
    n: u64,
    mode: &str,
) -> Result<(Value, String)> {
    let now = w.view_block().await?.timestamp();
    let identity = json!({"contractId": c.id(), "creationNonce": format!("{n:064x}"), "creatorAccountId": recipient.id(), "network": "near-mainnet"});
    let v = json!({"schemaVersion":"taply.intent.v1", "id":digest("taply.id.v1", &canonical(&identity)), "network":"near-mainnet",
        "contractId":c.id(), "creationNonce":format!("{n:064x}"), "creatorAccountId":recipient.id(), "assetId":format!("nep141:{}", t.id()),
        "amountBaseUnits":AMOUNT.to_string(), "mode":mode, "cancelDurationNs": if mode == "protected" { json!("60000000000") } else { Value::Null },
        "fundingExpiresAtNs":(now + 3_600_000_000_000u64).to_string(), "permittedPayerAccountId":null, "merchantAccountId":null, "memo":"", "sessionBinding":null});
    let h = digest("taply.terms.v1", &canonical(&v));
    let q: Value = c
        .view("quote_create_request")
        .args_json(json!({"terms": v}))
        .await?
        .json()?;
    recipient
        .call(c.id(), "create_request")
        .args_json(json!({"terms": v, "quoteVersion": "1"}))
        .deposit(NearToken::from_yoctonear(
            q["depositYocto"].as_str().unwrap().parse()?,
        ))
        .gas(Gas::from_tgas(30))
        .transact()
        .await?
        .into_result()?;
    Ok((v, h))
}
async fn ft_pay(
    payer: &Account,
    token: &str,
    contract: &str,
    amount: u128,
    msg: Value,
) -> Result<ExecutionFinalResult> {
    let r = payer.call(&token.parse()?, "ft_transfer_call")
        .args_json(json!({"receiver_id": contract, "amount": amount.to_string(), "memo": null, "msg": msg.to_string()}))
        .deposit(NearToken::from_yoctonear(1)).gas(Gas::from_tgas(100)).transact().await?;
    println!(
        "MEASURE ft_transfer_call gas_burnt={}",
        r.total_gas_burnt.as_gas()
    );
    Ok(r)
}
async fn get(c: &Contract, id: &Value) -> Result<Value> {
    Ok(c.view("get_request")
        .args_json(json!({"id": id}))
        .await?
        .json()?)
}

#[tokio::test]
async fn real_token_instant_payment_moves_exact_tokens_to_recipient() -> Result<()> {
    let (w, c, t, payer, recipient) = setup().await?;
    register(&t, recipient.id().as_str()).await?;
    let (v, h) = terms(&w, &c, &recipient, &t, 1, "instant").await?;
    let before = (
        balance(&t, payer.id().as_str()).await?,
        balance(&t, recipient.id().as_str()).await?,
    );
    // Wrong amount: contract refuses, token returns everything.
    let wrong = ft_pay(
        &payer,
        t.id().as_str(),
        c.id().as_str(),
        AMOUNT - 1,
        json!({"id": v["id"], "expectedTermsHash": h, "action": "pay_instant"}),
    )
    .await?;
    assert!(
        wrong.is_success(),
        "ft_transfer_call itself succeeds; the receiver refuses"
    );
    assert_eq!(
        balance(&t, payer.id().as_str()).await?,
        before.0,
        "full refund of a refused transfer"
    );
    assert_eq!(get(&c, &v["id"]).await?["status"], "OPEN");
    let r = ft_pay(
        &payer,
        t.id().as_str(),
        c.id().as_str(),
        AMOUNT,
        json!({"id": v["id"], "expectedTermsHash": h, "action": "pay_instant"}),
    )
    .await?;
    r.into_result()?;
    let final_view = get(&c, &v["id"]).await?;
    std::fs::create_dir_all("../artifacts/sandbox-token")?;
    std::fs::write(
        "../artifacts/sandbox-token/instant-final-paid.json",
        serde_json::to_string_pretty(&final_view)?,
    )?;
    assert_eq!(final_view["status"], "FINAL_PAID");
    assert_eq!(balance(&t, payer.id().as_str()).await?, before.0 - AMOUNT);
    assert_eq!(
        balance(&t, recipient.id().as_str()).await?,
        before.1 + AMOUNT
    );
    assert_eq!(
        balance(&t, c.id().as_str()).await?,
        0,
        "contract keeps nothing"
    );
    // Duplicate funding: refused and fully returned.
    let dup = ft_pay(
        &payer,
        t.id().as_str(),
        c.id().as_str(),
        AMOUNT,
        json!({"id": v["id"], "expectedTermsHash": h, "action": "pay_instant"}),
    )
    .await?;
    assert!(dup.is_success());
    assert_eq!(balance(&t, payer.id().as_str()).await?, before.0 - AMOUNT);
    let acc: Value = c
        .view("get_accounting")
        .args_json(json!({}))
        .await?
        .json()?;
    println!("MEASURE token accounting {}", acc["tokens"]);
    assert_eq!(acc["tokens"][0]["confirmedPaid"], AMOUNT.to_string());
    Ok(())
}

#[tokio::test]
async fn unlisted_fake_token_cannot_fund_a_request() -> Result<()> {
    let (w, c, t, payer, recipient) = setup().await?;
    let (v, h) = terms(&w, &c, &recipient, &t, 2, "instant").await?;
    // Same code, different account: NOT the allowlisted token.
    let fake = token(&w, &payer, false).await?;
    register(&fake, c.id().as_str()).await?;
    let before = balance(&fake, payer.id().as_str()).await?;
    let r = ft_pay(
        &payer,
        fake.id().as_str(),
        c.id().as_str(),
        AMOUNT,
        json!({"id": v["id"], "expectedTermsHash": h, "action": "pay_instant"}),
    )
    .await?;
    assert!(r.is_success());
    assert_eq!(
        balance(&fake, payer.id().as_str()).await?,
        before,
        "fake tokens returned"
    );
    assert_eq!(balance(&fake, c.id().as_str()).await?, 0);
    assert_eq!(get(&c, &v["id"]).await?["status"], "OPEN");
    Ok(())
}

#[tokio::test]
async fn payout_to_unregistered_recipient_is_held_then_retried() -> Result<()> {
    let (w, c, t, payer, recipient) = setup().await?;
    // Recipient is NOT registered with the token, so ft_transfer must fail.
    let (v, h) = terms(&w, &c, &recipient, &t, 3, "instant").await?;
    ft_pay(
        &payer,
        t.id().as_str(),
        c.id().as_str(),
        AMOUNT,
        json!({"id": v["id"], "expectedTermsHash": h, "action": "pay_instant"}),
    )
    .await?
    .into_result()?;
    let held = get(&c, &v["id"]).await?;
    std::fs::create_dir_all("../artifacts/sandbox-token")?;
    std::fs::write(
        "../artifacts/sandbox-token/instant-payout-failed.json",
        serde_json::to_string_pretty(&held)?,
    )
    .ok();
    assert_eq!(held["status"], "PAYOUT_FAILED_RECOVERABLE", "{held}");
    assert_eq!(held["latestOperation"]["failureCode"], "FT_TRANSFER_FAILED");
    assert_eq!(
        balance(&t, c.id().as_str()).await?,
        AMOUNT,
        "tokens held by the contract, accounted as failedHeld"
    );
    register(&t, recipient.id().as_str()).await?;
    let retry = recipient
        .call(c.id(), "retry_native_transfer")
        .args_json(json!({"id": v["id"], "expectedOperationNonce": "1"}))
        .deposit(NearToken::from_yoctonear(1))
        .gas(Gas::from_tgas(50))
        .transact()
        .await?;
    println!(
        "MEASURE token retry gas_burnt={}",
        retry.total_gas_burnt.as_gas()
    );
    retry.into_result()?;
    assert_eq!(get(&c, &v["id"]).await?["status"], "FINAL_PAID");
    assert_eq!(balance(&t, recipient.id().as_str()).await?, AMOUNT);
    assert_eq!(balance(&t, c.id().as_str()).await?, 0);
    Ok(())
}

#[tokio::test]
async fn protected_token_refund_returns_tokens_to_payer() -> Result<()> {
    let (w, c, t, payer, recipient) = setup().await?;
    let (v, h) = terms(&w, &c, &recipient, &t, 4, "protected").await?;
    let before = balance(&t, payer.id().as_str()).await?;
    ft_pay(
        &payer,
        t.id().as_str(),
        c.id().as_str(),
        AMOUNT,
        json!({"id": v["id"], "expectedTermsHash": h, "action": "fund_protected",
        "acceptedCancelDurationNs": "60000000000", "consentVersion": "taply.protected-consent.v1"}),
    )
    .await?
    .into_result()?;
    assert_eq!(get(&c, &v["id"]).await?["status"], "LOCKED");
    assert_eq!(balance(&t, c.id().as_str()).await?, AMOUNT);
    let early = payer
        .call(c.id(), "release_protected")
        .args_json(json!({"id": v["id"]}))
        .deposit(NearToken::from_yoctonear(1))
        .gas(Gas::from_tgas(50))
        .transact()
        .await?;
    assert!(fail(&early).contains("CANCELLATION_WINDOW_OPEN"));
    payer
        .call(c.id(), "cancel_protected")
        .args_json(json!({"id": v["id"], "expectedTermsHash": h}))
        .deposit(NearToken::from_yoctonear(1))
        .gas(Gas::from_tgas(50))
        .transact()
        .await?
        .into_result()?;
    let refunded = get(&c, &v["id"]).await?;
    std::fs::create_dir_all("../artifacts/sandbox-token")?;
    std::fs::write(
        "../artifacts/sandbox-token/protected-refunded.json",
        serde_json::to_string_pretty(&refunded)?,
    )
    .ok();
    assert_eq!(refunded["status"], "CANCELLED_REFUNDED");
    assert_eq!(balance(&t, payer.id().as_str()).await?, before);
    assert_eq!(balance(&t, c.id().as_str()).await?, 0);
    Ok(())
}
