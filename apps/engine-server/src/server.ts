#!/usr/bin/env node
import { readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import cors from "@fastify/cors";
import Fastify, { type FastifyInstance } from "fastify";
import { WebSocketServer, type WebSocket } from "ws";

import {
  EventLog,
  MatchingEngine,
  withLog,
  type EngineEvent,
  type OrderInput,
} from "@hydra-ws/core";
import {
  applyTo,
  loadMarketConfig,
  type MarketConfig,
} from "@hydra-ws/market-config";
import { Anchorer, MockHydraAnchorTransport } from "@hydra-ws/anchoring";

interface CliOptions {
  port: number;
  marketsGlob: string[];
  anchor: boolean;
  anchorIntervalMs: number;
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    port: Number(process.env.ENGINE_PORT ?? 8080),
    marketsGlob: [],
    anchor: false,
    anchorIntervalMs: Number(process.env.ANCHOR_INTERVAL_MS ?? 5000),
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    switch (a) {
      case "--port":
        opts.port = Number(argv[++i]);
        break;
      case "--markets":
        opts.marketsGlob.push(argv[++i] ?? "");
        break;
      case "--anchor":
        opts.anchor = true;
        break;
      case "--anchor-interval":
        opts.anchorIntervalMs = Number(argv[++i]);
        break;
      default:
        if (a.startsWith("--")) console.warn(`unknown arg: ${a}`);
    }
  }
  return opts;
}

async function expandGlob(pattern: string): Promise<string[]> {
  const abs = resolve(pattern);
  // Only the final path segment may contain a wildcard (e.g. "markets/*.yaml").
  const dir = dirname(abs);
  const base = abs.slice(dir.length + 1);
  if (!base.includes("*") && !base.includes("?")) {
    return [abs];
  }
  const re = new RegExp(
    "^" + base.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".") + "$",
  );
  let entries: string[] = [];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }
  return entries.filter((e) => re.test(e)).map((e) => resolve(dir, e));
}

async function loadMarkets(patterns: string[]): Promise<Map<string, MarketConfig>> {
  const out = new Map<string, MarketConfig>();
  for (const pattern of patterns) {
    if (!pattern) continue;
    const files = await expandGlob(pattern);
    for (const file of files) {
      try {
        const cfg = await loadMarketConfig(file);
        out.set(cfg.symbol, cfg);
        console.log(`loaded market ${cfg.symbol} (${cfg.asset_class}) from ${file}`);
      } catch (err) {
        console.warn(`skip ${file}: ${(err as Error).message}`);
      }
    }
  }
  return out;
}

interface SymbolState {
  guarded: (order: OrderInput, now?: Date) => { events: EngineEvent[]; rejected: { reason: string } | null };
  log: EventLog;
}

function build(_opts: CliOptions, markets: Map<string, MarketConfig>) {
  const engine = new MatchingEngine();
  const log = new EventLog();
  const submit = withLog(engine, log);

  // Per-symbol guard wrappers (each delegates to the same shared engine via withLog)
  const symbolStates = new Map<string, SymbolState>();
  for (const [sym, cfg] of markets) {
    const guarded = applyTo(engine, cfg);
    symbolStates.set(sym, {
      guarded: (order, now) => {
        if (order.kind === "cancel") {
          return { events: submit(order), rejected: null };
        }
        const result = guarded(order, now);
        if (!result.rejected) {
          // applyTo already invoked engine.submit; we still need to log it.
          log.append(order, result.events);
        }
        return result;
      },
      log,
    });
  }

  const wsClients = new Map<string, Set<WebSocket>>();
  const broadcast = (symbol: string, payload: unknown) => {
    const set = wsClients.get(symbol);
    if (!set) return;
    const text = JSON.stringify(payload);
    for (const ws of set) {
      if (ws.readyState === ws.OPEN) ws.send(text);
    }
  };

  function handleOrder(order: OrderInput): { events: EngineEvent[]; rejected: { reason: string } | null } {
    let result: { events: EngineEvent[]; rejected: { reason: string } | null };
    if (order.kind === "cancel") {
      result = { events: submit(order), rejected: null };
    } else {
      const state = symbolStates.get(order.symbol);
      if (state) {
        result = state.guarded(order);
      } else {
        result = { events: submit(order), rejected: null };
      }
    }
    if (order.kind !== "cancel") {
      broadcast(order.symbol, { type: "events", events: result.events });
      const snap = engine.snapshot(order.symbol);
      if (snap) broadcast(order.symbol, { type: "book", book: snap });
    } else {
      // for cancels, broadcast under each symbol whose orders were touched
      for (const ev of result.events) {
        if (ev.type === "cancelled") broadcast(ev.symbol, { type: "events", events: [ev] });
      }
    }
    return result;
  }

  return { engine, log, handleOrder, broadcast, wsClients };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const markets = await loadMarkets(opts.marketsGlob);
  const { engine, log, handleOrder, wsClients } = build(opts, markets);

  let anchorer: Anchorer | undefined;
  if (opts.anchor) {
    const transport = new MockHydraAnchorTransport();
    anchorer = new Anchorer({
      transport,
      hashSource: () => log.headHash,
      intervalMs: opts.anchorIntervalMs,
    });
    anchorer.start();
    console.log(`anchoring enabled every ${opts.anchorIntervalMs}ms (mock transport)`);
  }

  const fastify: FastifyInstance = Fastify({ logger: false });
  await fastify.register(cors, { origin: true });

  fastify.get("/health", async () => ({ ok: true }));

  fastify.get("/markets", async () =>
    Array.from(markets.values()).map((m) => ({
      symbol: m.symbol,
      asset_class: m.asset_class,
      tick_size: m.tick_size,
      lot_size: m.lot_size,
    })),
  );

  fastify.get<{ Params: { symbol: string } }>("/book/:symbol", async (req, reply) => {
    const snap = engine.snapshot(req.params.symbol);
    if (!snap) return reply.status(404).send({ error: "no book" });
    return snap;
  });

  fastify.post<{ Body: OrderInput }>("/orders", async (req, reply) => {
    const order = req.body;
    if (!order || typeof order !== "object") return reply.status(400).send({ error: "invalid body" });
    const result = handleOrder(order);
    if (result.rejected) return reply.status(409).send({ rejected: result.rejected, events: result.events });
    return { events: result.events };
  });

  fastify.delete<{ Params: { id: string }; Body: { targetOrderId?: string } }>("/orders/:id", async (req) => {
    const cancelId = req.params.id;
    const target = req.body?.targetOrderId ?? cancelId;
    return handleOrder({ kind: "cancel", id: cancelId, targetOrderId: target });
  });

  fastify.get("/metrics", async () => ({
    log: { size: log.size, headHash: log.headHash },
    anchoring: anchorer ? anchorer.metrics() : null,
  }));

  fastify.get("/anchors", async () => (anchorer ? anchorer.list() : []));

  fastify.get<{ Params: { hash: string } }>("/verify/:hash", async (req, reply) => {
    if (!anchorer) return reply.status(404).send({ error: "anchoring disabled" });
    return anchorer.verify(req.params.hash);
  });

  await fastify.listen({ port: opts.port, host: "0.0.0.0" });
  const address = fastify.server.address();
  const portShown =
    typeof address === "object" && address && "port" in address ? address.port : opts.port;
  console.log(`engine-server listening on http://0.0.0.0:${portShown}`);

  const wss = new WebSocketServer({ server: fastify.server });
  wss.on("connection", (ws, req) => {
    const url = new URL(req.url ?? "/", "http://x");
    if (!url.pathname.startsWith("/stream/")) {
      ws.close();
      return;
    }
    const symbol = url.pathname.slice("/stream/".length);
    let set = wsClients.get(symbol);
    if (!set) {
      set = new Set();
      wsClients.set(symbol, set);
    }
    set.add(ws);
    const snap = engine.snapshot(symbol);
    if (snap) ws.send(JSON.stringify({ type: "book", book: snap }));
    ws.on("close", () => set?.delete(ws));
    ws.on("error", () => set?.delete(ws));
  });

  const shutdown = async () => {
    anchorer?.stop();
    wss.clients.forEach((c) => c.close());
    await fastify.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
