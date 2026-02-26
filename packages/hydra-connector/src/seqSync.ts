import type { HydraHttpClient } from "./hydraHttp.js";
import { getMessageSeq, type HydraInboundMessage } from "./messages.js";
import { InMemoryHydraStateStore, type HydraStateStore } from "./stateStore.js";

/** How strict SeqTracker should be about `seq` monotonicity. */
export type HydraSyncPolicy = "none" | "dedupeOnly" | "dedupeAndRefreshOnGap";

export interface SeqTrackerInit {
  policy: HydraSyncPolicy;
  store?: HydraStateStore;
  http?: HydraHttpClient;
  onSeqGap?: (lastSeq: number, receivedSeq: number) => void;
}

/**
 * Tracks `seq` on timed inbound messages; supports dedup after WS history
 * replay and optional snapshot refresh hint when a gap is detected.
 */
export class SeqTracker {
  readonly policy: HydraSyncPolicy;
  private readonly store: HydraStateStore;
  private readonly http?: HydraHttpClient;
  private readonly onSeqGap?: (lastSeq: number, receivedSeq: number) => void;

  private last: number | undefined;

  constructor(init: SeqTrackerInit) {
    this.policy = init.policy;
    this.store = init.store ?? new InMemoryHydraStateStore();
    this.http = init.http;
    this.onSeqGap = init.onSeqGap;
  }

  async restore(): Promise<void> {
    this.last = await this.store.loadLastSeq();
  }

  get lastSeq(): number | undefined {
    return this.last;
  }

  reset(): void {
    this.last = undefined;
  }

  /** Returns the message to forward, or `null` to drop it. */
  async process(message: HydraInboundMessage): Promise<HydraInboundMessage | null> {
    const seq = getMessageSeq(message);
    if (seq === undefined) return message;

    switch (this.policy) {
      case "none":
        this.last = seq;
        await this.store.saveLastSeq(seq);
        return message;
      case "dedupeOnly":
      case "dedupeAndRefreshOnGap": {
        if (this.last !== undefined && seq <= this.last) return null;
        if (
          this.policy === "dedupeAndRefreshOnGap" &&
          this.last !== undefined &&
          seq > this.last + 1
        ) {
          this.onSeqGap?.(this.last, seq);
          this.refreshSnapshotHint();
        }
        this.last = seq;
        await this.store.saveLastSeq(seq);
        return message;
      }
    }
  }

  private refreshSnapshotHint(): void {
    const h = this.http;
    if (!h) return;
    void this.persistLastSeenBody(h);
  }

  private async persistLastSeenBody(h: HydraHttpClient): Promise<void> {
    try {
      const r = await h.getSnapshotLastSeen();
      const text = await r.text();
      await this.store.saveSnapshotHint(text);
    } catch {
      // best-effort only
    }
  }
}
