import type { BookSnapshot, EngineEvent, OrderInput } from "@hydra-ws/core";

export interface MarketSummary {
  symbol: string;
  asset_class: string;
  tick_size: number;
  lot_size: number;
}

export interface MetricsPayload {
  log: { size: number; headHash: string };
  anchoring: {
    submitted: number;
    confirmed: number;
    lastSubmittedAt?: string;
    lastConfirmedAt?: string;
  } | null;
}

const baseUrl = (): string => {
  if (typeof window !== "undefined") {
    const stored = window.localStorage.getItem("engineBaseUrl");
    if (stored) return stored;
    const env = (import.meta as { env?: { VITE_ENGINE_URL?: string } }).env?.VITE_ENGINE_URL;
    if (env) return env;
    return `${window.location.protocol}//${window.location.hostname}:8080`;
  }
  return "http://localhost:8080";
};

export const setBaseUrl = (url: string): void => {
  if (typeof window !== "undefined") window.localStorage.setItem("engineBaseUrl", url);
};

const json = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const r = await fetch(`${baseUrl()}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!r.ok) throw new Error(`${r.status} ${path}: ${await r.text()}`);
  return (await r.json()) as T;
};

export const listMarkets = (): Promise<MarketSummary[]> => json<MarketSummary[]>("/markets");

export const getBook = (symbol: string): Promise<BookSnapshot> =>
  json<BookSnapshot>(`/book/${encodeURIComponent(symbol)}`);

export const submitOrder = (
  order: OrderInput,
): Promise<{ events: EngineEvent[]; rejected?: { reason: string } }> =>
  json("/orders", { method: "POST", body: JSON.stringify(order) });

export const cancelOrder = (
  cancelId: string,
  targetOrderId: string,
): Promise<{ events: EngineEvent[] }> =>
  json(`/orders/${encodeURIComponent(cancelId)}`, {
    method: "DELETE",
    body: JSON.stringify({ targetOrderId }),
  });

export const getMetrics = (): Promise<MetricsPayload> => json<MetricsPayload>("/metrics");

export const streamUrl = (symbol: string): string => {
  const u = new URL(baseUrl());
  u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
  u.pathname = `/stream/${encodeURIComponent(symbol)}`;
  return u.toString();
};
