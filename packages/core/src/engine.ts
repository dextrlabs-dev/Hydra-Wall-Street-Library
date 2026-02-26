import type {
  BookLevel,
  BookSnapshot,
  EngineEvent,
  FillEvent,
  LimitOrIocInput,
  OrderCancelled,
  OrderInput,
  OrderRejected,
  RestingOrder,
} from "./types.js";
import type { OrderAccepted } from "./types.js";

/** One symbol: price–time priority, limit + IOC, cancel. Deterministic for fixed inputs. */
export class MatchingEngine {
  private readonly books = new Map<string, SymbolBook>();

  getBook(symbol: string): SymbolBook {
    let b = this.books.get(symbol);
    if (!b) {
      b = new SymbolBook(symbol);
      this.books.set(symbol, b);
    }
    return b;
  }

  submit(input: OrderInput): EngineEvent[] {
    if (input.kind === "cancel") {
      const sym = this.findSymbolForOrder(input.targetOrderId);
      if (!sym) return [reject(input.id, "unknown order")];
      return this.getBook(sym).cancel(input.id, input.targetOrderId);
    }
    return this.getBook(input.symbol).handleLimitOrIoc(input);
  }

  private findSymbolForOrder(orderId: string): string | undefined {
    for (const [sym, book] of this.books) {
      if (book.hasOrder(orderId)) return sym;
    }
    return undefined;
  }

  snapshot(symbol: string): BookSnapshot | undefined {
    return this.books.get(symbol)?.snapshot();
  }
}

class SymbolBook {
  readonly symbol: string;
  private seq = 0;
  private tradeSeq = 0;
  private readonly bids = new Map<number, RestingOrder[]>();
  private readonly asks = new Map<number, RestingOrder[]>();
  private bidPrices: number[] = [];
  private askPrices: number[] = [];
  private readonly orderToPrice = new Map<string, { side: "buy" | "sell"; price: number }>();

  constructor(symbol: string) {
    this.symbol = symbol;
  }

  hasOrder(orderId: string): boolean {
    return this.orderToPrice.has(orderId);
  }

  handleLimitOrIoc(input: LimitOrIocInput): EngineEvent[] {
    const out: EngineEvent[] = [];
    if (input.quantity <= 0 || input.priceTicks <= 0) {
      return [reject(input.id, "invalid quantity or price")];
    }

    let remaining = input.quantity;

    if (input.side === "buy") {
      while (remaining > 0 && this.askPrices.length > 0) {
        const bestAsk = this.askPrices[0]!;
        if (bestAsk > input.priceTicks) break;
        const queue = this.asks.get(bestAsk);
        if (!queue?.length) {
          this.removeAskPrice(bestAsk);
          continue;
        }
        const maker = queue[0]!;
        const take = Math.min(remaining, maker.remainingQty);
        this.tradeSeq += 1;
        out.push(
          this.makeFill(input.id, maker.id, bestAsk, take),
        );
        maker.remainingQty -= take;
        remaining -= take;
        if (maker.remainingQty <= 0) {
          queue.shift();
          this.orderToPrice.delete(maker.id);
        }
        if (!queue.length) this.removeAskPrice(bestAsk);
      }
    } else {
      while (remaining > 0 && this.bidPrices.length > 0) {
        const bestBid = this.bidPrices[0]!;
        if (bestBid < input.priceTicks) break;
        const queue = this.bids.get(bestBid);
        if (!queue?.length) {
          this.removeBidPrice(bestBid);
          continue;
        }
        const maker = queue[0]!;
        const take = Math.min(remaining, maker.remainingQty);
        this.tradeSeq += 1;
        out.push(this.makeFill(input.id, maker.id, bestBid, take));
        maker.remainingQty -= take;
        remaining -= take;
        if (maker.remainingQty <= 0) {
          queue.shift();
          this.orderToPrice.delete(maker.id);
        }
        if (!queue.length) this.removeBidPrice(bestBid);
      }
    }

    const filled = input.quantity - remaining;

    if (remaining > 0 && input.kind === "limit") {
      const resting: RestingOrder = {
        id: input.id,
        side: input.side,
        priceTicks: input.priceTicks,
        remainingQty: remaining,
        arrival: ++this.seq,
      };
      if (input.side === "buy") this.addBid(resting);
      else this.addAsk(resting);
      this.orderToPrice.set(input.id, { side: input.side, price: input.priceTicks });
      out.push(
        accept(input.id, this.symbol, input.side, input.priceTicks, remaining),
      );
    } else if (remaining > 0 && input.kind === "ioc") {
      out.push(
        reject(
          input.id,
          filled > 0 ? "ioc remainder cancelled" : "ioc had no match",
        ),
      );
    } else if (filled > 0 && remaining === 0) {
      out.push(
        accept(input.id, this.symbol, input.side, input.priceTicks, filled),
      );
    }

    out.push(this.emitBook());
    return out;
  }

  private makeFill(takerId: string, makerId: string, priceTicks: number, qty: number): FillEvent {
    this.tradeSeq += 1;
    return {
      type: "fill",
      tradeId: `T-${this.seq}-${this.tradeSeq}`,
      symbol: this.symbol,
      makerOrderId: makerId,
      takerOrderId: takerId,
      priceTicks,
      quantity: qty,
    };
  }

  cancel(cancelId: string, targetOrderId: string): EngineEvent[] {
    const meta = this.orderToPrice.get(targetOrderId);
    if (!meta) {
      return [reject(cancelId, "unknown order")];
    }
    const queue =
      meta.side === "buy" ? this.bids.get(meta.price) : this.asks.get(meta.price);
    if (!queue) return [reject(cancelId, "order not in book")];
    const idx = queue.findIndex((o) => o.id === targetOrderId);
    if (idx < 0) return [reject(cancelId, "order not in book")];
    const [removed] = queue.splice(idx, 1);
    this.orderToPrice.delete(targetOrderId);
    if (!queue.length) {
      if (meta.side === "buy") this.removeBidPrice(meta.price);
      else this.removeAskPrice(meta.price);
    }
    const ev: OrderCancelled = {
      type: "cancelled",
      orderId: targetOrderId,
      symbol: this.symbol,
      remainingQty: removed?.remainingQty ?? 0,
    };
    return [ev, this.emitBook()];
  }

  private addBid(o: RestingOrder): void {
    let q = this.bids.get(o.priceTicks);
    if (!q) {
      q = [];
      this.bids.set(o.priceTicks, q);
      insertDesc(this.bidPrices, o.priceTicks);
    }
    q.push(o);
  }

  private addAsk(o: RestingOrder): void {
    let q = this.asks.get(o.priceTicks);
    if (!q) {
      q = [];
      this.asks.set(o.priceTicks, q);
      insertAsc(this.askPrices, o.priceTicks);
    }
    q.push(o);
  }

  private removeBidPrice(p: number): void {
    this.bidPrices = this.bidPrices.filter((x) => x !== p);
    this.bids.delete(p);
  }

  private removeAskPrice(p: number): void {
    this.askPrices = this.askPrices.filter((x) => x !== p);
    this.asks.delete(p);
  }

  snapshot(): BookSnapshot {
    return this.emitBook();
  }

  private emitBook(): BookSnapshot {
    const bids: BookLevel[] = [];
    for (const p of this.bidPrices) {
      const q = this.bids.get(p);
      if (!q?.length) continue;
      const qty = q.reduce((s, o) => s + o.remainingQty, 0);
      bids.push({ priceTicks: p, quantity: qty });
    }
    const asks: BookLevel[] = [];
    for (const p of this.askPrices) {
      const q = this.asks.get(p);
      if (!q?.length) continue;
      const qty = q.reduce((s, o) => s + o.remainingQty, 0);
      asks.push({ priceTicks: p, quantity: qty });
    }
    this.seq += 1;
    return { type: "book", symbol: this.symbol, bids, asks, sequence: this.seq };
  }
}

function insertDesc(arr: number[], p: number): void {
  if (arr.includes(p)) return;
  arr.push(p);
  arr.sort((a, b) => b - a);
}

function insertAsc(arr: number[], p: number): void {
  if (arr.includes(p)) return;
  arr.push(p);
  arr.sort((a, b) => a - b);
}

function accept(
  id: string,
  symbol: string,
  side: "buy" | "sell",
  priceTicks: number,
  quantity: number,
): OrderAccepted {
  return { type: "accepted", orderId: id, symbol, side, priceTicks, quantity };
}

function reject(orderId: string, reason: string): OrderRejected {
  return { type: "rejected", orderId, reason };
}
