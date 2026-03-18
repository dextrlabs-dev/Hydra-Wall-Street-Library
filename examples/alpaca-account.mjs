#!/usr/bin/env node
/**
 * Smoke-test Alpaca via the project SDK.
 *
 * - GET /v2/account, GET /v2/orders?status=open
 * - Briefly subscribes to the Market Data WS for AAPL trades/quotes (5 s),
 *   prints a few frames, then closes.
 *
 * Requires APCA_API_KEY_ID + APCA_API_SECRET_KEY in .env.
 */
import { loadDotEnv } from "./_loadEnv.mjs";
loadDotEnv(import.meta.url);

const { HydraWallStreetSession } = await import("@hydra-ws/sdk");

const trading = HydraWallStreetSession.alpacaFromEnv();
if (!trading) {
  console.error("Set APCA_API_KEY_ID / APCA_API_SECRET_KEY (see .env.example or run scripts/setup-env.sh)");
  process.exit(1);
}

console.log("== GET /v2/account ==");
console.log(JSON.stringify(await trading.getAccount(), null, 2));

console.log("\n== GET /v2/orders?status=open ==");
console.log(JSON.stringify(await trading.getOrders("open"), null, 2));

const stream = HydraWallStreetSession.marketStreamFromEnv();
if (!stream) {
  console.log("\n(no market data stream: missing keys)");
  process.exit(0);
}

console.log("\n== Market data stream (5 s) ==");
const frames = [];
let timer;
try {
  await stream.connect({
    onMessage: (raw) => {
      frames.push(raw);
      if (frames.length <= 6) console.log(JSON.stringify(raw));
    },
    onError: (err) => console.error("stream error:", err.message),
  });
  stream.authenticateAndSubscribe(["AAPL"]);
  await new Promise((resolve) => {
    timer = setTimeout(resolve, 5000);
  });
} finally {
  clearTimeout(timer);
  stream.close();
}
console.log(`\nframes received: ${frames.length}`);
