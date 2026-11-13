//! Actual local NEAR sandbox execution, not Mainnet evidence. The standard test
//! token is patched at the fixed USDC identity; no live USDC/router code is used.
//! Production WASM identities and authorization guards are never relaxed.
use anyhow::Result;
use near_workspaces::{Account, AccountDetailsPatch, AccessKey, Contract, Worker, network::Sandbox,
    result::ExecutionFinalResult, types::{Gas, NearToken, SecretKey, KeyType}};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

const USDC: &str = "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const CONTRACT: &str = "devkendinecrypto.near";
const AMOUNT: u128 = 1_000_000;
const NATIVE: u128 = 100_000_000_000_000_000_000_000;

struct Setup { w: Worker<Sandbox>, c: Contract, token: Contract, payer: Account,
    merchant: Account, router: Account, recovery: Account }

async fn local_account(w: &Worker<Sandbox>, name: &str) -> Result<Account> {
    // Explicitly local sandbox state injection, including disposable fixture keys.
    let id = name.parse()?;
    let sk = SecretKey::from_seed(KeyType::ED25519, &format!("taply-sandbox-only-{name}"));
    w.patch(&id).account(AccountDetailsPatch::default().balance(NearToken::from_near(100)).storage_usage(512))
        .access_key(sk.public_key(), AccessKey::full_access()).transact().await?;
    Ok(Account::from_secret_key(id, sk, w))
}
async fn setup(fault: bool) -> Result<Setup> {
    let w = near_workspaces::sandbox().await?;
    let payer = local_account(&w, "payer.near").await?;
    let merchant = local_account(&w, "merchant.near").await?;
    let router = local_account(&w, "intents.near").await?;
    let recovery = local_account(&w, "kendinecrypto.near").await?;
    let token = local_account(&w, USDC).await?.deploy(&std::fs::read("../artifacts/taply_test_token.wasm")?).await?.into_result()?;
    token.call("new").args_json(json!({"owner_id":payer.id(),"total_supply":"1000000000000"})).max_gas().transact().await?.into_result()?;
    let file = if fault { "../artifacts/payments-mainnet-callback-fault.wasm" } else { "../artifacts/payments-mainnet.wasm" };
    let c = local_account(&w, CONTRACT).await?.deploy(&std::fs::read(file)?).await?.into_result()?;
    c.call("new").args_json(json!({"tokens":[{"accountId":USDC,"decimals":6,"symbol":"USDC"}],
        "routerAccountId":"intents.near","recoveryAccountId":"kendinecrypto.near",
        "nativeCapYocto":"1000000000000000000000000","usdcCapBaseUnits":"25000000"}))
        .gas(Gas::from_tgas(30)).transact().await?.into_result()?;
    for who in [c.id().as_str(), router.id().as_str(), recovery.id().as_str()] { register(&token, who).await?; }
    payer.call(token.id(), "ft_transfer").args_json(json!({"receiver_id":router.id(),"amount":"1000000000"}))
        .deposit(NearToken::from_yoctonear(1)).gas(Gas::from_tgas(30)).transact().await?.into_result()?;
    Ok(Setup { w, c, token, payer, merchant, router, recovery })
}
async fn register(t: &Contract, who: &str) -> Result<()> {
    t.call("storage_deposit").args_json(json!({"account_id":who,"registration_only":true}))
        .deposit(NearToken::from_millinear(10)).gas(Gas::from_tgas(30)).transact().await?.into_result()?; Ok(())
}
async fn balance(t: &Contract, who: &str) -> Result<u128> {
    let n: String = t.view("ft_balance_of").args_json(json!({"account_id":who})).await?.json()?; Ok(n.parse()?)
}
fn digest(domain: &str, v: &Value) -> String {
    // serde_json without preserve_order sorts this ASCII-key/string-only schema.
    format!("{:x}", Sha256::digest(format!("{domain}\n{v}")))
}
async fn terms(s: &Setup, n: u64, native: bool) -> Result<Value> {
    let now = s.w.view_block().await?.timestamp();
    let identity = json!({"contractId":CONTRACT,"creationNonce":format!("{n:064x}"),"creatorAccountId":s.merchant.id(),"network":"near-mainnet"});
    Ok(json!({"schemaVersion":"taply.intent.v1","id":digest("taply.id.v1",&identity),"network":"near-mainnet",
        "contractId":CONTRACT,"creationNonce":format!("{n:064x}"),"creatorAccountId":s.merchant.id(),
        "assetId":if native { "near:native".into() } else { format!("nep141:{USDC}") },
        "amountBaseUnits":if native { NATIVE.to_string() } else { AMOUNT.to_string() },
        "mode":"instant","cancelDurationNs":null,"fundingExpiresAtNs":(now+3_600_000_000_000u64).to_string(),
        "permittedPayerAccountId":null,"merchantAccountId":null,"memo":"","sessionBinding":null}))
}
async fn create(s: &Setup, t: &Value) -> Result<()> {
    let q: Value = s.c.view("quote_create_request").args_json(json!({"terms":t})).await?.json()?;
    s.merchant.call(s.c.id(), "create_request").args_json(json!({"terms":t,"quoteVersion":"1"}))
        .deposit(NearToken::from_yoctonear(q["depositYocto"].as_str().unwrap().parse()?))
        .gas(Gas::from_tgas(30)).transact().await?.into_result()?;
    println!("MEASURE storage_quote {q}"); Ok(())
}
fn message(t: &Value) -> String { json!({"id":t["id"],"expectedTermsHash":digest("taply.terms.v1",t),"action":"pay_instant"}).to_string() }
async fn pay(s: &Setup, who: &Account, amount: u128, msg: String, gas: u64) -> Result<ExecutionFinalResult> {
    Ok(who.call(s.token.id(), "ft_transfer_call").args_json(json!({"receiver_id":s.c.id(),"amount":amount.to_string(),"msg":msg}))
        .deposit(NearToken::from_yoctonear(1)).gas(Gas::from_tgas(gas)).transact().await?)
}
async fn request(s: &Setup, t: &Value) -> Result<Value> { Ok(s.c.view("get_request").args_json(json!({"id":t["id"]})).await?.json()?) }
async fn accounting(s: &Setup) -> Result<Value> { Ok(s.c.view("get_accounting").await?.json()?) }
fn number(v: &Value, key: &str) -> u128 { v[key].as_str().unwrap().parse().unwrap() }
async fn conserved(s: &Setup) -> Result<Value> {
    let a = accounting(s).await?; let t = &a["tokens"][0];
    let sum: u128 = ["confirmedPaid","inFlight","failedHeld","locked","refunded","unclaimedHeld","unclaimedInFlight","unclaimedWithdrawn"]
        .iter().map(|k| number(t,k)).sum();
    assert_eq!(number(t,"received"), sum);
    let held = number(t,"failedHeld") + number(t,"locked") + number(t,"unclaimedHeld");
    let actual = balance(&s.token,s.c.id().as_str()).await?;
    assert!(actual >= held && actual <= held + number(t,"inFlight") + number(t,"unclaimedInFlight"), "token balance {actual}, ledger {t}");
    Ok(a)
}
fn evidence(name: &str, r: &ExecutionFinalResult, state: Value) -> Result<()> {
    let outcomes: Vec<_> = r.receipt_outcomes().iter().map(|o| json!({"executor":o.executor_id,"gasBurnt":o.gas_burnt.as_gas().to_string(),
        "success":o.is_success(),"logs":o.logs,"blockHash":o.block_hash.to_string()})).collect();
    let v = json!({"kind":"LOCAL_SANDBOX_NOT_MAINNET","usesStandardTestTokenNotLiveUsdc":true,"totalGasBurnt":r.total_gas_burnt.as_gas().to_string(),"outcomes":outcomes,"state":state});
    std::fs::create_dir_all("../artifacts/mainnet-sandbox")?;
    std::fs::write(format!("../artifacts/mainnet-sandbox/{name}.json"),serde_json::to_string_pretty(&v)?)?;
    println!("MEASURE {name} gas_burnt={}",r.total_gas_burnt.as_gas()); Ok(())
}
async fn recovery(s: &Setup, who: &Account, amount: u128, receiver: &str) -> Result<ExecutionFinalResult> {
    Ok(who.call(s.c.id(), "withdraw_unclaimed").args_json(json!({"token":USDC,"amount":amount.to_string(),"receiver":receiver}))
        .deposit(NearToken::from_yoctonear(1)).gas(Gas::from_tgas(50)).transact().await?)
}

#[tokio::test]
async fn exact_direct_usdc_and_native_payouts_are_observed() -> Result<()> {
    let s = setup(false).await?; register(&s.token,s.merchant.id().as_str()).await?;
    let t = terms(&s,1,false).await?; create(&s,&t).await?;
    for amount in [AMOUNT-1, AMOUNT+1] {
        let before = balance(&s.token,s.payer.id().as_str()).await?;
        let r = pay(&s,&s.payer,amount,message(&t),100).await?;
        assert_eq!(r.json::<String>()?,"0"); // standard token returns used amount
        assert_eq!(balance(&s.token,s.payer.id().as_str()).await?,before);
    }
    let r = pay(&s,&s.payer,AMOUNT,message(&t),100).await?;
    assert_eq!(r.clone().json::<String>()?,AMOUNT.to_string());
    assert_eq!(request(&s,&t).await?["status"],"FINAL_PAID");
    assert_eq!(balance(&s.token,s.merchant.id().as_str()).await?,AMOUNT);
    evidence("direct-usdc",&r,conserved(&s).await?)?;
    let t = terms(&s,2,true).await?; create(&s,&t).await?; s.w.fast_forward(10).await?;
    let before = s.merchant.view_account().await?.balance.as_yoctonear();
    let r = s.payer.call(s.c.id(),"pay_instant_native").args_json(json!({"id":t["id"],"expectedTermsHash":digest("taply.terms.v1",&t)}))
        .deposit(NearToken::from_yoctonear(NATIVE)).gas(Gas::from_tgas(50)).transact().await?;
    r.clone().into_result()?;
    assert_eq!(request(&s,&t).await?["status"],"FINAL_PAID");
    assert_eq!(s.merchant.view_account().await?.balance.as_yoctonear()-before,NATIVE);
    evidence("direct-native",&r,accounting(&s).await?)?; Ok(())
}

#[tokio::test]
async fn router_overpayment_duplicate_and_concurrent_attempts_conserve() -> Result<()> {
    let s=setup(false).await?; register(&s.token,s.merchant.id().as_str()).await?;
    let t=terms(&s,3,false).await?; create(&s,&t).await?;
    let r=pay(&s,&s.router,AMOUNT+123,message(&t),300).await?;
    assert_eq!(r.clone().json::<String>()?,(AMOUNT+123).to_string());
    assert_eq!(request(&s,&t).await?["status"],"FINAL_PAID");
    let r2=pay(&s,&s.router,AMOUNT,message(&t),300).await?; r2.into_result()?;
    assert_eq!(balance(&s.token,s.merchant.id().as_str()).await?,AMOUNT);
    assert_eq!(number(&conserved(&s).await?["tokens"][0],"unclaimedHeld"),AMOUNT+123);
    evidence("router-overpayment-duplicate",&r,conserved(&s).await?)?;
    let t=terms(&s,4,false).await?; create(&s,&t).await?;
    // Distinct funded signers avoid same-key nonce collisions while racing one intent.
    let (a,b)=tokio::join!(pay(&s,&s.router,AMOUNT,message(&t),300),pay(&s,&s.payer,AMOUNT,message(&t),100));
    let a=a?; let b=b?; a.clone().into_result()?; b.into_result()?;
    assert_eq!(request(&s,&t).await?["status"],"FINAL_PAID");
    assert_eq!(balance(&s.token,s.merchant.id().as_str()).await?,AMOUNT*2);
    evidence("concurrent-funding",&a,conserved(&s).await?)?; Ok(())
}

#[tokio::test]
async fn malformed_unknown_underpaid_wrong_hash_asset_mode_cancelled_and_restricted_are_held() -> Result<()> {
    let s=setup(false).await?; let t=terms(&s,5,false).await?; create(&s,&t).await?;
    let mut messages=vec!["{".into(),"x".repeat(1025),"😀".repeat(512),"{\"id\":\"a\",\"id\":\"b\"}".into(),
        json!({"id":"0".repeat(64),"expectedTermsHash":"0".repeat(64),"action":"pay_instant"}).to_string(),
        json!({"id":t["id"],"expectedTermsHash":"0".repeat(64),"action":"pay_instant"}).to_string(),
        json!({"id":t["id"],"expectedTermsHash":digest("taply.terms.v1",&t),"action":"fund_protected"}).to_string()];
    let native=terms(&s,6,true).await?; create(&s,&native).await?; messages.push(message(&native));
    let mut restricted=terms(&s,7,false).await?; restricted["permittedPayerAccountId"]=json!(s.payer.id()); create(&s,&restricted).await?; messages.push(message(&restricted));
    let cancelled=terms(&s,8,false).await?; create(&s,&cancelled).await?;
    s.merchant.call(s.c.id(),"cancel_unfunded").args_json(json!({"id":cancelled["id"],"expectedTermsHash":digest("taply.terms.v1",&cancelled)}))
        .deposit(NearToken::from_yoctonear(1)).gas(Gas::from_tgas(15)).transact().await?.into_result()?; messages.push(message(&cancelled));
    for (i,msg) in messages.into_iter().enumerate() {
        let r=pay(&s,&s.router,AMOUNT,msg,300).await?;
        assert_eq!(r.clone().json::<String>()?,AMOUNT.to_string());
        evidence(&format!("router-rejected-{i}"),&r,conserved(&s).await?)?;
    }
    let r=pay(&s,&s.router,AMOUNT-1,message(&t),300).await?;
    assert_eq!(r.clone().json::<String>()?,(AMOUNT-1).to_string());
    assert_eq!(request(&s,&t).await?["status"],"OPEN");
    assert_eq!(number(&conserved(&s).await?["tokens"][0],"received"),AMOUNT*11-1);
    evidence("router-underpayment",&r,conserved(&s).await?)?; Ok(())
}

#[tokio::test]
async fn router_gas_envelope_holds_low_gas_and_settles_sufficient_gas() -> Result<()> {
    let s=setup(false).await?; register(&s.token,s.merchant.id().as_str()).await?;
    for (i,gas) in [50,60,80,100,150,300].into_iter().enumerate() {
        let t=terms(&s,100+i as u64,false).await?; create(&s,&t).await?;
        let r=pay(&s,&s.router,AMOUNT,message(&t),gas).await?;
        assert_eq!(r.clone().json::<String>()?,AMOUNT.to_string(),"router refund at {gas} TGas");
        let state=request(&s,&t).await?;
        if gas==50 { assert_eq!(state["status"],"OPEN"); assert!(r.logs().iter().any(|l|l.contains("LOW_GAS"))); }
        if gas>=100 { assert_eq!(state["status"],"FINAL_PAID"); }
        assert!(state["status"]=="OPEN" || state["status"]=="FINAL_PAID");
        evidence(&format!("router-outer-gas-{gas}"),&r,json!({"request":state,"accounting":conserved(&s).await?}))?;
    } Ok(())
}

#[tokio::test]
async fn payout_and_recovery_failures_have_safe_explicit_retries() -> Result<()> {
    let s=setup(false).await?; let t=terms(&s,9,false).await?; create(&s,&t).await?;
    let r=pay(&s,&s.router,AMOUNT,message(&t),300).await?; r.clone().into_result()?;
    assert_eq!(request(&s,&t).await?["status"],"PAYOUT_FAILED_RECOVERABLE");
    assert_eq!(balance(&s.token,s.c.id().as_str()).await?,AMOUNT); evidence("payout-failure",&r,conserved(&s).await?)?;
    assert!(recovery(&s,&s.recovery,1,s.payer.id().as_str()).await?.is_failure()); // cannot touch request funds
    register(&s.token,s.merchant.id().as_str()).await?;
    s.merchant.call(s.c.id(),"retry_native_transfer").args_json(json!({"id":t["id"],"expectedOperationNonce":"1"}))
        .deposit(NearToken::from_yoctonear(1)).gas(Gas::from_tgas(50)).transact().await?.into_result()?;
    assert_eq!(request(&s,&t).await?["status"],"FINAL_PAID"); assert_eq!(balance(&s.token,s.merchant.id().as_str()).await?,AMOUNT);
    pay(&s,&s.router,AMOUNT,"bad".into(),300).await?.into_result()?;
    assert!(recovery(&s,&s.payer,AMOUNT,s.payer.id().as_str()).await?.is_failure());
    assert!(recovery(&s,&s.recovery,AMOUNT+1,s.payer.id().as_str()).await?.is_failure());
    let r=recovery(&s,&s.recovery,AMOUNT,"unregistered.near").await?;
    assert!(!r.clone().json::<bool>()?); assert_eq!(number(&conserved(&s).await?["tokens"][0],"unclaimedHeld"),AMOUNT);
    evidence("recovery-failed",&r,conserved(&s).await?)?;
    let before=balance(&s.token,s.payer.id().as_str()).await?;
    let r=recovery(&s,&s.recovery,AMOUNT,s.payer.id().as_str()).await?; assert!(r.clone().json::<bool>()?);
    assert_eq!(balance(&s.token,s.payer.id().as_str()).await?-before,AMOUNT);
    assert_eq!(number(&conserved(&s).await?["tokens"][0],"unclaimedWithdrawn"),AMOUNT);
    evidence("recovery-succeeded",&r,conserved(&s).await?)?; Ok(())
}

#[tokio::test]
async fn callback_failure_never_falsely_finalizes_or_retries_paid_tokens() -> Result<()> {
    let s=setup(true).await?; register(&s.token,s.merchant.id().as_str()).await?;
    let t=terms(&s,10,false).await?; create(&s,&t).await?;
    let r=pay(&s,&s.router,AMOUNT,message(&t),300).await?; r.clone().into_result()?;
    assert_eq!(balance(&s.token,s.merchant.id().as_str()).await?,AMOUNT);
    assert_eq!(request(&s,&t).await?["status"],"PAYOUT_IN_FLIGHT");
    let retry=s.merchant.call(s.c.id(),"retry_native_transfer").args_json(json!({"id":t["id"],"expectedOperationNonce":"1"}))
        .deposit(NearToken::from_yoctonear(1)).gas(Gas::from_tgas(50)).transact().await?;
    assert!(retry.is_failure()); evidence("r2-payout",&r,conserved(&s).await?)?;
    pay(&s,&s.router,AMOUNT,"bad".into(),300).await?.into_result()?;
    let before=balance(&s.token,s.payer.id().as_str()).await?;
    let r=recovery(&s,&s.recovery,AMOUNT,s.payer.id().as_str()).await?; assert!(r.is_failure());
    assert_eq!(balance(&s.token,s.payer.id().as_str()).await?-before,AMOUNT);
    assert_eq!(number(&conserved(&s).await?["tokens"][0],"unclaimedInFlight"),AMOUNT);
    assert!(recovery(&s,&s.recovery,AMOUNT,s.payer.id().as_str()).await?.is_failure());
    evidence("r2-recovery",&r,conserved(&s).await?)?; Ok(())
}

#[tokio::test]
async fn expired_direct_is_refunded_but_late_open_router_delivery_settles() -> Result<()> {
    let s=setup(false).await?; register(&s.token,s.merchant.id().as_str()).await?;
    let mut t=terms(&s,11,false).await?;
    let expiry=s.w.view_block().await?.timestamp()+60_000_000_000;
    t["fundingExpiresAtNs"]=json!(expiry.to_string()); create(&s,&t).await?;
    for _ in 0..50 { if s.w.view_block().await?.timestamp()>=expiry {break;} s.w.fast_forward(50).await?; }
    assert!(s.w.view_block().await?.timestamp()>=expiry);
    let r=pay(&s,&s.payer,AMOUNT,message(&t),100).await?; assert_eq!(r.json::<String>()?,"0");
    let r=pay(&s,&s.router,AMOUNT,message(&t),300).await?;
    assert_eq!(request(&s,&t).await?["status"],"FINAL_PAID");
    assert_eq!(balance(&s.token,s.merchant.id().as_str()).await?,AMOUNT);
    evidence("late-router",&r,conserved(&s).await?)?; Ok(())
}
