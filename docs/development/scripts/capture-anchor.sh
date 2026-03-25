#!/usr/bin/env bash
# Part 1: examples/anchor-once.mjs (in-process Anchorer + mock transport)
# Part 2: anchoring-server boot + POST /anchor + GET /verify/:hash + GET /metrics
set -euo pipefail
cd "$(dirname "$0")/../../.."
mkdir -p docs/development/logs
LOG=docs/development/logs/anchor-run.log
: > "$LOG"

{
  echo "=== anchor run: $(date -u +%FT%TZ) ==="
  echo "=== node $(node -v) ==="
  echo
  echo "--- Part 1: examples/anchor-once.mjs (mock transport) ---"
  node examples/anchor-once.mjs
  echo

  echo "--- Part 2: anchoring-server REST /anchor + /verify/:hash ---"
} | tee -a "$LOG"

PORT=8088
node apps/anchoring-server/dist/server.js --port "$PORT" --mock >>"$LOG" 2>&1 &
SERVER_PID=$!
trap 'kill "$SERVER_PID" 2>/dev/null || true' EXIT

for i in {1..30}; do
  if curl -sS --max-time 1 "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then
    break
  fi
  sleep 0.2
done

{
  echo
  echo "GET /health"
  curl -sS "http://127.0.0.1:$PORT/health"
  echo

  echo "POST /anchor (with explicit hash)"
  ANCHOR_HASH="d2deadbeefcafebabefeedfacedeadbabe000000000000000000000000000000"
  RECORD_JSON=$(curl -sS -X POST -H 'Content-Type: application/json' \
    -d "{\"hash\":\"$ANCHOR_HASH\"}" "http://127.0.0.1:$PORT/anchor")
  echo "$RECORD_JSON"
  echo

  for i in {1..40}; do
    V=$(curl -sS "http://127.0.0.1:$PORT/verify/$ANCHOR_HASH")
    if echo "$V" | grep -q '"anchored":true'; then
      break
    fi
    sleep 0.05
  done

  echo "GET /verify/$ANCHOR_HASH"
  curl -sS "http://127.0.0.1:$PORT/verify/$ANCHOR_HASH"
  echo

  echo "GET /metrics"
  curl -sS "http://127.0.0.1:$PORT/metrics"
  echo

  echo
  echo "=== anchor run: ok ==="
} | tee -a "$LOG"

kill "$SERVER_PID" 2>/dev/null || true
wait "$SERVER_PID" 2>/dev/null || true
