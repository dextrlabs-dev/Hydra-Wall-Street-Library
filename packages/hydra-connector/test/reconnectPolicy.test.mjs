import { test } from "node:test";
import assert from "node:assert/strict";

import { HydraReconnectPolicy } from "../dist/reconnectPolicy.js";

test("default backoff doubles to cap at maxDelayMs", () => {
  const p = new HydraReconnectPolicy({ initialDelayMs: 200, maxDelayMs: 3000, backoffMultiplier: 2 });
  assert.equal(p.delayForAttempt(0), 200);
  assert.equal(p.delayForAttempt(1), 400);
  assert.equal(p.delayForAttempt(2), 800);
  assert.equal(p.delayForAttempt(3), 1600);
  assert.equal(p.delayForAttempt(4), 3000);
  assert.equal(p.delayForAttempt(10), 3000);
});

test("multiplier 1 keeps delay constant", () => {
  const p = new HydraReconnectPolicy({ initialDelayMs: 250, backoffMultiplier: 1, maxDelayMs: 3000 });
  for (let i = 0; i < 5; i++) assert.equal(p.delayForAttempt(i), 250);
});

test("rejects multiplier < 1", () => {
  assert.throws(() => new HydraReconnectPolicy({ backoffMultiplier: 0 }));
});
