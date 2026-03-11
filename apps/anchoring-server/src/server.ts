#!/usr/bin/env node
import { createHash } from "node:crypto";

import Fastify from "fastify";
import { Anchorer, MockHydraAnchorTransport, type AnchorTransport, type HashSource } from "@hydra-ws/anchoring";
import {
  HydraClientConfig,
  HydraHeadFacade,
} from "@hydra-ws/hydra-connector";

interface ServerOptions {
  port: number;
  intervalMs: number;
  mode: "mock" | "hydra";
  hydraHost?: string;
  hydraPort?: number;
  hydraSecure?: boolean;
}

function parseArgs(argv: string[]): ServerOptions {
  const opts: ServerOptions = {
    port: Number(process.env.ANCHOR_PORT ?? 8088),
    intervalMs: Number(process.env.ANCHOR_INTERVAL_MS ?? 0),
    mode: (process.env.ANCHOR_MODE as "mock" | "hydra") ?? "mock",
    hydraHost: process.env.HYDRA_HOST,
    hydraPort: process.env.HYDRA_PORT ? Number(process.env.HYDRA_PORT) : 4001,
    hydraSecure: process.env.HYDRA_SECURE === "true",
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    switch (a) {
      case "--port":
        opts.port = Number(argv[++i]);
        break;
      case "--interval-ms":
        opts.intervalMs = Number(argv[++i]);
        break;
      case "--mock":
        opts.mode = "mock";
        break;
      case "--hydra":
        opts.mode = "hydra";
        break;
      case "--hydra-host":
        opts.hydraHost = argv[++i];
        break;
      case "--hydra-port":
        opts.hydraPort = Number(argv[++i]);
        break;
      case "--hydra-secure":
        opts.hydraSecure = argv[++i] === "true";
        break;
      default:
        if (a.startsWith("--")) console.warn(`unknown arg: ${a}`);
    }
  }
  return opts;
}

async function buildTransport(opts: ServerOptions): Promise<{
  transport: AnchorTransport;
  dispose: () => Promise<void>;
}> {
  if (opts.mode === "mock") {
    return { transport: new MockHydraAnchorTransport(), dispose: async () => {} };
  }
  if (!opts.hydraHost) {
    throw new Error("--hydra mode requires HYDRA_HOST or --hydra-host");
  }
  const facade = new HydraHeadFacade({
    config: new HydraClientConfig({
      host: opts.hydraHost,
      port: opts.hydraPort ?? 4001,
      secure: opts.hydraSecure ?? false,
    }),
  });
  await facade.connect();
  const transport: AnchorTransport = {
    sendNewTx: (tx) => facade.sendNewTx(tx),
    onMessage: (listener) => facade.onMessage(listener),
  };
  return {
    transport,
    dispose: async () => facade.dispose(),
  };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const fastify = Fastify({ logger: true });

  let currentHash = createHash("sha256").update(`bootstrap-${Date.now()}`).digest("hex");
  const hashSource: HashSource = () => currentHash;

  const { transport, dispose } = await buildTransport(opts);
  const anchorer = new Anchorer({ transport, hashSource, intervalMs: opts.intervalMs });
  anchorer.start();

  fastify.post<{ Body?: { hash?: string } }>("/anchor", async (req) => {
    if (req.body?.hash) currentHash = req.body.hash;
    const record = anchorer.anchorOnce();
    return record;
  });

  fastify.get<{ Params: { hash: string } }>("/verify/:hash", async (req) => {
    return anchorer.verify(req.params.hash);
  });

  fastify.get("/anchors", async () => anchorer.list());

  fastify.get("/metrics", async () => anchorer.metrics());

  fastify.get("/health", async () => ({ ok: true }));

  fastify.addHook("onClose", async () => {
    anchorer.stop();
    await dispose();
  });

  await fastify.listen({ port: opts.port, host: "0.0.0.0" });
  fastify.log.info({ mode: opts.mode, intervalMs: opts.intervalMs }, "anchoring-server up");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
