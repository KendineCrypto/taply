$ErrorActionPreference = 'Stop'
$contractPath = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$repoPath = (Resolve-Path (Join-Path $PSScriptRoot '../../..')).Path
$buildImage = 'rust:1.95.0-bookworm@sha256:6258907abe69656e41cd992e0b705cdcfabcbbe3db374f92ed2d47121282d4a1'
# No Testnet commands, real credentials, host networking or Docker socket mount.
docker run --rm `
  --mount "type=bind,source=$repoPath,target=/repo,readonly" `
  --mount "type=bind,source=$contractPath,target=/repo/contracts/payments" `
  --mount 'type=volume,source=taply-phase2b-cargo,target=/usr/local/cargo/registry' `
  --mount 'type=volume,source=taply-phase2b-target,target=/repo/contracts/payments/target' `
  --mount 'type=volume,source=taply-phase2b-sandbox-target,target=/repo/contracts/payments/sandbox/target' `
  --workdir /repo/contracts/payments --env CARGO_BUILD_JOBS=2 `
  $buildImage bash scripts/check.sh
if ($LASTEXITCODE -ne 0) { throw "Contract checks failed (exit $LASTEXITCODE)" }
