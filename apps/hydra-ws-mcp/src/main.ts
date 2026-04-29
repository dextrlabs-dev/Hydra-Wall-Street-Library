#!/usr/bin/env node
/**
 * stdio MCP server for Hydra Wall Street: engine-server HTTP + optional Alpaca Trading REST.
 * Configure Cursor/VS Code MCP with command `node` and args pointing at dist/main.js, plus env from .env (never commit secrets).
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { AlpacaTradingClient, type AlpacaTradingOptions } from "@hydra-ws/adapters-alpaca";

function jsonText(data: unknown): { content: [{ type: "text"; text: string }] } {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

function errText(message: string): { content: [{ type: "text"; text: string }]; isError: true } {
  return { content: [{ type: "text", text: message }], isError: true };
}

async function tryJson(p: Promise<unknown>) {
  try {
    return jsonText(await p);
  } catch (e) {
    return errText(e instanceof Error ? e.message : String(e));
  }
}

const engineBase = (process.env.ENGINE_BASE_URL ?? "http://127.0.0.1:8080").replace(/\/$/, "");

async function engineFetch(path: string, init?: RequestInit): Promise<unknown> {
  const url = `${engineBase}${path.startsWith("/") ? path : `/${path}`}`;
  const r = await fetch(url, init);
  const text = await r.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    /* keep raw text */
  }
  if (!r.ok) {
    const detail = typeof body === "string" ? body : JSON.stringify(body);
    throw new Error(`${r.status} ${r.statusText}: ${detail}`);
  }
  return body;
}

function alpacaOptions(): AlpacaTradingOptions | null {
  const keyId = process.env.APCA_API_KEY_ID ?? process.env.ALPACA_API_KEY;
  const secretKey = process.env.APCA_API_SECRET_KEY ?? process.env.ALPACA_SECRET_KEY;
  if (!keyId || !secretKey) return null;
  const paperRaw = process.env.ALPACA_PAPER ?? process.env.ALPACA_PAPER_TRADE ?? "true";
  const paper = paperRaw.toLowerCase() !== "false";
  const baseUrl =
    process.env.ALPACA_TRADING_BASE_URL ??
    (paper ? "https://paper-api.alpaca.markets" : "https://api.alpaca.markets");
  return { keyId, secretKey, baseUrl };
}

async function main(): Promise<void> {
  const mcp = new McpServer(
    { name: "hydra-ws-mcp", version: "0.1.0" },
    {
      instructions:
        "Tools for the Hydra Wall Street local matching engine (engine-server) and optional Alpaca paper/live REST. " +
        "Set ENGINE_BASE_URL for the engine. Set APCA_API_KEY_ID + APCA_API_SECRET_KEY (or ALPACA_API_KEY + ALPACA_SECRET_KEY) for Alpaca tools.",
    },
  );

  mcp.registerTool(
    "hydra_engine_health",
    { description: "GET /health on engine-server (ENGINE_BASE_URL)." },
    async () => tryJson(engineFetch("/health")),
  );

  mcp.registerTool(
    "hydra_engine_markets",
    { description: "List markets loaded in engine-server (GET /markets)." },
    async () => tryJson(engineFetch("/markets")),
  );

  mcp.registerTool(
    "hydra_engine_book",
    {
      description: "Order book snapshot for one symbol (GET /book/:symbol).",
      inputSchema: { symbol: z.string().describe("Symbol, e.g. AAPL") },
    },
    async ({ symbol }) => tryJson(engineFetch(`/book/${encodeURIComponent(symbol)}`)),
  );

  mcp.registerTool(
    "hydra_engine_metrics",
    { description: "Event log size, head hash, optional anchoring metrics (GET /metrics)." },
    async () => tryJson(engineFetch("/metrics")),
  );

  mcp.registerTool(
    "hydra_engine_submit_order",
    {
      description:
        "POST /orders on engine-server. Body is a LimitOrIoc or cancel per @hydra-ws/core OrderInput (kind, id, symbol, side, priceTicks, quantity for limit/ioc).",
      inputSchema: {
        order: z
          .record(z.unknown())
          .describe("OrderInput JSON, e.g. { kind: 'limit', id: 'o1', symbol: 'AAPL', side: 'buy', priceTicks: 15000, quantity: 10 }"),
      },
    },
    async ({ order }) =>
      tryJson(
        engineFetch("/orders", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(order),
        }),
      ),
  );

  mcp.registerTool(
    "hydra_engine_cancel_order",
    {
      description: "DELETE /orders/:id — cancel by client order id; optional targetOrderId in JSON body.",
      inputSchema: {
        id: z.string().describe("Cancel instruction id"),
        targetOrderId: z.string().optional().describe("Resting order to cancel (defaults to id)"),
      },
    },
    async ({ id, targetOrderId }) =>
      tryJson(
        engineFetch(`/orders/${encodeURIComponent(id)}`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(targetOrderId ? { targetOrderId } : {}),
        }),
      ),
  );

  const alpaca = alpacaOptions();
  if (alpaca) {
    const client = new AlpacaTradingClient(alpaca);

    mcp.registerTool(
      "alpaca_get_account",
      { description: "GET /v2/account via Alpaca Trading API (paper or live from env)." },
      async () => tryJson(client.getAccount()),
    );

    mcp.registerTool(
      "alpaca_get_orders",
      {
        description: "GET /v2/orders with optional status filter.",
        inputSchema: {
          status: z.enum(["open", "closed", "all"]).optional().describe("Order status filter"),
        },
      },
      async (args) => tryJson(client.getOrders(args.status)),
    );

    mcp.registerTool(
      "alpaca_submit_order",
      {
        description:
          "POST /v2/orders on Alpaca (JSON body per Alpaca REST docs: symbol, qty, side, type, time_in_force, etc.).",
        inputSchema: {
          body: z.record(z.unknown()).describe("Alpaca order object"),
        },
      },
      async ({ body }) => tryJson(client.submitOrder(body as Record<string, unknown>)),
    );

    mcp.registerTool(
      "alpaca_cancel_order",
      {
        description: "DELETE /v2/orders/{order_id} on Alpaca.",
        inputSchema: { orderId: z.string() },
      },
      async ({ orderId }) =>
        tryJson(
          client.cancelOrder(orderId).then(() => ({ ok: true, orderId })),
        ),
    );
  }

  const transport = new StdioServerTransport();
  await mcp.connect(transport);
}

main().catch((e) => {
  const msg = e instanceof Error ? e.message : String(e);
  process.stderr.write(`${msg}\n`);
  process.exit(1);
});
