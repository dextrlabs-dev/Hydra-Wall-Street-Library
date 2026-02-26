import type { HydraInboundMessage, HydraJson, HydraTxValid } from "@hydra-ws/hydra-connector";

import type { AnchorTransport } from "./anchorer.js";

/**
 * In-memory transport that immediately echoes a TxValid for every NewTx.
 *
 * Lets the Anchorer be exercised end-to-end without a running hydra-node, e.g.
 * inside CI or `examples/anchor-once.mjs --mock`.
 */
export class MockHydraAnchorTransport implements AnchorTransport {
  private listeners: Array<(m: HydraInboundMessage) => void> = [];
  private seq = 0;

  sendNewTx(tx: HydraJson): void {
    const txId = typeof tx["txId"] === "string" ? (tx["txId"] as string) : `mock-${++this.seq}`;
    this.seq += 1;
    const valid: HydraTxValid = {
      kind: "txValid",
      seq: this.seq,
      timestamp: new Date().toISOString(),
      json: { tag: "TxValid", seq: this.seq, transactionId: txId, transaction: tx },
    };
    queueMicrotask(() => {
      for (const l of [...this.listeners]) l(valid);
    });
  }

  onMessage(listener: (m: HydraInboundMessage) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }
}
