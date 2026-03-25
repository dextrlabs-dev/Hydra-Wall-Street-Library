#!/usr/bin/env node
/**
 * Synthetic + Alpaca adapter normalization demo (no live Alpaca credentials).
 *
 * 1. SyntheticFeed loaded from markets/btcusdt.json emits 5 normalized quotes.
 * 2. AlpacaMarketDataAdapter normalizes canned trade / quote / bar frames.
 */
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");
process.chdir(repoRoot);

const { SyntheticFeed } = await import("@hydra-ws/core");
const { loadMarketConfig } = await import("@hydra-ws/market-config");
const { AlpacaMarketDataAdapter } = await import("@hydra-ws/adapters-alpaca");

console.log(`=== data-path: ${new Date().toISOString()} ===`);
console.log(`=== node ${process.version} ===`);

console.log("\n--- Source 1: SyntheticFeed ---");
const btc = await loadMarketConfig("markets/btcusdt.json");
console.log(`loaded market ${btc.symbol} (${btc.asset_class})`);
const feed = new SyntheticFeed(btc.symbol, /*seed*/ 42, /*midTicks*/ 6_500_000, 50, btc.asset_class);
for (let i = 0; i < 5; i++) {
  const ev = feed.nextEvent();
  console.log(JSON.stringify(ev));
}

console.log("\n--- Source 2: AlpacaMarketDataAdapter (canned IEX frames) ---");
const adapter = new AlpacaMarketDataAdapter();
const frames = [
  { T: "t", S: "AAPL", p: 184.32, s: 100, t: "2026-04-28T13:30:01.123Z" },
  { T: "q", S: "AAPL", bp: 184.31, ap: 184.33, bs: 200, as: 150, t: "2026-04-28T13:30:01.456Z" },
  { T: "b", S: "AAPL", o: 184.0, h: 184.5, l: 183.9, c: 184.4, v: 12345, t: "2026-04-28T13:30:00.000Z" },
];
for (const f of frames) {
  const ev = adapter.normalize(f);
  console.log("raw  ", JSON.stringify(f));
  console.log("event", JSON.stringify(ev));
}

console.log("\n=== data-path: ok ===");
