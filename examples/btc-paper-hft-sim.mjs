#!/usr/bin/env node
/**
 * Five-minute BTC simulation: live Alpaca **crypto** WebSocket drives the local
 * deterministic matcher (`BTCUSDT` market config), with a rolling SHA-256 event
 * log and periodic **mock Hydra** anchors (same pattern as `anchor-once.mjs`).
 *
 * Env:
 *   - `APCA_API_KEY_ID` + `APCA_API_SECRET_KEY` — required for **live** crypto data
 *   - `DURATION_MS` — default `300000` (5 minutes)
 *   - `CRYPTO_PAIR` — default `BTC/USD` (Alpaca crypto symbol)
 *   - `ALPACA_CRYPTO_WS_URL` — default Alpaca US crypto stream
 *
 * If keys are missing, runs a **synthetic** BTCUSDT feed for the same duration
 * (deterministic, no network) so CI and local demos still work.
 */
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { loadDotEnv } from "./_loadEnv.mjs";
loadDotEnv(import.meta.url);

import WebSocket from "ws";

import { loadMarketConfig, applyTo } from "@hydra-ws/market-config";
import { MatchingEngine, EventLog, SyntheticFeed } from "@hydra-ws/core";
import { Anchorer, MockHydraAnchorTransport } from "@hydra-ws/anchoring";

const SYMBOL = "BTCUSDT";
const DURATION_MS = Number(process.env.DURATION_MS ?? 300_000);
const CRYPTO_PAIR = process.env.CRYPTO_PAIR ?? "BTC/USD";
const WS_CRYPTO =
  process.env.ALPACA_CRYPTO_WS_URL ?? "wss://stream.data.alpaca.markets/v1beta3/crypto/us";

/** USD → integer cents-style ticks (matches Alpaca adapter convention). */
function usdToTicks(p) {
  return Math.round(Number(p) * 100);
}

function summarizeFills(events) {
  let fills = 0;
  for (const e of events) {
    if (e.type === "fill") fills += 1;
  }
  return fills;
}

async function main() {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const cfg = await loadMarketConfig(join(root, "markets", "btcusdt.json"));
  const engine = new MatchingEngine();
  const log = new EventLog();
  const guard = applyTo(engine, cfg);

  function submit(order) {
    const r = guard(order);
    if (!r.rejected) log.append(order, r.events);
    return r;
  }

  const keyId = process.env.APCA_API_KEY_ID;
  const secretKey = process.env.APCA_API_SECRET_KEY;
  const live = Boolean(keyId && secretKey);

  let marketEvents = 0;
  let ordersPlaced = 0;
  let totalFills = 0;
  let lastTicks = 65_000_000;
  let tickCounter = 0;

  const transport = new MockHydraAnchorTransport();
  const anchorer = new Anchorer({
    transport,
    hashSource: () => log.headHash,
  });
  anchorer.start();

  const anchorEvery = 75;
  let anchorsDone = 0;

  function maybeAnchor() {
    if (log.size > 0 && log.size % anchorEvery === 0) {
      try {
        anchorer.anchorOnce();
        anchorsDone += 1;
      } catch {
        /* ignore */
      }
    }
  }

  function placeHftOrdersFromMid(midTicks) {
    tickCounter += 1;
    const spread = 25;
    const bidPx = Math.max(cfg.tick_size, midTicks - spread);
    const askPx = midTicks + spread;
    const oid = `hft-${tickCounter}`;

    const r1 = submit({
      kind: "limit",
      id: `${oid}:bid`,
      symbol: SYMBOL,
      side: "buy",
      priceTicks: bidPx,
      quantity: 1,
    });
    ordersPlaced += 1;
    totalFills += summarizeFills(r1.events);

    const r2 = submit({
      kind: "limit",
      id: `${oid}:ask`,
      symbol: SYMBOL,
      side: "sell",
      priceTicks: askPx,
      quantity: 1,
    });
    ordersPlaced += 1;
    totalFills += summarizeFills(r2.events);

    if (tickCounter % 6 === 0) {
      const r3 = submit({
        kind: "ioc",
        id: `${oid}:cross`,
        symbol: SYMBOL,
        side: "buy",
        priceTicks: askPx,
        quantity: 1,
      });
      ordersPlaced += 1;
      totalFills += summarizeFills(r3.events);
    }

    maybeAnchor();
  }

  const deadline = Date.now() + DURATION_MS;

  if (!live) {
    console.warn(
      "[btc-paper-hft-sim] No APCA_API_KEY_ID / APCA_API_SECRET_KEY — running SYNTHETIC BTCUSDT feed for DURATION_MS.",
    );
    const feed = new SyntheticFeed(SYMBOL, 42, 65_000_000, 120, "crypto");
    while (Date.now() < deadline) {
      const ev = feed.nextEvent();
      marketEvents += 1;
      lastTicks = ev.priceTicks;
      placeHftOrdersFromMid(lastTicks);
      await new Promise((r) => setTimeout(r, 400));
    }
  } else {
    console.log(`[btc-paper-hft-sim] Live Alpaca crypto WS (${CRYPTO_PAIR}) for ${DURATION_MS}ms`);
    await new Promise((resolve, reject) => {
      const ws = new WebSocket(WS_CRYPTO);
      ws.on("open", () => {
        ws.send(JSON.stringify({ action: "auth", key: keyId, secret: secretKey }));
        ws.send(JSON.stringify({ action: "subscribe", trades: [CRYPTO_PAIR] }));
      });
      ws.on("message", (buf) => {
        let parsed;
        try {
          parsed = JSON.parse(buf.toString());
        } catch {
          return;
        }
        const frames = Array.isArray(parsed) ? parsed : [parsed];
        for (const f of frames) {
          if (!f || f.T !== "t" || typeof f.p !== "number") continue;
          marketEvents += 1;
          lastTicks = usdToTicks(f.p);
          placeHftOrdersFromMid(lastTicks);
        }
      });
      ws.on("error", (e) => reject(e));
      const timer = setInterval(() => {
        if (Date.now() >= deadline) {
          clearInterval(timer);
          ws.close();
        }
      }, 500);
      ws.on("close", () => {
        clearInterval(timer);
        resolve();
      });
    });
  }

  if (log.size > 0) {
    try {
      anchorer.anchorOnce();
      anchorsDone += 1; /* final head-hash anchor */
      const t0 = Date.now();
      while (Date.now() - t0 < 2_000) {
        const v = anchorer.verify(log.headHash);
        if (v.anchored) break;
        await new Promise((r) => setTimeout(r, 30));
      }
    } catch {
      /* ignore */
    }
  }
  anchorer.stop();

  const verify = anchorer.verify(log.headHash);
  console.log("\n=== 5m BTC Wall-Street / Hydra-style simulation summary ===");
  console.log(`mode            : ${live ? "live Alpaca crypto" : "synthetic BTCUSDT"}`);
  console.log(`durationMs      : ${DURATION_MS}`);
  console.log(`marketEvents    : ${marketEvents}`);
  console.log(`ordersPlaced    : ${ordersPlaced}`);
  console.log(`fills (engine)  : ${totalFills}`);
  console.log(`eventLog.steps  : ${log.size}`);
  console.log(`eventLog.head   : ${log.headHash.slice(0, 24)}…`);
  console.log(`mockHydraAnchor : anchorsAttempted=${anchorsDone} lastVerified=${verify.anchored}`);
  console.log("---");
  console.log("This run exercises: market-config guards, price-time matcher, hash-chained EventLog,");
  console.log("and MockHydraAnchorTransport + Anchorer (L2-style hash commits), not live Cardano.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
