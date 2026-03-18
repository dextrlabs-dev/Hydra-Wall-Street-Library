#!/usr/bin/env node
/**
 * Five-minute US equity simulation: Alpaca clock + optional IEX WebSocket.
 *
 * With keys and an open regular session, defaults to SPY unless EQUITY_SYMBOL is set.
 * If the session is closed or keys are missing, uses synthetic ticks + synthetic RTH clock.
 */
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { loadDotEnv } from "./_loadEnv.mjs";
loadDotEnv(import.meta.url);

import WebSocket from "ws";

import { loadMarketConfig, applyTo } from "@hydra-ws/market-config";
import { MatchingEngine, EventLog, SyntheticFeed } from "@hydra-ws/core";
import { Anchorer, MockHydraAnchorTransport } from "@hydra-ws/anchoring";

const DURATION_MS = Number(process.env.DURATION_MS ?? 300_000);
const WS_IEX = process.env.ALPACA_DATA_WS_URL ?? "wss://stream.data.alpaca.markets/v2/iex";
const DEFAULT_LIVE_SYMBOL = (process.env.DEFAULT_LIVE_SYMBOL ?? "SPY").toUpperCase();

const { HydraWallStreetSession } = await import("@hydra-ws/sdk");

function quoteMidTicks(f) {
  if (typeof f.bp === "number" && typeof f.ap === "number") {
    return Math.round(((f.bp + f.ap) / 2) * 100);
  }
  if (typeof f.bp === "number") return Math.round(f.bp * 100);
  if (typeof f.ap === "number") return Math.round(f.ap * 100);
  return null;
}

function usdTradeTicks(p) {
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
  const baseCfg = await loadMarketConfig(join(root, "markets", "us_equity.yaml"));

  const keyId = process.env.APCA_API_KEY_ID;
  const secretKey = process.env.APCA_API_SECRET_KEY;
  const keysPresent = Boolean(keyId && secretKey);
  const trading = keysPresent ? HydraWallStreetSession.alpacaFromEnv() : undefined;

  let useLiveStream = keysPresent;
  if (keysPresent && trading) {
    try {
      const clock = await trading.getClock();
      if (!clock.is_open) {
        console.warn(
          `[equity-paper-hft-sim] Alpaca clock: US equity session closed (next_open=${clock.next_open}). Using synthetic feed.`,
        );
        useLiveStream = false;
      }
    } catch (e) {
      console.warn("[equity-paper-hft-sim] Could not read clock:", e.message, "- using synthetic feed.");
      useLiveStream = false;
    }
  }

  const explicitSym = process.env.EQUITY_SYMBOL?.trim();
  const SYMBOL = explicitSym ? explicitSym.toUpperCase() : DEFAULT_LIVE_SYMBOL;
  const cfg = { ...baseCfg, symbol: SYMBOL };

  const engine = new MatchingEngine();
  const log = new EventLog();
  const guardBase = applyTo(engine, cfg);

  let synthClockStep = 0;
  const SYNTH_BASE_MS = Date.parse("2026-06-10T14:30:00.000-04:00");

  function guard(order) {
    if (useLiveStream) return guardBase(order);
    const now = new Date(SYNTH_BASE_MS + synthClockStep * 1000);
    synthClockStep += 1;
    return guardBase(order, now);
  }

  function submit(order) {
    const r = guard(order);
    if (!r.rejected) log.append(order, r.events);
    return r;
  }

  let marketEvents = 0;
  let ordersPlaced = 0;
  let totalFills = 0;
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
    const spread = 10;
    const bidPx = Math.max(cfg.tick_size, midTicks - spread);
    const askPx = midTicks + spread;
    const oid = `eq-${tickCounter}`;

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

  if (!useLiveStream) {
    console.warn(`[equity-paper-hft-sim] Synthetic ${SYMBOL} (keys missing or session closed).`);
    const feed = new SyntheticFeed(SYMBOL, 20250429, 55_000, 45, "equity");
    while (Date.now() < deadline) {
      const ev = feed.nextEvent();
      marketEvents += 1;
      placeHftOrdersFromMid(ev.priceTicks);
      await new Promise((r) => setTimeout(r, 400));
    }
  } else {
    console.log(`[equity-paper-hft-sim] Live Alpaca IEX (${SYMBOL}) for ${DURATION_MS}ms`);
    await new Promise((resolve, reject) => {
      const ws = new WebSocket(WS_IEX);
      ws.on("open", () => {
        ws.send(JSON.stringify({ action: "auth", key: keyId, secret: secretKey }));
        ws.send(
          JSON.stringify({
            action: "subscribe",
            trades: [SYMBOL],
            quotes: [SYMBOL],
            bars: [SYMBOL],
          }),
        );
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
          if (!f || typeof f.S !== "string" || f.S !== SYMBOL) continue;
          let px = null;
          if (f.T === "t" && typeof f.p === "number") px = usdTradeTicks(f.p);
          else if (f.T === "q") px = quoteMidTicks(f);
          if (px == null) continue;
          marketEvents += 1;
          placeHftOrdersFromMid(px);
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
      anchorsDone += 1;
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
  console.log("\n=== 5m US equity / Hydra-style simulation summary ===");
  console.log(`symbol          : ${SYMBOL}`);
  console.log(`mode            : ${useLiveStream ? "live Alpaca IEX" : `synthetic ${SYMBOL}`}`);
  console.log(`durationMs      : ${DURATION_MS}`);
  console.log(`marketEvents    : ${marketEvents}`);
  console.log(`ordersPlaced    : ${ordersPlaced}`);
  console.log(`fills (engine)  : ${totalFills}`);
  console.log(`eventLog.steps  : ${log.size}`);
  console.log(`eventLog.head   : ${log.headHash.slice(0, 24)}…`);
  console.log(`mockHydraAnchor : anchorsAttempted=${anchorsDone} lastVerified=${verify.anchored}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
