#!/usr/bin/env bash
set -euo pipefail
# This context builds ONLY the unapproved merchant candidate.
exec bash "$(dirname "$0")/build-merchant.sh" "$@"
