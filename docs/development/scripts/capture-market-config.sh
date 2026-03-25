#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../../.."
mkdir -p docs/development/logs
node docs/development/scripts/capture-market-config.mjs 2>&1 | tee docs/development/logs/market-config.log
