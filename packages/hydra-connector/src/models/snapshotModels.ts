import type { HydraJson } from "../messages.js";

/** `GET /snapshot/last-seen` — operationId `getSeenSnapshot`. */
export type HydraSeenSnapshot =
  | { kind: "none" }
  | { kind: "last"; lastSeen: number }
  | { kind: "requested"; lastSeen: number; requested: number }
  | { kind: "inFlight"; raw: HydraJson };

export const HydraSeenSnapshot = {
  tryParse(body: string): HydraSeenSnapshot | null {
    try {
      const decoded = JSON.parse(body);
      if (decoded === null || typeof decoded !== "object" || Array.isArray(decoded)) return null;
      const m = decoded as HydraJson;
      const tag = m["tag"];
      if (typeof tag !== "string") return null;
      switch (tag) {
        case "NoSeenSnapshot":
          return { kind: "none" };
        case "LastSeenSnapshot":
          return { kind: "last", lastSeen: numericOrZero(m["lastSeen"]) };
        case "RequestedSnapshot":
          return {
            kind: "requested",
            lastSeen: numericOrZero(m["lastSeen"]),
            requested: numericOrZero(m["requested"]),
          };
        case "SeenSnapshot":
          return { kind: "inFlight", raw: m };
        default:
          return null;
      }
    } catch {
      return null;
    }
  },
};

/** `GET /snapshot` confirmed snapshot — operationId `getConfirmedSnapshot`. */
export type HydraConfirmedSnapshot =
  | { kind: "initial"; headId: string; initialUTxO?: HydraJson }
  | { kind: "signed"; raw: HydraJson };

export const HydraConfirmedSnapshot = {
  tryParse(body: string): HydraConfirmedSnapshot | null {
    try {
      const decoded = JSON.parse(body);
      if (decoded === null || typeof decoded !== "object" || Array.isArray(decoded)) return null;
      const m = decoded as HydraJson;
      const tag = m["tag"];
      if (typeof tag !== "string") return null;
      switch (tag) {
        case "InitialSnapshot": {
          const utxo = m["initialUTxO"];
          const headId = typeof m["headId"] === "string" ? (m["headId"] as string) : "";
          return {
            kind: "initial",
            headId,
            initialUTxO: utxo && typeof utxo === "object" && !Array.isArray(utxo)
              ? (utxo as HydraJson)
              : undefined,
          };
        }
        case "ConfirmedSnapshot":
          return { kind: "signed", raw: m };
        default:
          return null;
      }
    } catch {
      return null;
    }
  },
};

function numericOrZero(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
  return 0;
}
