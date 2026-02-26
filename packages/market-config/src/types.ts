export interface TradingWindow {
  /** "HH:MM" 24h */
  open: string;
  /** "HH:MM" 24h */
  close: string;
  /** IANA timezone, defaults to UTC */
  tz?: string;
}

export interface MarketHalt {
  /** ISO-8601 instant */
  start: string;
  /** ISO-8601 instant */
  end: string;
  reason?: string;
}

export interface MarketConfig {
  symbol: string;
  asset_class: string;
  /** Smallest price increment in price ticks (smallest units). */
  tick_size: number;
  /** Smallest order quantity. */
  lot_size: number;
  /** When omitted, the market is treated as 24/7. */
  trading_hours?: TradingWindow[];
  /** ["YYYY-MM-DD"] in market timezone. */
  holidays?: string[];
  halts?: MarketHalt[];
}

export type RejectReason =
  | "tick_size"
  | "lot_size"
  | "trading_hours"
  | "holiday"
  | "halt";
