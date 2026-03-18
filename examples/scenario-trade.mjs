#!/usr/bin/env node
/**
 * Deterministic place / partial-fill / cancel / replay smoke script.
 *
 * 1. BUY  10 @ 10000 (limit, rests on book)
 * 2. SELL  6 @ 10000 (limit, partially fills the resting buy; 4 remain)
 * 3. CANCEL the resting buy
 * 4. Replay the recorded log on a fresh engine and assert the rolling hash chain matches.
 *
 * Exits 0 on success, non-zero on any check failure.
 */
import assert from "node:assert/strict";

const { MatchingEngine, EventLog, withLog, replay } = await import("@hydra-ws/core");

const SYMBOL = "DEMO";
const engine = new MatchingEngine();
const log = new EventLog();
const submit = withLog(engine, log);

console.log("== Step 1: BUY 10 @ 10000 (limit, rests) ==");
const e1 = submit({
  kind: "limit",
  id: "o-1",
  symbol: SYMBOL,
  side: "buy",
  priceTicks: 10000,
  quantity: 10,
});
console.log(JSON.stringify(e1, null, 2));

console.log("\n== Step 2: SELL 6 @ 10000 (partial fill against o-1) ==");
const e2 = submit({
  kind: "limit",
  id: "o-2",
  symbol: SYMBOL,
  side: "sell",
  priceTicks: 10000,
  quantity: 6,
});
console.log(JSON.stringify(e2, null, 2));

const fills = e2.filter((e) => e.type === "fill");
assert.equal(fills.length, 1, "exactly one fill expected");
assert.equal(fills[0].quantity, 6, "fill should be 6 (partial)");
assert.equal(fills[0].priceTicks, 10000);

console.log("\n== Step 3: CANCEL o-1 (4 remaining) ==");
const e3 = submit({
  kind: "cancel",
  id: "c-1",
  targetOrderId: "o-1",
});
console.log(JSON.stringify(e3, null, 2));

const cancelled = e3.find((e) => e.type === "cancelled");
assert.ok(cancelled, "expected cancelled event");
assert.equal(cancelled.remainingQty, 4);

console.log("\n== Book after scenario ==");
const snap = engine.snapshot(SYMBOL);
console.log(JSON.stringify(snap, null, 2));
assert.equal(snap.bids.length, 0, "bids should be empty after cancel");
assert.equal(snap.asks.length, 0, "asks should be empty after partial fill");

console.log(`\n== Log has ${log.size} entries; head hash ${log.headHash.slice(0, 16)}\u2026 ==`);

console.log("\n== Replay log on fresh engine ==");
const result = replay(log.toArray());
console.log(`replay completed: ${result.steps} steps, finalHash ${result.finalHash.slice(0, 16)}\u2026`);

assert.equal(result.finalHash, log.headHash, "final hash must match recorded log");
console.log("\nOK: place + partial fill + cancel + deterministic replay verified.");
