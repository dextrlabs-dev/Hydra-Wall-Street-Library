#!/usr/bin/env bash
# Local run mirroring .github/workflows/ci.yml (npm build/test, pytest, examples, docker).
set -u
cd "$(dirname "$0")/../../.."

mkdir -p docs/development/logs
LOG=docs/development/logs/ci-local.log
: > "$LOG"

PYBIN=${PYBIN:-python3}
PIPBIN=${PIPBIN:-pip}

run_step() {
  local label="$1"; shift
  local start now elapsed status
  start=$(date +%s)
  {
    echo
    echo "================================================================================"
    echo "STEP: $label"
    echo "CMD : $*"
    echo "TIME: $(date -u +%FT%TZ)"
    echo "================================================================================"
  } | tee -a "$LOG"
  set +e
  ( "$@" ) 2>&1 | tee -a "$LOG"
  status=${PIPESTATUS[0]}
  set -e
  now=$(date +%s)
  elapsed=$(( now - start ))
  echo "=== STEP \"$label\" exit $status (${elapsed}s) ===" | tee -a "$LOG"
  if [[ "$status" -ne 0 ]]; then
    echo "FAIL: stopping at \"$label\"" | tee -a "$LOG"
    exit "$status"
  fi
}

{
  echo "=== ci-local run: $(date -u +%FT%TZ) ==="
  echo "=== node $(node -v) ==="
  echo "=== npm  $(npm -v) ==="
  echo "=== python $($PYBIN -V 2>&1) ==="
  echo "=== docker $(docker --version 2>&1) ==="
  echo
} | tee -a "$LOG"

run_step "npm install"            npm install --no-audit --fund=false
run_step "npm run build"          npm run build
run_step "npm test"               npm test
run_step "pip install -e packages/sdk-python[dev]" \
                                  "$PIPBIN" install -q -e "packages/sdk-python[dev]"
run_step "pytest packages/sdk-python" \
                                  "$PYBIN" -m pytest -q packages/sdk-python
run_step "examples/scenario-trade.mjs" node examples/scenario-trade.mjs
run_step "examples/anchor-once.mjs"    node examples/anchor-once.mjs
run_step "docker build engine"            docker build -f Dockerfile -t hydra-ws/engine:ci .
run_step "docker build web"               docker build -f Dockerfile.web -t hydra-ws/web:ci .

{
  echo
  echo "=== ci-local run: ok ==="
} | tee -a "$LOG"
