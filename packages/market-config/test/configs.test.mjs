import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { loadMarketConfig, applyTo } from "../dist/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");

test("loads AAPL YAML config", async () => {
  const cfg = await loadMarketConfig(join(repoRoot, "markets/aapl.yaml"));
  assert.equal(cfg.symbol, "AAPL");
  assert.equal(cfg.asset_class, "equity");
  assert.equal(cfg.tick_size, 1);
  assert.equal(cfg.lot_size, 1);
  assert.ok(cfg.trading_hours?.length);
});

test("loads BTCUSDT JSON config", async () => {
  const cfg = await loadMarketConfig(join(repoRoot, "markets/btcusdt.json"));
  assert.equal(cfg.symbol, "BTCUSDT");
  assert.equal(cfg.asset_class, "crypto");
});

test("AAPL config enforces tick + lot + hours", async () => {
  const cfg = await loadMarketConfig(join(repoRoot, "markets/aapl.yaml"));
  cfg.tick_size = 5;
  cfg.lot_size = 10;

  const engine = new (await import("@hydra-ws/core")).MatchingEngine();
  const guarded = applyTo(engine, cfg);

  // 14:00 UTC = 10:00 ET (within trading hours)
  const inHours = new Date("2026-04-28T14:00:00Z");
  // tick mismatch (price 10003 not multiple of 5)
  let r = guarded(
    { kind: "limit", id: "o-bad-tick", symbol: "AAPL", side: "buy", priceTicks: 10003, quantity: 10 },
    inHours,
  );
  assert.equal(r.rejected?.reason, "tick_size");

  // lot mismatch (qty 7 not multiple of 10)
  r = guarded(
    { kind: "limit", id: "o-bad-lot", symbol: "AAPL", side: "buy", priceTicks: 10000, quantity: 7 },
    inHours,
  );
  assert.equal(r.rejected?.reason, "lot_size");

  // valid
  r = guarded(
    { kind: "limit", id: "o-ok", symbol: "AAPL", side: "buy", priceTicks: 10000, quantity: 10 },
    inHours,
  );
  assert.equal(r.rejected, null);

  // outside trading hours
  r = guarded(
    { kind: "limit", id: "o-late", symbol: "AAPL", side: "buy", priceTicks: 10000, quantity: 10 },
    new Date("2026-04-29T05:00:00Z"),
  );
  assert.equal(r.rejected?.reason, "trading_hours");
});

test("BTCUSDT 24/7 admits orders any time", async () => {
  const cfg = await loadMarketConfig(join(repoRoot, "markets/btcusdt.json"));
  const engine = new (await import("@hydra-ws/core")).MatchingEngine();
  const guarded = applyTo(engine, cfg);
  const r = guarded(
    { kind: "limit", id: "o-1", symbol: "BTCUSDT", side: "buy", priceTicks: 6500000, quantity: 1 },
    new Date("2026-12-25T03:00:00Z"),
  );
  assert.equal(r.rejected, null);
});
