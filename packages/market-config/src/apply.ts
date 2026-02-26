import type { EngineEvent, MatchingEngine, OrderInput } from "@hydra-ws/core";

import type { MarketConfig, RejectReason } from "./types.js";

export interface MarketGuardResult {
  events: EngineEvent[];
  rejected: { reason: RejectReason; detail?: string } | null;
}

/**
 * Returns a `submit(order, now?)` function that enforces tick / lot / hours /
 * halts / holidays of the market before delegating to the engine.
 *
 * `now` defaults to `new Date()`; pass a fixed Date in tests for determinism.
 */
export function applyTo(
  engine: MatchingEngine,
  cfg: MarketConfig,
): (order: OrderInput, now?: Date) => MarketGuardResult {
  return (order: OrderInput, now: Date = new Date()): MarketGuardResult => {
    if (order.kind !== "cancel") {
      if (order.symbol !== cfg.symbol) {
        return engineSubmit(engine, order);
      }
      if (order.priceTicks % cfg.tick_size !== 0) {
        return reject(order, "tick_size", `price ${order.priceTicks} not multiple of tick ${cfg.tick_size}`);
      }
      if (order.quantity % cfg.lot_size !== 0) {
        return reject(order, "lot_size", `qty ${order.quantity} not multiple of lot ${cfg.lot_size}`);
      }
    }

    const halt = activeHalt(cfg, now);
    if (halt) return reject(order, "halt", halt.reason ?? "halted");

    if (isHoliday(cfg, now)) {
      return reject(order, "holiday");
    }

    if (cfg.trading_hours && cfg.trading_hours.length > 0 && !insideTradingHours(cfg, now)) {
      return reject(order, "trading_hours");
    }

    return engineSubmit(engine, order);
  };
}

function engineSubmit(engine: MatchingEngine, order: OrderInput): MarketGuardResult {
  return { events: engine.submit(order), rejected: null };
}

function reject(order: OrderInput, reason: RejectReason, detail?: string): MarketGuardResult {
  return {
    events: [
      {
        type: "rejected",
        orderId: order.id,
        reason: detail ? `${reason}: ${detail}` : reason,
      },
    ],
    rejected: { reason, detail },
  };
}

function activeHalt(cfg: MarketConfig, now: Date): { reason?: string } | null {
  if (!cfg.halts) return null;
  const t = now.getTime();
  for (const h of cfg.halts) {
    const s = Date.parse(h.start);
    const e = Date.parse(h.end);
    if (Number.isFinite(s) && Number.isFinite(e) && t >= s && t < e) return h;
  }
  return null;
}

function isHoliday(cfg: MarketConfig, now: Date): boolean {
  if (!cfg.holidays || cfg.holidays.length === 0) return false;
  const tz = cfg.trading_hours?.[0]?.tz ?? "UTC";
  const ymd = ymdInTz(now, tz);
  return cfg.holidays.includes(ymd);
}

function insideTradingHours(cfg: MarketConfig, now: Date): boolean {
  for (const w of cfg.trading_hours ?? []) {
    const tz = w.tz ?? "UTC";
    const hm = hmInTz(now, tz);
    if (hm >= w.open && hm < w.close) return true;
  }
  return false;
}

function ymdInTz(now: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function hmInTz(now: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return `${get("hour")}:${get("minute")}`;
}
