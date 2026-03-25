#!/usr/bin/env bash
# Runs examples/scenario-trade.mjs and tees stdout/stderr to
# docs/development/logs/scenario-trade.log.
set -euo pipefail
cd "$(dirname "$0")/../../.."
mkdir -p docs/development/logs
{
  echo "=== scenario-trade run: $(date -u +%FT%TZ) ==="
  echo "=== node $(node -v) ==="
  node examples/scenario-trade.mjs
  echo "=== scenario-trade run: ok ==="
} 2>&1 | tee docs/development/logs/scenario-trade.log
