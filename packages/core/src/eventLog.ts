import { createHash } from "node:crypto";

import type { EngineEvent, OrderInput } from "./types.js";

export interface EventLogEntry {
  /** Monotonic step index starting at 0 */
  index: number;
  /** Captured input for this step (deep-cloneable JSON) */
  input: OrderInput;
  /** Engine outputs produced for this input */
  outputs: EngineEvent[];
  /** SHA-256 chain digest after this step (hex) */
  hash: string;
}

const GENESIS_HASH = "00".repeat(32);

/** Stable JSON: keys sorted recursively so the chain hash is reproducible. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalJson(v)).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

/** rolling SHA-256: prevHash || canonicalJson(input) || canonicalJson(outputs) */
export function nextHash(prevHash: string, input: OrderInput, outputs: EngineEvent[]): string {
  const h = createHash("sha256");
  h.update(prevHash);
  h.update("|");
  h.update(canonicalJson(input));
  h.update("|");
  h.update(canonicalJson(outputs));
  return h.digest("hex");
}

/** Append-only log with a SHA-256 chain over (input, outputs) tuples. */
export class EventLog {
  private readonly entries: EventLogEntry[] = [];

  get size(): number {
    return this.entries.length;
  }

  /** Hash of the most recent entry, or the genesis hash when empty. */
  get headHash(): string {
    return this.entries.length === 0
      ? GENESIS_HASH
      : this.entries[this.entries.length - 1]!.hash;
  }

  toArray(): readonly EventLogEntry[] {
    return [...this.entries];
  }

  append(input: OrderInput, outputs: EngineEvent[]): EventLogEntry {
    const prev = this.headHash;
    const hash = nextHash(prev, input, outputs);
    const entry: EventLogEntry = {
      index: this.entries.length,
      input,
      outputs,
      hash,
    };
    this.entries.push(entry);
    return entry;
  }

  static genesisHash(): string {
    return GENESIS_HASH;
  }
}
