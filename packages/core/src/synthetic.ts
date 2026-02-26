import type { MarketDataAdapter, MarketEvent } from "./marketEvent.js";

/** Deterministic pseudo-random (mulberry32) for seeded feeds */
function mulberry32(seed: number): () => number {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface SyntheticTick {
  symbol: string;
  /** Mid price in ticks (e.g. cents) */
  midTicks: number;
  sequence: number;
}

/** Seeded, replayable mid-price series for demos and CI */
export class SyntheticFeed implements MarketDataAdapter<SyntheticTick> {
  readonly source = "synthetic";
  private seq = 0;
  private readonly rnd: () => number;
  /** Wall clock baseline; deterministic sequencing ignores wall clock. */
  private readonly baseTimestamp: number;

  constructor(
    readonly symbol: string,
    seed: number,
    private midTicks: number,
    private volatilityTicks = 5,
    readonly assetClass: string = "equity",
    baseTimestampMs: number = Date.UTC(2026, 0, 1),
  ) {
    this.rnd = mulberry32(seed >>> 0);
    this.baseTimestamp = baseTimestampMs;
  }

  next(): SyntheticTick {
    this.seq += 1;
    const delta = Math.floor((this.rnd() * 2 - 1) * this.volatilityTicks);
    this.midTicks = Math.max(1, this.midTicks + delta);
    return { symbol: this.symbol, midTicks: this.midTicks, sequence: this.seq };
  }

  /** Convenience: emit a normalized MarketEvent (kind "quote") per tick. */
  nextEvent(): MarketEvent {
    const tick = this.next();
    return this.normalize(tick)!;
  }

  /** MarketDataAdapter implementation: SyntheticTick -> MarketEvent. */
  normalize(raw: SyntheticTick): MarketEvent {
    const ts = new Date(this.baseTimestamp + raw.sequence * 1000).toISOString();
    return {
      source: this.source,
      symbol: raw.symbol,
      kind: "quote",
      priceTicks: raw.midTicks,
      quantity: 1,
      timestamp: ts,
      sequence: raw.sequence,
      assetClass: this.assetClass,
    };
  }
}
