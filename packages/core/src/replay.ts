import { MatchingEngine } from "./engine.js";
import { EventLog, type EventLogEntry, nextHash } from "./eventLog.js";
import type { EngineEvent, OrderInput } from "./types.js";

export class ReplayMismatchError extends Error {
  constructor(
    readonly stepIndex: number,
    readonly expectedHash: string,
    readonly actualHash: string,
  ) {
    super(
      `replay hash mismatch at step ${stepIndex}: expected ${expectedHash}, got ${actualHash}`,
    );
    this.name = "ReplayMismatchError";
  }
}

export interface ReplayResult {
  finalHash: string;
  events: EngineEvent[];
  steps: number;
}

/**
 * Replays the supplied log against a fresh engine. Throws ReplayMismatchError
 * if any step's recomputed hash diverges from what was recorded.
 */
export function replay(log: ReadonlyArray<EventLogEntry>): ReplayResult {
  const engine = new MatchingEngine();
  const allEvents: EngineEvent[] = [];
  let prevHash = EventLog.genesisHash();

  for (const entry of log) {
    const outputs = engine.submit(entry.input);
    const computed = nextHash(prevHash, entry.input, outputs);
    if (computed !== entry.hash) {
      throw new ReplayMismatchError(entry.index, entry.hash, computed);
    }
    prevHash = computed;
    allEvents.push(...outputs);
  }

  return { finalHash: prevHash, events: allEvents, steps: log.length };
}

/**
 * Wraps an engine so each `submit` is also appended to `log`. The engine's
 * existing return value is preserved.
 */
export function withLog(
  engine: MatchingEngine,
  log: EventLog,
): (order: OrderInput) => EngineEvent[] {
  return (order: OrderInput): EngineEvent[] => {
    const outputs = engine.submit(order);
    log.append(order, outputs);
    return outputs;
  };
}
