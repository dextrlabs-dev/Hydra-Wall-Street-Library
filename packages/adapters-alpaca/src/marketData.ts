import WebSocket from "ws";

import type { MarketDataAdapter, MarketEvent } from "@hydra-ws/core";

export interface MarketDataCredentials {
  keyId: string;
  secretKey: string;
}

/** Raw Alpaca IEX frame (single message; the WS sends arrays of these). */
export interface AlpacaRawFrame {
  T?: string;
  S?: string;
  /** trade price */
  p?: number;
  /** trade/size */
  s?: number;
  /** bid price */
  bp?: number;
  /** ask price */
  ap?: number;
  /** bid size */
  bs?: number;
  /** ask size */
  as?: number;
  /** bar open/high/low/close */
  o?: number;
  h?: number;
  l?: number;
  c?: number;
  v?: number;
  /** timestamp (ISO-8601 string when present) */
  t?: string;
  /** sequence */
  i?: number | string;
  [k: string]: unknown;
}

export interface StreamHandlers {
  /** Raw frame as parsed JSON (object or array) */
  onMessage?: (raw: unknown) => void;
  /** Normalized MarketEvent (one per IEX trade/quote/bar). */
  onEvent?: (event: MarketEvent) => void;
  onError?: (err: Error) => void;
  onClose?: () => void;
}

const DEFAULT_DATA_WS = "wss://stream.data.alpaca.markets/v2/iex";

/**
 * Maps Alpaca IEX frames to normalized MarketEvent.
 * IEX `T`: 't' = trade, 'q' = quote, 'b' = bar (per Alpaca docs).
 */
export class AlpacaMarketDataAdapter implements MarketDataAdapter<AlpacaRawFrame> {
  readonly source = "alpaca";
  private seq = 0;

  normalize(raw: AlpacaRawFrame): MarketEvent | null {
    if (!raw || typeof raw !== "object" || typeof raw.T !== "string" || typeof raw.S !== "string") {
      return null;
    }
    const symbol = raw.S;
    const ts = typeof raw.t === "string" ? raw.t : new Date().toISOString();

    switch (raw.T) {
      case "t": {
        if (typeof raw.p !== "number" || typeof raw.s !== "number") return null;
        this.seq += 1;
        return {
          source: this.source,
          symbol,
          kind: "trade",
          priceTicks: Math.round(raw.p * 100),
          quantity: raw.s,
          timestamp: ts,
          sequence: this.seq,
          assetClass: "equity",
        };
      }
      case "q": {
        const mid =
          typeof raw.bp === "number" && typeof raw.ap === "number"
            ? (raw.bp + raw.ap) / 2
            : (raw.bp ?? raw.ap);
        if (typeof mid !== "number") return null;
        const qty = (raw.bs ?? 0) + (raw.as ?? 0);
        this.seq += 1;
        return {
          source: this.source,
          symbol,
          kind: "quote",
          priceTicks: Math.round(mid * 100),
          quantity: qty,
          timestamp: ts,
          sequence: this.seq,
          assetClass: "equity",
        };
      }
      case "b": {
        if (typeof raw.c !== "number" || typeof raw.v !== "number") return null;
        this.seq += 1;
        return {
          source: this.source,
          symbol,
          kind: "bar",
          priceTicks: Math.round(raw.c * 100),
          quantity: raw.v,
          timestamp: ts,
          sequence: this.seq,
          assetClass: "equity",
        };
      }
      default:
        return null;
    }
  }
}

/**
 * Alpaca Market Data WebSocket (subscribe to bars/trades/quotes per Alpaca docs).
 * https://docs.alpaca.markets/docs/streaming-market-data
 */
export class AlpacaMarketDataStream {
  private ws: WebSocket | null = null;
  private readonly adapter = new AlpacaMarketDataAdapter();

  constructor(
    private readonly creds: MarketDataCredentials,
    private readonly wsUrl = process.env.ALPACA_DATA_WS_URL ?? DEFAULT_DATA_WS,
  ) {}

  connect(handlers: StreamHandlers = {}): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl);
      this.ws.on("open", () => resolve());
      this.ws.on("error", (e) => {
        handlers.onError?.(e instanceof Error ? e : new Error(String(e)));
        reject(e);
      });
      this.ws.on("message", (data) => {
        const text = typeof data === "string" ? data : Buffer.isBuffer(data) ? data.toString("utf8") : String(data);
        let parsed: unknown;
        try {
          parsed = JSON.parse(text);
        } catch {
          handlers.onMessage?.(text);
          return;
        }
        handlers.onMessage?.(parsed);
        const onEvent = handlers.onEvent;
        if (!onEvent) return;
        const frames = Array.isArray(parsed) ? (parsed as AlpacaRawFrame[]) : [parsed as AlpacaRawFrame];
        for (const frame of frames) {
          const ev = this.adapter.normalize(frame);
          if (ev) onEvent(ev);
        }
      });
      this.ws.on("close", () => handlers.onClose?.());
    });
  }

  /** Authenticate then subscribe (IEX example shape; adjust per your Alpaca plan) */
  authenticateAndSubscribe(symbols: string[]): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(
      JSON.stringify({
        action: "auth",
        key: this.creds.keyId,
        secret: this.creds.secretKey,
      }),
    );
    this.ws.send(
      JSON.stringify({
        action: "subscribe",
        trades: symbols,
        quotes: symbols,
        bars: symbols,
      }),
    );
  }

  close(): void {
    this.ws?.close();
    this.ws = null;
  }
}
