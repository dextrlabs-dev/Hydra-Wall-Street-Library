#!/usr/bin/env node
/**
 * Market configuration loader demo: YAML + JSON load and applyTo(engine, cfg).
 *
 * Loads markets/aapl.yaml and markets/btcusdt.json, wraps a MatchingEngine with
 * tick/lot overrides for AAPL, and submits orders that hit tick, lot, hours,
 * holiday, and one valid case.
 */
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");
process.chdir(repoRoot);

const { MatchingEngine } = await import("@hydra-ws/core");
const { loadMarketConfig, applyTo } = await import("@hydra-ws/market-config");

console.log(`=== market-config: ${new Date().toISOString()} ===`);
console.log(`=== node ${process.version} ===`);

const aapl = await loadMarketConfig("markets/aapl.yaml");
const btc = await loadMarketConfig("markets/btcusdt.json");

console.log("\n--- AAPL config ---");
console.log(JSON.stringify(aapl, null, 2));
console.log("\n--- BTCUSDT config ---");
console.log(JSON.stringify(btc, null, 2));

console.log("\n--- Apply AAPL config to engine ---");
// override tick/lot to make rejection visible (the file uses tick=1, lot=1 by design)
const tightCfg = { ...aapl, tick_size: 5, lot_size: 10 };
const engine = new MatchingEngine();
const guarded = applyTo(engine, tightCfg);

const inHoursEt = new Date("2026-04-28T14:00:00Z"); // 10:00 America/New_York
const outOfHours = new Date("2026-04-29T05:00:00Z"); // 01:00 ET, closed
const holidayEt = new Date("2026-07-03T14:00:00Z"); // listed in markets/aapl.yaml

const cases = [
  {
    label: "tick_size violation (price 10003, tick 5)",
    when: inHoursEt,
    order: { kind: "limit", id: "o-bad-tick", symbol: "AAPL", side: "buy", priceTicks: 10003, quantity: 10 },
  },
  {
    label: "lot_size violation (qty 7, lot 10)",
    when: inHoursEt,
    order: { kind: "limit", id: "o-bad-lot", symbol: "AAPL", side: "buy", priceTicks: 10000, quantity: 7 },
  },
  {
    label: "outside trading hours (01:00 ET)",
    when: outOfHours,
    order: { kind: "limit", id: "o-late", symbol: "AAPL", side: "buy", priceTicks: 10000, quantity: 10 },
  },
  {
    label: "holiday (2026-07-03 listed)",
    when: holidayEt,
    order: { kind: "limit", id: "o-holiday", symbol: "AAPL", side: "buy", priceTicks: 10000, quantity: 10 },
  },
  {
    label: "valid order in trading hours",
    when: inHoursEt,
    order: { kind: "limit", id: "o-ok", symbol: "AAPL", side: "buy", priceTicks: 10000, quantity: 10 },
  },
];

for (const c of cases) {
  const r = guarded(c.order, c.when);
  console.log(`\ncase: ${c.label}`);
  console.log("rejected:", JSON.stringify(r.rejected));
  console.log("events  :", JSON.stringify(r.events));
}

console.log("\n=== market-config: ok ===");
