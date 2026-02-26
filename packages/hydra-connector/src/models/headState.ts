import type { HydraJson } from "../messages.js";

/**
 * Parsed `GET /head` payload (Hydra `HeadState` envelope).
 *
 * Top-level JSON is `{ "tag": "Idle" | "Open" | ... , "contents"?: { ... } }`.
 */
export interface HydraHeadState {
  readonly tag: string;
  readonly contents?: HydraJson;
}

export const HydraHeadState = {
  tryParse(body: string): HydraHeadState | null {
    try {
      const decoded = JSON.parse(body);
      if (decoded === null || typeof decoded !== "object" || Array.isArray(decoded)) return null;
      const m = decoded as HydraJson;
      const tag = m["tag"];
      if (typeof tag !== "string") return null;
      const raw = m["contents"];
      const contents =
        raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as HydraJson) : undefined;
      return { tag, contents };
    } catch {
      return null;
    }
  },

  headId(state: HydraHeadState): string | undefined {
    const v = state.contents?.["headId"];
    return typeof v === "string" ? v : undefined;
  },

  pendingCommits(state: HydraHeadState): unknown[] | undefined {
    const v = state.contents?.["pendingCommits"];
    return Array.isArray(v) ? v : undefined;
  },

  parameters(state: HydraHeadState): HydraJson | undefined {
    const v = state.contents?.["parameters"];
    return v && typeof v === "object" && !Array.isArray(v) ? (v as HydraJson) : undefined;
  },

  committed(state: HydraHeadState): HydraJson | undefined {
    const v = state.contents?.["committed"];
    return v && typeof v === "object" && !Array.isArray(v) ? (v as HydraJson) : undefined;
  },
};
