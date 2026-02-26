export type HydraJson = Record<string, unknown>;

/** Parsed inbound WebSocket payload from hydra-node. */
export type HydraInboundMessage =
  | HydraGreetings
  | HydraTimedServerOutput
  | HydraTxValid
  | HydraTxInvalid
  | HydraServerSnapshot
  | HydraInvalidInput
  | HydraRawMessage;

/** `Greetings` — sent on each connection; marks API server readiness. */
export interface HydraGreetings {
  readonly kind: "greetings";
  readonly json: HydraJson;
}

/** A timed server output: protocol event with `seq` and `timestamp`. */
export interface HydraTimedServerOutput {
  readonly kind: "timed";
  readonly tag: string;
  readonly seq: number;
  readonly timestamp: string | undefined;
  readonly json: HydraJson;
}

/** `TxValid` — L2 transaction accepted (timed server output). */
export interface HydraTxValid {
  readonly kind: "txValid";
  readonly seq: number;
  readonly timestamp: string | undefined;
  readonly json: HydraJson;
}

/** `TxInvalid` — L2 transaction rejected (timed server output). */
export interface HydraTxInvalid {
  readonly kind: "txInvalid";
  readonly seq: number;
  readonly timestamp: string | undefined;
  readonly json: HydraJson;
}

/** `Snapshot` — head snapshot event (timed server output). */
export interface HydraServerSnapshot {
  readonly kind: "snapshot";
  readonly seq: number;
  readonly timestamp: string | undefined;
  readonly json: HydraJson;
}

/** Malformed client input response (`InvalidInput` in hydra-node). */
export interface HydraInvalidInput {
  readonly kind: "invalidInput";
  readonly reason: string;
  readonly input: string;
}

/** Fallback when classification is unknown (forward-compatible). */
export interface HydraRawMessage {
  readonly kind: "raw";
  readonly json: HydraJson;
}

export function getMessageSeq(m: HydraInboundMessage): number | undefined {
  switch (m.kind) {
    case "timed":
    case "txValid":
    case "txInvalid":
    case "snapshot":
      return m.seq;
    default:
      return undefined;
  }
}

export function txValidId(m: HydraTxValid): string | undefined {
  const id = m.json["transactionId"];
  return typeof id === "string" ? id : undefined;
}

export function txInvalidReason(m: HydraTxInvalid): string | undefined {
  const r = m.json["validationError"];
  return typeof r === "string" ? r : undefined;
}
