/** WebSocket transport lifecycle for hydra-node client API. */
export type HydraConnectionState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "reconnecting";
