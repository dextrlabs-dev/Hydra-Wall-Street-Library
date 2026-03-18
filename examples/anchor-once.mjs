#!/usr/bin/env node
/**
 * In-process Anchorer against mock Hydra transport (or real hydra-node with
 * HYDRA_HOST and --hydra); poll until confirmed and assert verification.
 *
 * Exits 0 on success, non-zero on any check failure.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import { loadDotEnv } from "./_loadEnv.mjs";
loadDotEnv(import.meta.url);

const useReal = process.argv.includes("--hydra");

const { Anchorer, MockHydraAnchorTransport } = await import("@hydra-ws/anchoring");

let transport;
let dispose = async () => {};

if (useReal) {
  const { HydraClientConfig, HydraHeadFacade } = await import("@hydra-ws/hydra-connector");
  const host = process.env.HYDRA_HOST;
  if (!host) {
    console.error("--hydra requires HYDRA_HOST in env");
    process.exit(2);
  }
  const facade = new HydraHeadFacade({
    config: new HydraClientConfig({
      host,
      port: process.env.HYDRA_PORT ? Number(process.env.HYDRA_PORT) : 4001,
      secure: process.env.HYDRA_SECURE === "true",
    }),
  });
  await facade.connect();
  transport = {
    sendNewTx: (tx) => facade.sendNewTx(tx),
    onMessage: (l) => facade.onMessage(l),
  };
  dispose = () => facade.dispose();
} else {
  transport = new MockHydraAnchorTransport();
}

const stateHash = createHash("sha256").update("anchor-demo-state").digest("hex");
const anchorer = new Anchorer({
  transport,
  hashSource: () => stateHash,
});
anchorer.start();

console.log(`anchoring hash ${stateHash.slice(0, 16)}\u2026`);
const record = anchorer.anchorOnce();
console.log(`submitted txId ${record.txId.slice(0, 16)}\u2026 at ${record.submittedAt}`);

const deadline = Date.now() + (useReal ? 10_000 : 1_000);
while (Date.now() < deadline) {
  const v = anchorer.verify(stateHash);
  if (v.anchored) {
    console.log(`confirmed at seq ${v.record?.seq} (${v.record?.confirmedAt})`);
    break;
  }
  await new Promise((r) => setTimeout(r, 50));
}

const finalCheck = anchorer.verify(stateHash);
assert.equal(finalCheck.anchored, true, "anchor must be confirmed");
assert.equal(finalCheck.record?.hash, stateHash);

console.log("\nmetrics:", anchorer.metrics());
anchorer.stop();
await dispose();

console.log("\nOK: state hash anchored and verified.");
