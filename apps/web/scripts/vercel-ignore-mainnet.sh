#!/usr/bin/env bash
# Vercel "Ignored Build Step" for the MAINNET project ONLY (taply-mainnet).
# Do not configure this on the Testnet project `taply`.
#
# Vercel semantics: exit 0 = SKIP the build, exit 1 = BUILD.
#
# The mainnet project builds exactly two branches and nothing else, so a push
# to any Testnet branch (main, release/taplyapp, feature/*) can never produce a
# deployment that carries mainnet environment variables:
#   - release/mainnet  -> Production (mainnet.taplyapp.xyz)
#   - staging/mainnet  -> Preview   (staging contract devkendinecrypto.near)
# Production builds come only from release/mainnet.
set -u
ref="${VERCEL_GIT_COMMIT_REF:-}"
env="${VERCEL_ENV:-}"
if [ "$env" = "production" ] && [ "$ref" = "release/mainnet" ]; then
  echo "mainnet: building Production from release/mainnet"; exit 1
fi
if [ "$env" = "preview" ] && [ "$ref" = "staging/mainnet" ]; then
  echo "mainnet: building staging Preview from staging/mainnet"; exit 1
fi
echo "mainnet: skipping VERCEL_ENV=${env:-?} branch=${ref:-?} (only release/mainnet -> Production, staging/mainnet -> Preview)"
exit 0
