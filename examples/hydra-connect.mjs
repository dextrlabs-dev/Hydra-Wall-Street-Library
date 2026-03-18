#!/usr/bin/env node
/**
 * Open a HydraHeadFacade against the configured hydra-node, print connection
 * state transitions and inbound messages for ~5 seconds, then dispose.
 *
 * Reads HYDRA_HOST / HYDRA_PORT / HYDRA_SECURE / HYDRA_HISTORY from .env.
 */
import { loadDotEnv } from "./_loadEnv.mjs";
loadDotEnv(import.meta.url);

const { HydraWallStreetSession, HydraHeadFacade, HydraReconnectPolicy } = await import(
  "@hydra-ws/sdk"
);

const config = HydraWallStreetSession.hydraConfigFromEnv();
if (!config) {
  console.error("Set HYDRA_HOST in .env to point at your hydra-node API port");
  process.exit(1);
}

const facade = new HydraHeadFacade({
  config,
  reconnectPolicy: new HydraReconnectPolicy({ initialDelayMs: 250, maxDelayMs: 3000 }),
  syncPolicy: "dedupeOnly",
});

const stop = facade.onConnectionState((s) => console.log(`[state] ${s}`));
const stop2 = facade.onMessage((m) => console.log(`[msg] ${m.kind}${"tag" in m ? ` ${m.tag}` : ""}`));
facade.onMessageError((err) => console.error("[err]", err));

console.log("connecting to", config.webSocketUri().toString());

void facade.connect().catch((err) => console.error("connect failed:", err));

await new Promise((resolve) => setTimeout(resolve, 5000));

stop();
stop2();
await facade.dispose();
console.log("done.");
