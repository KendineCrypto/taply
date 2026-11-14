# Taply Mainnet contract deployment (OWNER runs this on their own Windows machine).
# Keys never leave this machine. Every money step asks for "YES".
#
#   1. Download the CI-built contracts (logged in to GitHub):
#      https://github.com/KendineCrypto/taply/actions/runs/43564070911/artifacts/14101129620
#      (zip lands in your Downloads folder; no need to unzip)
#   2. PowerShell:
#      iwr https://raw.githubusercontent.com/KendineCrypto/taply/claude/festive-brahmagupta-qkqex1/docs/release/deploy-mainnet-contracts.ps1 -OutFile $env:TEMP\taply-deploy.ps1
#      powershell -ExecutionPolicy Bypass -File $env:TEMP\taply-deploy.ps1
#
# Locks about 7.0 NEAR as contract storage (not spent; owned by the new accounts), ~0.03 NEAR fees.

$ErrorActionPreference = 'Stop'
$Owner = 'kendinecrypto.near'
$Usdc = '17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1'
$Rpc = 'https://rpc.mainnet.fastnear.com'
$Near = @('--yes', 'near-cli-rs')

$Contracts = @(
  [ordered]@{ Key = 'pay'; Account = 'taply-pay.kendinecrypto.near'; File = 'payments-mainnet.wasm.oz'; Balance = '2.75 NEAR'
    Sha = '7e3f8ef126bf8142348384ce93c3f4ef93058082adfc328c5a50db4716c4d671'; CodeHash = '9VpaiMp3Hoq8pVVvCW6oSZrvzBdZoNNgUmLCXrm32wX6'; Usdc = $true
    Init = '{"tokens":[{"accountId":"' + $Usdc + '","decimals":6,"symbol":"USDC"}],"routerAccountId":"intents.near","recoveryAccountId":"kendinecrypto.near","nativeCapYocto":"1000000000000000000000000","usdcCapBaseUnits":"25000000"}' },
  [ordered]@{ Key = 'gift'; Account = 'taply-gift.kendinecrypto.near'; File = 'taply-gift.wasm.oz'; Balance = '1.65 NEAR'
    Sha = '33942d3045d1d9f544ded28aa5dfd9c5272e86d2dc391cf81af24cf38fbf686e'; CodeHash = '4ULqkwn73pc7W9K9ohr4TDvZm6NDLUc8SJo8gJP4S3ob'; Usdc = $false
    Init = '{"network":"near-mainnet","contract_id":"taply-gift.kendinecrypto.near","min_amount":"10000000000000000000000","max_amount":"2000000000000000000000000","fee":"10000000000000000000000"}' },
  [ordered]@{ Key = 'escrow'; Account = 'taply-escrow.kendinecrypto.near'; File = 'payments-protected.wasm.oz'; Balance = '2.60 NEAR'
    Sha = 'ef2c7f4430fff904d8c527ce651b821d5ea84d1c87b17c0be34079324b927333'; CodeHash = 'H6do1Wn1UK2dnPkeW5nRcYkwtXj2UkdCRei8smuaZ6JN'; Usdc = $true
    Init = '{"network":"near-mainnet","contractId":"taply-escrow.kendinecrypto.near","tokens":[{"accountId":"' + $Usdc + '","decimals":6,"symbol":"USDC"}]}' }
)

function B64([string]$s) { [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($s)) }
function Confirm-Step([string]$what) {
  Write-Host ''; Write-Host $what -ForegroundColor Yellow
  if ((Read-Host 'Type YES to continue') -ne 'YES') { throw 'Stopped by owner. Nothing more was sent.' }
}
function View-Account([string]$id) {
  $body = @{ jsonrpc = '2.0'; id = 1; method = 'query'; params = @{ request_type = 'view_account'; finality = 'final'; account_id = $id } } | ConvertTo-Json -Compress
  $r = Invoke-RestMethod -Uri $Rpc -Method Post -ContentType 'application/json' -Body $body
  return $r.result
}
function Near([string[]]$cliArgs) {
  & npx @Near @cliArgs
  if ($LASTEXITCODE -ne 0) { throw "near-cli-rs failed (exit $LASTEXITCODE). Stop and send this output to Claude." }
}

# 0. Find and verify the CI-built WASM files.
$zip = Get-ChildItem "$env:USERPROFILE\Downloads" -Filter 'wasm-size-candidate-150a14f*.zip' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $zip) { throw 'Download the artifact zip first (link at the top of this script).' }
$dir = Join-Path $env:TEMP 'taply-wasm'; if (Test-Path $dir) { Remove-Item $dir -Recurse -Force }
Expand-Archive $zip.FullName -DestinationPath $dir
foreach ($c in $Contracts) {
  $f = Get-ChildItem $dir -Recurse -Filter $c.File | Select-Object -First 1
  if (-not $f) { throw "Missing $($c.File) in the zip." }
  $h = (Get-FileHash $f.FullName -Algorithm SHA256).Hash.ToLower()
  if ($h -ne $c.Sha) { throw "Hash mismatch for $($c.File): $h. Do NOT deploy." }
  $c.Path = $f.FullName
  Write-Host "OK  $($c.File)  sha256 $h" -ForegroundColor Green
}

# 1. Owner key in the local keychain (once). Opens your NEAR wallet in the browser to approve.
$owner = View-Account $Owner
Write-Host ("{0}: {1:N4} NEAR" -f $Owner, ([decimal]$owner.amount / 1e24))
Write-Host ''; Write-Host "Step 1: let near-cli sign as $Owner on THIS computer (adds a key you can remove later)." -ForegroundColor Yellow
$ans = Read-Host 'Type YES to import now, or SKIP if you already did this'
if ($ans -eq 'YES') { Near @('account', 'import-account', 'using-web-wallet', 'network-config', 'mainnet') }
elseif ($ans -ne 'SKIP') { throw 'Stopped by owner. Nothing was sent.' }

foreach ($c in $Contracts) {
  $acc = $c.Account
  if (-not (View-Account $acc)) {
    Confirm-Step "Create $acc with $($c.Balance) from $Owner"
    Near @('account', 'create-account', 'fund-myself', $acc, $c.Balance, 'autogenerate-new-keypair', 'save-to-keychain', 'sign-as', $Owner, 'network-config', 'mainnet', 'sign-with-keychain', 'send')
  }
  $state = View-Account $acc
  if ($state.code_hash -eq $c.CodeHash) { Write-Host "$acc already deployed." -ForegroundColor Green }
  else {
    if ($state.code_hash -ne '11111111111111111111111111111111') { throw "$acc has unexpected code $($state.code_hash). Stop." }
    Confirm-Step "Deploy + initialize $acc (pinned code $($c.CodeHash))"
    Near @('contract', 'deploy', $acc, 'use-file', $c.Path, 'with-init-call', 'new', 'base64-args', (B64 $c.Init), 'prepaid-gas', '100.0 Tgas', 'attached-deposit', '0 NEAR', 'network-config', 'mainnet', 'sign-with-keychain', 'send')
  }
  $state = View-Account $acc
  if ($state.code_hash -ne $c.CodeHash) { throw "$acc code hash $($state.code_hash) does not match the pin. Stop." }
  if ($c.Usdc) {
    Confirm-Step "Register $acc with USDC (0.00125 NEAR from $Owner)"
    Near @('contract', 'call-function', 'as-transaction', $Usdc, 'storage_deposit', 'base64-args', (B64 ('{"account_id":"' + $acc + '","registration_only":true}')), 'prepaid-gas', '30.0 Tgas', 'attached-deposit', '0.00125 NEAR', 'sign-as', $Owner, 'network-config', 'mainnet', 'sign-with-keychain', 'send')
  }
  Write-Host "DONE $acc  code $($state.code_hash)" -ForegroundColor Green
}

# 2. Point the taply-mainnet PREVIEW at the deployed contracts (pinned code hashes). Vercel CLI must be logged in.
$team = 'team_nbUHiN2PQIgh4NOA9Dqnsdag'
$envs = [ordered]@{
  NEXT_PUBLIC_TAPLY_CONTRACT_ID = 'taply-pay.kendinecrypto.near'; NEXT_PUBLIC_TAPLY_CONTRACT_CODE_HASH = $Contracts[0].CodeHash
  NEXT_PUBLIC_TAPLY_GIFT_CONTRACT_ID = 'taply-gift.kendinecrypto.near'; NEXT_PUBLIC_TAPLY_GIFT_CODE_HASH = $Contracts[1].CodeHash
  NEXT_PUBLIC_TAPLY_GIFT_MIN_YOCTO = '10000000000000000000000'; NEXT_PUBLIC_TAPLY_GIFT_MAX_YOCTO = '2000000000000000000000000'; NEXT_PUBLIC_TAPLY_GIFT_FEE_YOCTO = '10000000000000000000000'
  NEXT_PUBLIC_TAPLY_MAINNET_ESCROW_CONTRACT_ID = 'taply-escrow.kendinecrypto.near'; NEXT_PUBLIC_TAPLY_MAINNET_ESCROW_CODE_HASH = $Contracts[2].CodeHash
  NEXT_PUBLIC_TAPLY_MAINNET_USDC_CODE_HASH = (View-Account $Usdc).code_hash
}
Confirm-Step 'Set these on the taply-mainnet PREVIEW environment (not Production)'
$f = Join-Path $env:TEMP 'taply-mainnet-env.json'
foreach ($k in $envs.Keys) {
  [IO.File]::WriteAllText($f, (@{ key = $k; value = $envs[$k]; type = 'encrypted'; target = @('preview') } | ConvertTo-Json -Compress))
  npx vercel@latest api "/v10/projects/taply-mainnet/env?teamId=$team&upsert=true" --method POST --input $f | Out-Null
  Write-Host "env $k set" -ForegroundColor Green
}

Write-Host ''
Write-Host 'All three contracts are live with the pinned code and the Preview is configured.' -ForegroundColor Green
Write-Host 'Last step: Vercel > taply-mainnet > Deployments > latest Preview > ... > Redeploy. Then send this window output to Claude.' -ForegroundColor Green
