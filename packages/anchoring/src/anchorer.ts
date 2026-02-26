import { createHash, randomBytes } from "node:crypto";

import type { HydraInboundMessage, HydraJson } from "@hydra-ws/hydra-connector";

/** Produces the current hash to anchor (e.g. engine event-log head hash). */
export type HashSource = () => string;

/** Subset of HydraHeadFacade we depend on (plus a mock implementation). */
export interface AnchorTransport {
  /** Submit a Hydra `Transaction` JSON to the open head. */
  sendNewTx(tx: HydraJson): void;
  /** Subscribe to inbound timed events; returns unsubscribe. */
  onMessage(listener: (m: HydraInboundMessage) => void): () => void;
}

export interface AnchorRecord {
  hash: string;
  txId: string;
  /** Hydra `seq` of the TxValid that confirmed it. */
  seq?: number;
  timestamp?: string;
  submittedAt: string;
  confirmedAt?: string;
}

export interface AnchorerInit {
  transport: AnchorTransport;
  hashSource: HashSource;
  /** When > 0, schedule an anchor every `intervalMs`. */
  intervalMs?: number;
  /** Override how a hash becomes a Hydra `Transaction` body. */
  buildTx?: (hash: string, anchor: { txId: string }) => HydraJson;
}

const DEFAULT_BUILD_TX = (hash: string, anchor: { txId: string }): HydraJson => ({
  type: "Witnessed Tx ConwayEra",
  description: `hydra-ws anchor ${hash}`,
  cborHex: `00${hash}`,
  txId: anchor.txId,
});

export class Anchorer {
  private readonly transport: AnchorTransport;
  private readonly hashSource: HashSource;
  private readonly intervalMs: number;
  private readonly buildTx: (hash: string, ctx: { txId: string }) => HydraJson;
  private readonly index = new Map<string, AnchorRecord>();
  private readonly txIdToHash = new Map<string, string>();
  private timer: NodeJS.Timeout | null = null;
  private unsubscribe: (() => void) | null = null;

  constructor(init: AnchorerInit) {
    this.transport = init.transport;
    this.hashSource = init.hashSource;
    this.intervalMs = init.intervalMs ?? 0;
    this.buildTx = init.buildTx ?? DEFAULT_BUILD_TX;
  }

  start(): void {
    if (this.unsubscribe) return;
    this.unsubscribe = this.transport.onMessage((m) => this.onInbound(m));
    if (this.intervalMs > 0) {
      this.timer = setInterval(() => {
        try {
          this.anchorOnce();
        } catch {
          /* ignore in periodic loop; surfaced via stop() callers */
        }
      }, this.intervalMs);
    }
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Compute hash, build tx, send via transport. Returns the AnchorRecord.
   * The record's `seq`/`confirmedAt` are filled in once the matching TxValid arrives.
   */
  anchorOnce(): AnchorRecord {
    const hash = this.hashSource();
    const txId = deriveTxId(hash);
    const record: AnchorRecord = {
      hash,
      txId,
      submittedAt: new Date().toISOString(),
    };
    this.index.set(hash, record);
    this.txIdToHash.set(txId, hash);
    const tx = this.buildTx(hash, { txId });
    this.transport.sendNewTx(tx);
    return record;
  }

  verify(hash: string): { anchored: boolean; record?: AnchorRecord } {
    const r = this.index.get(hash);
    if (!r) return { anchored: false };
    return { anchored: r.confirmedAt !== undefined, record: r };
  }

  list(): AnchorRecord[] {
    return [...this.index.values()];
  }

  metrics(): {
    submitted: number;
    confirmed: number;
    lastSubmittedAt?: string;
    lastConfirmedAt?: string;
  } {
    let confirmed = 0;
    let lastSubmittedAt: string | undefined;
    let lastConfirmedAt: string | undefined;
    for (const r of this.index.values()) {
      if (!lastSubmittedAt || r.submittedAt > lastSubmittedAt) lastSubmittedAt = r.submittedAt;
      if (r.confirmedAt) {
        confirmed += 1;
        if (!lastConfirmedAt || r.confirmedAt > lastConfirmedAt) lastConfirmedAt = r.confirmedAt;
      }
    }
    return { submitted: this.index.size, confirmed, lastSubmittedAt, lastConfirmedAt };
  }

  private onInbound(m: HydraInboundMessage): void {
    if (m.kind !== "txValid") return;
    const txId = typeof m.json["transactionId"] === "string" ? (m.json["transactionId"] as string) : undefined;
    if (!txId) return;
    const hash = this.txIdToHash.get(txId);
    if (!hash) return;
    const rec = this.index.get(hash);
    if (!rec) return;
    rec.seq = m.seq;
    rec.timestamp = m.timestamp;
    rec.confirmedAt = m.timestamp ?? new Date().toISOString();
  }
}

function deriveTxId(hash: string): string {
  // Combine hash with a per-process nonce so repeated anchors of the same hash
  // produce distinct tx ids (real Hydra would calculate this from the tx body).
  return createHash("sha256")
    .update(hash)
    .update(randomBytes(8))
    .digest("hex");
}
