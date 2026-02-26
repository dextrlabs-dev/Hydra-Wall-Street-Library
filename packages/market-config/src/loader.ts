import { promises as fs } from "node:fs";
import { extname } from "node:path";

import { parse as parseYaml } from "yaml";

import type { MarketConfig } from "./types.js";

export async function loadMarketConfig(filePath: string): Promise<MarketConfig> {
  const raw = await fs.readFile(filePath, "utf8");
  const ext = extname(filePath).toLowerCase();
  const data = ext === ".json" ? JSON.parse(raw) : parseYaml(raw);
  return validate(data);
}

export function parseMarketConfig(text: string, format: "json" | "yaml"): MarketConfig {
  const data = format === "json" ? JSON.parse(text) : parseYaml(text);
  return validate(data);
}

function validate(input: unknown): MarketConfig {
  if (!input || typeof input !== "object") {
    throw new Error("market config must be an object");
  }
  const v = input as Record<string, unknown>;
  const symbol = req(v, "symbol", "string");
  const assetClass = req(v, "asset_class", "string");
  const tickSize = req(v, "tick_size", "number");
  const lotSize = req(v, "lot_size", "number");
  if (tickSize <= 0) throw new Error("tick_size must be > 0");
  if (lotSize <= 0) throw new Error("lot_size must be > 0");

  const cfg: MarketConfig = {
    symbol,
    asset_class: assetClass,
    tick_size: tickSize,
    lot_size: lotSize,
  };
  if (v.trading_hours !== undefined) {
    if (!Array.isArray(v.trading_hours)) throw new Error("trading_hours must be an array");
    cfg.trading_hours = v.trading_hours.map((w, i) => normalizeWindow(w, i));
  }
  if (v.holidays !== undefined) {
    if (!Array.isArray(v.holidays)) throw new Error("holidays must be an array");
    cfg.holidays = v.holidays.map((d) => {
      if (typeof d !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(d)) {
        throw new Error(`invalid holiday date: ${String(d)}`);
      }
      return d;
    });
  }
  if (v.halts !== undefined) {
    if (!Array.isArray(v.halts)) throw new Error("halts must be an array");
    cfg.halts = v.halts.map((h, i) => {
      if (!h || typeof h !== "object") throw new Error(`halts[${i}] must be an object`);
      const o = h as Record<string, unknown>;
      const start = req(o, "start", "string");
      const end = req(o, "end", "string");
      const reason = typeof o.reason === "string" ? (o.reason as string) : undefined;
      return { start, end, reason };
    });
  }
  return cfg;
}

function normalizeWindow(w: unknown, i: number) {
  if (!w || typeof w !== "object") throw new Error(`trading_hours[${i}] must be an object`);
  const o = w as Record<string, unknown>;
  const open = req(o, "open", "string");
  const close = req(o, "close", "string");
  if (!/^\d{2}:\d{2}$/.test(open)) throw new Error(`trading_hours[${i}].open must be HH:MM`);
  if (!/^\d{2}:\d{2}$/.test(close)) throw new Error(`trading_hours[${i}].close must be HH:MM`);
  const tz = typeof o.tz === "string" ? (o.tz as string) : "UTC";
  return { open, close, tz };
}

function req<T extends "string" | "number">(
  o: Record<string, unknown>,
  key: string,
  type: T,
): T extends "string" ? string : number {
  const v = o[key];
  if (typeof v !== type) {
    throw new Error(`${key} is required (${type})`);
  }
  return v as never;
}
