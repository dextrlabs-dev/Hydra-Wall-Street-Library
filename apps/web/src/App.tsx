import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BookSnapshot, EngineEvent, FillEvent } from "@hydra-ws/core";

import {
  cancelOrder,
  getBook,
  getMetrics,
  listMarkets,
  setBaseUrl,
  streamUrl,
  submitOrder,
  type MarketSummary,
  type MetricsPayload,
} from "./api.js";

interface TapeEntry {
  ts: number;
  text: string;
}

interface PnL {
  position: number;
  cashTicks: number;
  realizedTicks: number;
}

const FALLBACK_SYMBOL = "DEMO";

const initialBaseUrl = (): string => {
  if (typeof window === "undefined") return "http://localhost:8080";
  return (
    window.localStorage.getItem("engineBaseUrl") ??
    `${window.location.protocol}//${window.location.hostname}:8080`
  );
};

export function App() {
  const [serverUrl, setServerUrl] = useState<string>(initialBaseUrl());
  const [markets, setMarkets] = useState<MarketSummary[]>([]);
  const [symbol, setSymbol] = useState<string>(FALLBACK_SYMBOL);
  const [book, setBook] = useState<BookSnapshot | null>(null);
  const [tape, setTape] = useState<TapeEntry[]>([]);
  const [pnl, setPnl] = useState<PnL>({ position: 0, cashTicks: 0, realizedTicks: 0 });
  const [metrics, setMetrics] = useState<MetricsPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refreshMarkets = useCallback(async () => {
    try {
      const m = await listMarkets();
      setMarkets(m);
      if (m.length && !m.find((x) => x.symbol === symbol)) {
        setSymbol(m[0]!.symbol);
      }
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [symbol]);

  useEffect(() => {
    void refreshMarkets();
  }, [refreshMarkets, serverUrl]);

  useEffect(() => {
    const t = setInterval(async () => {
      try {
        setMetrics(await getMetrics());
      } catch {
        /* ignore */
      }
    }, 2000);
    return () => clearInterval(t);
  }, [serverUrl]);

  useEffect(() => {
    let aborted = false;
    let ws: WebSocket | null = null;
    (async () => {
      try {
        const snap = await getBook(symbol);
        if (!aborted) setBook(snap);
      } catch {
        /* book may not exist yet */
      }
      ws = new WebSocket(streamUrl(symbol));
      ws.onmessage = (m) => {
        try {
          const data = JSON.parse(typeof m.data === "string" ? m.data : "") as
            | { type: "book"; book: BookSnapshot }
            | { type: "events"; events: EngineEvent[] };
          if (data.type === "book") setBook(data.book);
          else if (data.type === "events") {
            for (const ev of data.events) handleEvent(ev);
          }
        } catch {
          /* ignore */
        }
      };
    })();
    return () => {
      aborted = true;
      ws?.close();
    };
  }, [symbol, serverUrl]);

  const handleEvent = useCallback(
    (ev: EngineEvent) => {
      if (ev.type === "fill") {
        applyFillToPnl(ev);
        setTape((prev) =>
          [
            { ts: Date.now(), text: `fill ${ev.quantity} @ ${ev.priceTicks} (${ev.tradeId})` },
            ...prev,
          ].slice(0, 50),
        );
      } else if (ev.type === "rejected") {
        setTape((prev) =>
          [{ ts: Date.now(), text: `rejected ${ev.orderId}: ${ev.reason}` }, ...prev].slice(0, 50),
        );
      } else if (ev.type === "cancelled") {
        setTape((prev) =>
          [{ ts: Date.now(), text: `cancelled ${ev.orderId} (rem ${ev.remainingQty})` }, ...prev].slice(0, 50),
        );
      }
    },
    [],
  );

  const applyFillToPnl = (fill: FillEvent) => {
    setPnl((prev) => {
      const isBuyTaker = fill.takerOrderId.startsWith("buy:");
      const sign = isBuyTaker ? 1 : -1;
      const newPos = prev.position + sign * fill.quantity;
      const newCash = prev.cashTicks - sign * fill.quantity * fill.priceTicks;
      return { ...prev, position: newPos, cashTicks: newCash };
    });
  };

  return (
    <div className="root">
      <header className="hdr">
        <div>
          <h1>Hydra Wall Street Library</h1>
          <p className="sub">React UI · live engine WebSocket · deterministic core</p>
        </div>
        <ServerSettings url={serverUrl} onChange={(u) => { setBaseUrl(u); setServerUrl(u); }} />
      </header>

      {error && <div className="banner">Error: {error}</div>}

      <section className="grid">
        <div className="panel">
          <h2>Markets</h2>
          <select value={symbol} onChange={(e) => setSymbol(e.target.value)}>
            {markets.length === 0 ? <option value={FALLBACK_SYMBOL}>{FALLBACK_SYMBOL}</option> : null}
            {markets.map((m) => (
              <option key={m.symbol} value={m.symbol}>
                {m.symbol} ({m.asset_class})
              </option>
            ))}
          </select>
          <OrderForm
            symbol={symbol}
            onSubmit={async (input) => {
              try {
                const r = await submitOrder(input);
                for (const ev of r.events ?? []) handleEvent(ev);
                if (r.rejected) setError(`rejected: ${r.rejected.reason}`);
                else setError(null);
              } catch (err) {
                setError((err as Error).message);
              }
            }}
            onCancel={async (cancelId, target) => {
              try {
                const r = await cancelOrder(cancelId, target);
                for (const ev of r.events ?? []) handleEvent(ev);
              } catch (err) {
                setError((err as Error).message);
              }
            }}
          />
        </div>

        <div className="panel">
          <h2>Level 2 book ({symbol})</h2>
          <BookView book={book} />
        </div>

        <div className="panel">
          <h2>Trade tape</h2>
          <ol className="tape">
            {tape.map((t) => (
              <li key={t.ts + t.text}>
                <time>{new Date(t.ts).toISOString().slice(11, 19)}</time> {t.text}
              </li>
            ))}
          </ol>
        </div>

        <div className="panel">
          <h2>P&L</h2>
          <PnlView pnl={pnl} book={book} />
        </div>

        <div className="panel">
          <h2>Engine metrics</h2>
          <pre>{metrics ? JSON.stringify(metrics, null, 2) : "(loading)"}</pre>
        </div>
      </section>
    </div>
  );
}

function ServerSettings({ url, onChange }: { url: string; onChange: (u: string) => void }) {
  const [draft, setDraft] = useState(url);
  return (
    <div className="server-settings">
      <label>
        Engine URL
        <input value={draft} onChange={(e) => setDraft(e.target.value)} />
      </label>
      <button type="button" onClick={() => onChange(draft)}>
        Apply
      </button>
    </div>
  );
}

function OrderForm(props: {
  symbol: string;
  onSubmit: (input: import("@hydra-ws/core").OrderInput) => void;
  onCancel: (cancelId: string, target: string) => void;
}) {
  const idRef = useRef(0);
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [kind, setKind] = useState<"limit" | "ioc">("limit");
  const [price, setPrice] = useState(10000);
  const [qty, setQty] = useState(1);
  const [target, setTarget] = useState("");

  const nextId = () => `${side}:${++idRef.current}-${Date.now()}`;

  return (
    <form
      className="order-form"
      onSubmit={(e) => {
        e.preventDefault();
        const id = nextId();
        props.onSubmit({
          kind,
          id,
          symbol: props.symbol,
          side,
          priceTicks: Number(price),
          quantity: Number(qty),
        });
      }}
    >
      <label>
        Side
        <select value={side} onChange={(e) => setSide(e.target.value as "buy" | "sell")}>
          <option value="buy">buy</option>
          <option value="sell">sell</option>
        </select>
      </label>
      <label>
        Kind
        <select value={kind} onChange={(e) => setKind(e.target.value as "limit" | "ioc")}>
          <option value="limit">limit</option>
          <option value="ioc">ioc</option>
        </select>
      </label>
      <label>
        Price (ticks)
        <input type="number" value={price} onChange={(e) => setPrice(Number(e.target.value))} />
      </label>
      <label>
        Qty
        <input type="number" value={qty} onChange={(e) => setQty(Number(e.target.value))} />
      </label>
      <button type="submit">Submit</button>
      <fieldset className="cancel">
        <legend>Cancel</legend>
        <input
          placeholder="target order id"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
        />
        <button
          type="button"
          onClick={() => target && props.onCancel(`c-${Date.now()}`, target)}
          disabled={!target}
        >
          Cancel
        </button>
      </fieldset>
    </form>
  );
}

function BookView({ book }: { book: BookSnapshot | null }) {
  if (!book) return <p className="muted">(no book yet)</p>;
  const top = (rows: { priceTicks: number; quantity: number }[]) => rows.slice(0, 10);
  return (
    <div className="book">
      <div>
        <h3>Bids</h3>
        <table>
          <thead>
            <tr>
              <th>price</th>
              <th>qty</th>
            </tr>
          </thead>
          <tbody>
            {top(book.bids).map((r) => (
              <tr key={`b-${r.priceTicks}`}>
                <td>{r.priceTicks}</td>
                <td>{r.quantity}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div>
        <h3>Asks</h3>
        <table>
          <thead>
            <tr>
              <th>price</th>
              <th>qty</th>
            </tr>
          </thead>
          <tbody>
            {top(book.asks).map((r) => (
              <tr key={`a-${r.priceTicks}`}>
                <td>{r.priceTicks}</td>
                <td>{r.quantity}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PnlView({ pnl, book }: { pnl: PnL; book: BookSnapshot | null }) {
  const mark = useMemo(() => {
    if (!book) return undefined;
    const bestBid = book.bids[0]?.priceTicks;
    const bestAsk = book.asks[0]?.priceTicks;
    if (bestBid && bestAsk) return Math.round((bestBid + bestAsk) / 2);
    return bestBid ?? bestAsk;
  }, [book]);
  const unrealized = mark !== undefined ? pnl.position * mark + pnl.cashTicks : null;
  return (
    <dl className="pnl">
      <div>
        <dt>position</dt>
        <dd>{pnl.position}</dd>
      </div>
      <div>
        <dt>cash (ticks)</dt>
        <dd>{pnl.cashTicks}</dd>
      </div>
      <div>
        <dt>mark</dt>
        <dd>{mark ?? "-"}</dd>
      </div>
      <div>
        <dt>unrealized</dt>
        <dd>{unrealized ?? "-"}</dd>
      </div>
    </dl>
  );
}
