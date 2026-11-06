#!/usr/bin/env bash
set -euo pipefail
# Compatibility command: candidate owns its source, targets and artifacts.
exec bash "$(dirname "$0")/../../payments-merchant/scripts/build-merchant.sh" "$@"
