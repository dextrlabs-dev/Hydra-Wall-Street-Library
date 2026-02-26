import { test } from "node:test";
import assert from "node:assert/strict";

import { parseHydraMessage } from "../dist/parser.js";

test("parses Greetings tag", () => {
  const m = parseHydraMessage(JSON.stringify({ tag: "Greetings", me: "alice", headStatus: "Idle", hydraNodeVersion: "v0" }));
  assert.equal(m.kind, "greetings");
});

test("parses heuristic Greetings (no tag, has headStatus/me/version)", () => {
  const m = parseHydraMessage(
    JSON.stringify({ me: "alice", headStatus: "Idle", hydraNodeVersion: "v0" }),
  );
  assert.equal(m.kind, "greetings");
});

test("parses TxValid timed output", () => {
  const m = parseHydraMessage(
    JSON.stringify({ tag: "TxValid", seq: 7, timestamp: "2026-04-28T00:00:00Z", transactionId: "abc" }),
  );
  assert.equal(m.kind, "txValid");
  if (m.kind === "txValid") {
    assert.equal(m.seq, 7);
    assert.equal(m.timestamp, "2026-04-28T00:00:00Z");
  }
});

test("parses TxInvalid timed output", () => {
  const m = parseHydraMessage(JSON.stringify({ tag: "TxInvalid", seq: 12, validationError: "bad" }));
  assert.equal(m.kind, "txInvalid");
});

test("parses Snapshot timed output", () => {
  const m = parseHydraMessage(JSON.stringify({ tag: "Snapshot", seq: 4 }));
  assert.equal(m.kind, "snapshot");
});

test("parses generic timed server output", () => {
  const m = parseHydraMessage(JSON.stringify({ tag: "HeadIsOpen", seq: 1 }));
  assert.equal(m.kind, "timed");
  if (m.kind === "timed") assert.equal(m.tag, "HeadIsOpen");
});

test("parses InvalidInput", () => {
  const m = parseHydraMessage(JSON.stringify({ reason: "x", input: "bad" }));
  assert.equal(m.kind, "invalidInput");
});

test("falls back to raw on non-object payload", () => {
  const m = parseHydraMessage(JSON.stringify(["a", "b"]));
  assert.equal(m.kind, "raw");
});

test("falls back to raw on non-JSON payload", () => {
  const m = parseHydraMessage("not json {");
  assert.equal(m.kind, "raw");
});
