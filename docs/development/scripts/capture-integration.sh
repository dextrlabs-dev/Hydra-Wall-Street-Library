#!/usr/bin/env bash
# Engine REST/WS smoke, Python SDK session, React UI screenshot (Playwright).
#
# Steps:
#   1. Start engine-server with market configs.
#   2. curl REST + WS listener on /stream/BTCUSDT (24/7; equity hours would flake off-session).
#   3. Run _e2-pyclient.py against the engine.
#   4. vite preview + capture-ui-screenshot.mjs -> docs/development/screenshots/react-ui.png
set -euo pipefail
cd "$(dirname "$0")/../../.."

mkdir -p docs/development/logs docs/development/screenshots
REST_LOG=docs/development/logs/engine-rest-ws.log
PY_LOG=docs/development/logs/python-sdk.log
: > "$REST_LOG"
: > "$PY_LOG"

PORT=${ENGINE_PORT:-18080}
UI_PORT=${UI_PORT:-14173}
PYBIN=${PYBIN:-python3}

cleanup() {
  [[ -n "${ENGINE_PID:-}" ]] && kill "$ENGINE_PID" 2>/dev/null || true
  [[ -n "${UI_PID:-}" ]] && kill "$UI_PID" 2>/dev/null || true
  wait 2>/dev/null || true
}
trap cleanup EXIT

for p in "$PORT" "$UI_PORT"; do
  if command -v lsof >/dev/null 2>&1; then
    lsof -ti tcp:"$p" 2>/dev/null | xargs -r kill -9 2>/dev/null || true
  fi
done

echo "=== integration run: $(date -u +%FT%TZ) ===" | tee -a "$REST_LOG"
echo "=== node $(node -v) ===" | tee -a "$REST_LOG"
echo | tee -a "$REST_LOG"

echo "--- launching engine-server on :$PORT ---" | tee -a "$REST_LOG"
node apps/engine-server/dist/server.js --port "$PORT" --markets 'markets/*' --anchor >>"$REST_LOG" 2>&1 &
ENGINE_PID=$!

for i in {1..30}; do
  if curl -sS --max-time 1 "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then break; fi
  sleep 0.2
done

{
  echo
  echo "--- REST: GET /health ---"
  curl -sS "http://127.0.0.1:$PORT/health"; echo

  echo "--- REST: GET /markets ---"
  curl -sS "http://127.0.0.1:$PORT/markets"; echo

  echo "--- REST: POST /orders (buy 10 BTCUSDT @ 65000000) ---"
  curl -sS -X POST -H 'Content-Type: application/json' \
    -d '{"kind":"limit","id":"buy:rest-1","symbol":"BTCUSDT","side":"buy","priceTicks":65000000,"quantity":10}' \
    "http://127.0.0.1:$PORT/orders"; echo

  echo "--- REST: POST /orders (sell 4 BTCUSDT @ 65000000) -- partial fill ---"
  curl -sS -X POST -H 'Content-Type: application/json' \
    -d '{"kind":"limit","id":"sell:rest-2","symbol":"BTCUSDT","side":"sell","priceTicks":65000000,"quantity":4}' \
    "http://127.0.0.1:$PORT/orders"; echo

  echo "--- REST: GET /book/BTCUSDT ---"
  curl -sS "http://127.0.0.1:$PORT/book/BTCUSDT"; echo

  echo "--- REST: GET /metrics ---"
  curl -sS "http://127.0.0.1:$PORT/metrics"; echo

  echo
  echo "--- WS: subscribe /stream/BTCUSDT for 1500ms while submitting one more order ---"
} >> "$REST_LOG"

( sleep 0.3 && curl -sS -X POST -H 'Content-Type: application/json' \
    -d '{"kind":"limit","id":"sell:rest-3","symbol":"BTCUSDT","side":"sell","priceTicks":65000000,"quantity":2}' \
    "http://127.0.0.1:$PORT/orders" >/dev/null ) &

node docs/development/scripts/_ws-listen.mjs "ws://127.0.0.1:$PORT/stream/BTCUSDT" 1500 >> "$REST_LOG" 2>&1 || true

echo "" >> "$REST_LOG"
echo "=== REST/WS session: ok ===" >> "$REST_LOG"

echo "--- Python SDK session ---" | tee -a "$PY_LOG"
ENGINE_URL="http://127.0.0.1:$PORT" "$PYBIN" docs/development/scripts/_e2-pyclient.py >> "$PY_LOG" 2>&1 || {
  echo "python session failed" | tee -a "$PY_LOG"
  exit 1
}

echo "--- launching vite preview on :$UI_PORT ---" >> "$REST_LOG"
( cd apps/web && npx --no-install vite preview --port "$UI_PORT" --strictPort --host 127.0.0.1 ) >> "$REST_LOG" 2>&1 &
UI_PID=$!

for i in {1..40}; do
  if curl -sS --max-time 1 "http://127.0.0.1:$UI_PORT/" >/dev/null 2>&1; then break; fi
  sleep 0.25
done

PLAYWRIGHT_BROWSERS_PATH="${PLAYWRIGHT_BROWSERS_PATH:-}" \
  UI_URL="http://127.0.0.1:$UI_PORT" \
  ENGINE_URL="http://127.0.0.1:$PORT" \
  node docs/development/scripts/capture-ui-screenshot.mjs >> "$REST_LOG" 2>&1 || {
    echo "screenshot failed (continuing)" >> "$REST_LOG"
  }

echo "=== integration run: ok ===" | tee -a "$REST_LOG"
