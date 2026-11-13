//! Taply Gift on a REAL local NEAR node (near-workspaces sandbox). Disposable
//! local accounts only. Proves runtime behaviour unit tests cannot: real
//! transfers and balances, rollback on panic, concurrent claims, chain time,
//! and that an unknown payout outcome is never re-paid (fault build).
use anyhow::Result;
use ed25519_dalek::{Signer, SigningKey};
use near_workspaces::{
    Account, Contract, Worker,
    network::Sandbox,
    result::ExecutionFinalResult,
    types::{Gas, NearToken},
};
use serde_json::{Value, json};

const ONE_NEAR: u128 = 1_000_000_000_000_000_000_000_000;
const FEE: u128 = 10_000_000_000_000_000_000_000;
const LIFETIME_S: u64 = 600;

fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}
fn key(seed: u8) -> SigningKey {
    SigningKey::from_bytes(&[seed; 32])
}
fn sign(k: &SigningKey, contract: &str, id: &str, claimant: &str) -> String {
    hex(&k
        .sign(format!("taply-gift-claim:v1:{contract}:{id}:{claimant}").as_bytes())
        .to_bytes())
}
fn measure(step: &str, r: &ExecutionFinalResult) {
    println!("MEASURE {step} gas_burnt={}", r.total_gas_burnt.as_gas());
}
fn failure_text(r: &ExecutionFinalResult) -> String {
    format!("{:?}", r.clone().into_result().err())
}
fn burnt(r: &ExecutionFinalResult) -> u128 {
    // Only receipts paid by the signer: the transaction and its first receipt.
    r.outcomes()
        .iter()
        .map(|o| o.tokens_burnt.as_yoctonear())
        .sum()
}

async fn setup(wasm: &str) -> Result<(Worker<Sandbox>, Contract, Account, Account, Account)> {
    let w = near_workspaces::sandbox().await?;
    let c = w.dev_deploy(&std::fs::read(wasm)?).await?;
    c.call("new").max_gas().transact().await?.into_result()?;
    let creator = w.dev_create_account().await?;
    let bob = w.dev_create_account().await?;
    let carol = w.dev_create_account().await?;
    Ok((w, c, creator, bob, carol))
}

async fn create(
    c: &Contract,
    creator: &Account,
    id: &str,
    k: &SigningKey,
    lifetime_s: u64,
) -> Result<ExecutionFinalResult> {
    let r = creator
        .call(c.id(), "create_gift")
        .args_json(json!({"gift_id": id, "public_key": hex(k.verifying_key().as_bytes()),
            "amount": ONE_NEAR.to_string(), "lifetime_s": lifetime_s, "message": "Happy hacking 🎁", "design": 1}))
        .deposit(NearToken::from_yoctonear(ONE_NEAR + FEE))
        .gas(Gas::from_tgas(30))
        .transact()
        .await?;
    measure("create_gift", &r);
    Ok(r)
}

async fn claim(
    c: &Contract,
    who: &Account,
    id: &str,
    k: &SigningKey,
) -> Result<ExecutionFinalResult> {
    let r = who
        .call(c.id(), "claim_gift")
        .args_json(
            json!({"gift_id": id, "signature": sign(k, c.id().as_str(), id, who.id().as_str())}),
        )
        .gas(Gas::from_tgas(50))
        .transact()
        .await?;
    measure("claim_gift", &r);
    Ok(r)
}

async fn gift(c: &Contract, id: &str) -> Result<Value> {
    Ok(c.view("get_gift")
        .args_json(json!({"gift_id": id}))
        .await?
        .json()?)
}
async fn accounting(c: &Contract) -> Result<Value> {
    Ok(c.view("get_accounting")
        .args_json(json!({}))
        .await?
        .json()?)
}
fn n(v: &Value, f: &str) -> u128 {
    v[f].as_str().unwrap().parse().unwrap()
}
async fn balance(a: &Account) -> Result<u128> {
    Ok(a.view_account().await?.balance.as_yoctonear())
}
async fn wait_until(w: &Worker<Sandbox>, target_ns: u64) -> Result<()> {
    for _ in 0..60 {
        if w.view_block().await?.timestamp() >= target_ns {
            return Ok(());
        }
        w.fast_forward(100).await?;
    }
    anyhow::bail!("chain time never reached {target_ns}")
}
/// The contract's balance must cover its storage plus every held/failed principal.
async fn assert_solvent(w: &Worker<Sandbox>, c: &Contract) -> Result<()> {
    let a = accounting(c).await?;
    let acct = c.view_account().await?;
    let storage_cost = acct.storage_usage as u128 * 10_000_000_000_000_000_000u128;
    let required = storage_cost + n(&a, "heldYocto") + n(&a, "failedHeldYocto");
    let bal = acct.balance.as_yoctonear();
    println!("SOLVENCY balance={bal} required={required} accounting={a}");
    assert!(bal >= required, "contract under-collateralised");
    assert_eq!(
        n(&a, "depositedYocto"),
        n(&a, "heldYocto")
            + n(&a, "inFlightYocto")
            + n(&a, "failedHeldYocto")
            + n(&a, "claimedPaidYocto")
            + n(&a, "refundedYocto")
    );
    let _ = w;
    Ok(())
}

#[tokio::test]
async fn real_claim_pays_exactly_the_signed_claimant() -> Result<()> {
    let (w, c, creator, bob, carol) = setup("../artifacts/taply-gift.wasm").await?;
    let id = "11111111111111111111111111111111";
    let k = key(1);
    let creator_before = balance(&creator).await?;
    let r = create(&c, &creator, id, &k, LIFETIME_S).await?;
    let create_burnt = burnt(&r);
    r.into_result()?;
    let g = gift(&c, id).await?;
    println!("SNAPSHOT created {g}");
    assert_eq!(g["status"], "AVAILABLE");
    w.fast_forward(3).await?;
    let creator_after = balance(&creator).await?;
    assert!(creator_before - creator_after >= ONE_NEAR + FEE);
    assert!(creator_before - creator_after <= ONE_NEAR + FEE + create_burnt);
    assert_solvent(&w, &c).await?;

    // Creator cannot claim; a forged signature (Carol's) for Bob is refused.
    let r = claim(&c, &creator, id, &k).await?;
    assert!(
        failure_text(&r).contains("CREATOR_CANNOT_CLAIM"),
        "{}",
        failure_text(&r)
    );
    let forged = bob
        .call(c.id(), "claim_gift")
        .args_json(
            json!({"gift_id": id, "signature": sign(&k, c.id().as_str(), id, carol.id().as_str())}),
        )
        .gas(Gas::from_tgas(50))
        .transact()
        .await?;
    assert!(failure_text(&forged).contains("BAD_CLAIM_SIGNATURE"));

    // Let the gas refund of Bob's refused attempt land before measuring.
    w.fast_forward(5).await?;
    let bob_before = balance(&bob).await?;
    let r = claim(&c, &bob, id, &k).await?;
    let gas_paid = burnt(&r);
    r.into_result()?;
    w.fast_forward(5).await?;
    let bob_after = balance(&bob).await?;
    let g = gift(&c, id).await?;
    println!("SNAPSHOT claimed {g}");
    assert_eq!(g["status"], "CLAIMED");
    assert_eq!(g["beneficiary"], bob.id().as_str());
    assert_eq!(g["payout"], "CONFIRMED");
    // Bob received exactly 1 NEAR minus what he paid in gas (gas refunds included).
    let delta = bob_after as i128 - bob_before as i128;
    assert!(
        delta <= ONE_NEAR as i128 && delta >= ONE_NEAR as i128 - gas_paid as i128,
        "delta {delta} gas {gas_paid}"
    );
    let a = accounting(&c).await?;
    assert_eq!(n(&a, "claimedPaidYocto"), ONE_NEAR);
    assert_eq!(n(&a, "inFlightYocto"), 0);
    assert_solvent(&w, &c).await?;

    // Bob again, then Carol: both refused on chain, balances unchanged except gas.
    for who in [&bob, &carol] {
        let r = claim(&c, who, id, &k).await?;
        assert!(
            failure_text(&r).contains("ALREADY_SETTLED"),
            "{}",
            failure_text(&r)
        );
    }
    assert_eq!(n(&accounting(&c).await?, "claimedPaidYocto"), ONE_NEAR);
    Ok(())
}

#[tokio::test]
async fn real_concurrent_claims_have_exactly_one_winner() -> Result<()> {
    let (w, c, creator, bob, carol) = setup("../artifacts/taply-gift.wasm").await?;
    let k = key(2);
    let dave = w.dev_create_account().await?;
    let erin = w.dev_create_account().await?;
    for round in 0..3u8 {
        let id = format!("{:032x}", 0xc0ffee00u32 + round as u32);
        create(&c, &creator, &id, &k, LIFETIME_S)
            .await?
            .into_result()?;
        let claimants = [&bob, &carol, &dave, &erin];
        let results = futures_join(claimants.iter().map(|a| claim(&c, a, &id, &k)).collect()).await;
        let mut winners = vec![];
        for (a, r) in claimants.iter().zip(results) {
            let r = r?;
            if r.is_success() {
                winners.push(a.id().to_string());
            } else {
                assert!(
                    failure_text(&r).contains("ALREADY_SETTLED"),
                    "{}",
                    failure_text(&r)
                );
            }
        }
        assert_eq!(winners.len(), 1, "round {round}: winners {winners:?}");
        let g = gift(&c, &id).await?;
        println!("SNAPSHOT race round {round} winner {} {g}", winners[0]);
        assert_eq!(g["beneficiary"], winners[0].as_str());
        assert_eq!(g["payout"], "CONFIRMED");
    }
    let a = accounting(&c).await?;
    assert_eq!(n(&a, "claimedPaidYocto"), 3 * ONE_NEAR);
    assert_solvent(&w, &c).await?;
    Ok(())
}

async fn futures_join<F: std::future::Future<Output = Result<ExecutionFinalResult>>>(
    fs: Vec<F>,
) -> Vec<Result<ExecutionFinalResult>> {
    let handles: Vec<_> = fs.into_iter().collect();
    let mut out = Vec::new();
    // Polled together so all transactions are in flight at the same time.
    let joined = async {
        let mut pinned: Vec<std::pin::Pin<Box<F>>> = handles.into_iter().map(Box::pin).collect();
        let mut results: Vec<Option<Result<ExecutionFinalResult>>> =
            (0..pinned.len()).map(|_| None).collect();
        std::future::poll_fn(|cx| {
            let mut pending = false;
            for (i, f) in pinned.iter_mut().enumerate() {
                if results[i].is_none() {
                    match f.as_mut().poll(cx) {
                        std::task::Poll::Ready(v) => results[i] = Some(v),
                        std::task::Poll::Pending => pending = true,
                    }
                }
            }
            if pending {
                std::task::Poll::Pending
            } else {
                std::task::Poll::Ready(())
            }
        })
        .await;
        results.into_iter().map(Option::unwrap).collect::<Vec<_>>()
    };
    out.extend(joined.await);
    out
}

#[tokio::test]
async fn real_expiry_blocks_claims_and_only_creator_refunds() -> Result<()> {
    let (w, c, creator, bob, _carol) = setup("../artifacts/taply-gift.wasm").await?;
    let id = "22222222222222222222222222222222";
    let k = key(3);
    create(&c, &creator, id, &k, LIFETIME_S)
        .await?
        .into_result()?;
    let r = creator
        .call(c.id(), "refund_gift")
        .args_json(json!({"gift_id": id}))
        .gas(Gas::from_tgas(50))
        .transact()
        .await?;
    assert!(
        failure_text(&r).contains("NOT_EXPIRED"),
        "{}",
        failure_text(&r)
    );
    let expires: u64 = gift(&c, id).await?["expiresAtNs"]
        .as_str()
        .unwrap()
        .parse()?;
    wait_until(&w, expires).await?;
    assert_eq!(gift(&c, id).await?["status"], "EXPIRED");
    let r = claim(&c, &bob, id, &k).await?;
    assert!(
        failure_text(&r).contains("GIFT_EXPIRED"),
        "{}",
        failure_text(&r)
    );
    let r = bob
        .call(c.id(), "refund_gift")
        .args_json(json!({"gift_id": id}))
        .gas(Gas::from_tgas(50))
        .transact()
        .await?;
    assert!(
        failure_text(&r).contains("CREATOR_ONLY"),
        "{}",
        failure_text(&r)
    );
    let before = balance(&creator).await?;
    let r = creator
        .call(c.id(), "refund_gift")
        .args_json(json!({"gift_id": id}))
        .gas(Gas::from_tgas(50))
        .transact()
        .await?;
    measure("refund_gift", &r);
    let gas_paid = burnt(&r);
    r.into_result()?;
    w.fast_forward(5).await?;
    let delta = balance(&creator).await? as i128 - before as i128;
    assert!(
        delta <= ONE_NEAR as i128 && delta >= ONE_NEAR as i128 - gas_paid as i128,
        "delta {delta}"
    );
    let g = gift(&c, id).await?;
    println!("SNAPSHOT refunded {g}");
    assert_eq!(g["status"], "REFUNDED");
    assert_eq!(g["payout"], "CONFIRMED");
    let r = creator
        .call(c.id(), "refund_gift")
        .args_json(json!({"gift_id": id}))
        .gas(Gas::from_tgas(50))
        .transact()
        .await?;
    assert!(failure_text(&r).contains("ALREADY_SETTLED"));
    let a = accounting(&c).await?;
    assert_eq!(n(&a, "refundedYocto"), ONE_NEAR);
    assert_solvent(&w, &c).await?;
    Ok(())
}

#[tokio::test]
async fn real_bad_inputs_are_refused_and_roll_back() -> Result<()> {
    let (w, c, creator, bob, _carol) = setup("../artifacts/taply-gift.wasm").await?;
    let k = key(4);
    let before = balance(&creator).await?;
    for (deposit, code) in [
        (ONE_NEAR, "WRONG_DEPOSIT"),
        (ONE_NEAR + FEE - 1, "WRONG_DEPOSIT"),
        (ONE_NEAR + FEE + 1, "WRONG_DEPOSIT"),
    ] {
        let r = creator
            .call(c.id(), "create_gift")
            .args_json(json!({"gift_id": "33333333333333333333333333333333", "public_key": hex(k.verifying_key().as_bytes()),
                "amount": ONE_NEAR.to_string(), "lifetime_s": LIFETIME_S, "message": "", "design": 0}))
            .deposit(NearToken::from_yoctonear(deposit))
            .gas(Gas::from_tgas(30))
            .transact()
            .await?;
        assert!(failure_text(&r).contains(code), "{}", failure_text(&r));
    }
    for bad in ["../x", "ABCDEF0123456789ABCDEF0123456789", "1"] {
        let r = bob
            .call(c.id(), "claim_gift")
            .args_json(json!({"gift_id": bad, "signature": "00"}))
            .gas(Gas::from_tgas(50))
            .transact()
            .await?;
        assert!(
            failure_text(&r).contains("INVALID_GIFT_ID"),
            "{}",
            failure_text(&r)
        );
        assert!(
            c.view("get_gift")
                .args_json(json!({"gift_id": bad}))
                .await?
                .json::<Value>()?
                .is_null()
        );
    }
    // Failed creations refunded their deposits: only gas was spent.
    w.fast_forward(5).await?;
    assert!(before - balance(&creator).await? < ONE_NEAR / 100);
    let a = accounting(&c).await?;
    assert_eq!(n(&a, "giftCount"), 0);
    assert_eq!(n(&a, "depositedYocto"), 0);
    Ok(())
}

/// TEST-ONLY fault build: the payout callback always panics after the real
/// transfer succeeded (the R-2 situation). The gift must stay CLAIMED/PENDING,
/// the claimant keeps the one payout, and nothing can pay again.
#[tokio::test]
async fn fault_build_unknown_outcome_is_never_repaid() -> Result<()> {
    let (w, c, creator, bob, carol) = setup("../artifacts/taply-gift-FAULT-TEST-ONLY.wasm").await?;
    let id = "44444444444444444444444444444444";
    let k = key(5);
    create(&c, &creator, id, &k, LIFETIME_S)
        .await?
        .into_result()?;
    let bob_before = balance(&bob).await?;
    let r = claim(&c, &bob, id, &k).await?;
    let gas_paid = burnt(&r);
    // The claim receipt itself succeeded; the callback receipt failed.
    let callback_failed = r
        .receipt_failures()
        .iter()
        .any(|f| format!("{f:?}").contains("SANDBOX_CALLBACK_FAULT"));
    assert!(callback_failed, "{:?}", r.receipt_failures());
    w.fast_forward(5).await?;
    let delta = balance(&bob).await? as i128 - bob_before as i128;
    assert!(
        delta >= ONE_NEAR as i128 - gas_paid as i128,
        "transfer itself landed: {delta}"
    );
    let g = gift(&c, id).await?;
    println!("SNAPSHOT fault-unknown {g}");
    assert_eq!(g["status"], "CLAIMED");
    assert_eq!(g["payout"], "PENDING");
    let r = bob
        .call(c.id(), "retry_payout")
        .args_json(json!({"gift_id": id}))
        .gas(Gas::from_tgas(50))
        .transact()
        .await?;
    assert!(
        failure_text(&r).contains("PAYOUT_NOT_FAILED"),
        "{}",
        failure_text(&r)
    );
    let r = claim(&c, &carol, id, &k).await?;
    assert!(failure_text(&r).contains("ALREADY_SETTLED"));
    let expires: u64 = g["expiresAtNs"].as_str().unwrap().parse()?;
    wait_until(&w, expires).await?;
    let r = creator
        .call(c.id(), "refund_gift")
        .args_json(json!({"gift_id": id}))
        .gas(Gas::from_tgas(50))
        .transact()
        .await?;
    assert!(failure_text(&r).contains("ALREADY_SETTLED"));
    let a = accounting(&c).await?;
    assert_eq!(n(&a, "inFlightYocto"), ONE_NEAR, "unknown stays in flight");
    assert_eq!(
        n(&a, "claimedPaidYocto"),
        0,
        "unknown is not reported as paid"
    );
    Ok(())
}
