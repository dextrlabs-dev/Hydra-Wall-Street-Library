import type { HydraJson } from "./messages.js";

/** JSON bodies for WebSocket client inputs (Hydra API reference). */
export const ClientInput = {
  init(): HydraJson {
    return { tag: "Init" };
  },
  close(): HydraJson {
    return { tag: "Close" };
  },
  safeClose(): HydraJson {
    return { tag: "SafeClose" };
  },
  contest(): HydraJson {
    return { tag: "Contest" };
  },
  fanout(): HydraJson {
    return { tag: "Fanout" };
  },
  /** transaction must match Hydra `Transaction` (cborHex, type, description, optional txId). */
  newTx(transaction: HydraJson): HydraJson {
    return { tag: "NewTx", transaction };
  },
  recover(recoverTxId: string): HydraJson {
    return { tag: "Recover", recoverTxId };
  },
  decommit(decommitTx: HydraJson): HydraJson {
    return { tag: "Decommit", decommitTx };
  },
  /** snapshot must match `ConfirmedSnapshot` schema from the API. */
  sideLoadSnapshot(snapshot: HydraJson): HydraJson {
    return { tag: "SideLoadSnapshot", snapshot };
  },
} as const;

export type ClientInputBuilders = typeof ClientInput;
