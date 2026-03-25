#!/usr/bin/env bash
# Runs capture-data-path.mjs and tees output to docs/development/logs/data-path.log
set -euo pipefail
cd "$(dirname "$0")/../../.."
mkdir -p docs/development/logs
node docs/development/scripts/capture-data-path.mjs 2>&1 | tee docs/development/logs/data-path.log
