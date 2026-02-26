/** Common normalized market data event for any feed (synthetic, Alpaca, ...). */
export interface MarketEvent {
  /** Adapter name, e.g. "synthetic", "alpaca". */
  source: string;
  symbol: string;
  kind: "trade" | "quote" | "bar";
  /** Price in smallest units (e.g. cents) */
  priceTicks: number;
  /** Trade size or quote/bar volume */
  quantity: number;
  /** ISO-8601 timestamp string */
  timestamp: string;
  /** Monotonic per-source sequence */
  sequence: number;
  /** Optional asset-class label ("equity", "crypto", "fx") */
  assetClass?: string;
}

/** Implementations turn raw frames into normalized MarketEvent stream. */
export interface MarketDataAdapter<TRaw> {
  readonly source: string;
  /** Returns null if the raw frame is not a market event we want to surface. */
  normalize(raw: TRaw): MarketEvent | null;
}

export interface AssetClassDef {
  name: string;
  /** Tick size in price ticks (smallest price increment). */
  tickSize: number;
  /** Lot size (smallest quantity increment). */
  lotSize: number;
}

const registry = new Map<string, AssetClassDef>();

export function registerAssetClass(def: AssetClassDef): void {
  registry.set(def.name, def);
}

export function getAssetClass(name: string): AssetClassDef | undefined {
  return registry.get(name);
}

/** Reset all registrations (test helper). */
export function clearAssetClassRegistry(): void {
  registry.clear();
}

registerAssetClass({ name: "equity", tickSize: 1, lotSize: 1 });
registerAssetClass({ name: "crypto", tickSize: 1, lotSize: 1 });
registerAssetClass({ name: "fx", tickSize: 1, lotSize: 1 });
