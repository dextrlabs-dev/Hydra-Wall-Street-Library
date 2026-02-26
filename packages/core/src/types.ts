/** Side of liquidity-providing / taking interest */
export type Side = "buy" | "sell";

/** Incoming instruction types */
export type IncomingKind = "limit" | "ioc" | "cancel";

export interface LimitOrIocInput {
  kind: "limit" | "ioc";
  id: string;
  symbol: string;
  side: Side;
  /** Price in smallest units (e.g. cents for USD-denominated equities) */
  priceTicks: number;
  quantity: number;
}

export interface CancelInput {
  kind: "cancel";
  id: string;
  /** Cancel targets this resting order id */
  targetOrderId: string;
}

export type OrderInput = LimitOrIocInput | CancelInput;

export interface RestingOrder {
  id: string;
  side: Side;
  priceTicks: number;
  remainingQty: number;
  arrival: number;
}

export interface FillEvent {
  type: "fill";
  tradeId: string;
  symbol: string;
  makerOrderId: string;
  takerOrderId: string;
  priceTicks: number;
  quantity: number;
}

export interface OrderAccepted {
  type: "accepted";
  orderId: string;
  symbol: string;
  side?: Side;
  priceTicks?: number;
  quantity?: number;
}

export interface OrderRejected {
  type: "rejected";
  orderId: string;
  reason: string;
}

export interface OrderCancelled {
  type: "cancelled";
  orderId: string;
  symbol: string;
  remainingQty: number;
}

export interface BookLevel {
  priceTicks: number;
  quantity: number;
}

export interface BookSnapshot {
  type: "book";
  symbol: string;
  bids: BookLevel[];
  asks: BookLevel[];
  sequence: number;
}

export type EngineEvent =
  | FillEvent
  | OrderAccepted
  | OrderRejected
  | OrderCancelled
  | BookSnapshot;
