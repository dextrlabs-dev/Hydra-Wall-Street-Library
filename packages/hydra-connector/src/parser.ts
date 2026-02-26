import type {
  HydraInboundMessage,
  HydraJson,
} from "./messages.js";

/** Parses one WebSocket text frame from hydra-node. */
export function parseHydraMessage(text: string): HydraInboundMessage {
  let decoded: unknown;
  try {
    decoded = JSON.parse(text);
  } catch {
    return { kind: "raw", json: { value: text } };
  }
  if (decoded === null || typeof decoded !== "object" || Array.isArray(decoded)) {
    return { kind: "raw", json: { value: decoded as never } };
  }
  const m = decoded as HydraJson;

  if (isInvalidInput(m)) {
    return {
      kind: "invalidInput",
      reason: String(m["reason"]),
      input: String(m["input"]),
    };
  }

  if (isGreetings(m)) {
    return { kind: "greetings", json: m };
  }

  const tag = m["tag"];
  const seqRaw = m["seq"];
  const seq =
    typeof seqRaw === "number" && Number.isFinite(seqRaw)
      ? Math.trunc(seqRaw)
      : undefined;
  const timestamp = typeof m["timestamp"] === "string" ? (m["timestamp"] as string) : undefined;

  if (typeof tag === "string" && seq !== undefined) {
    switch (tag) {
      case "TxValid":
        return { kind: "txValid", seq, timestamp, json: m };
      case "TxInvalid":
        return { kind: "txInvalid", seq, timestamp, json: m };
      case "Snapshot":
        return { kind: "snapshot", seq, timestamp, json: m };
      default:
        return { kind: "timed", tag, seq, timestamp, json: m };
    }
  }

  return { kind: "raw", json: m };
}

function isInvalidInput(m: HydraJson): boolean {
  return "reason" in m && "input" in m && (m["tag"] === undefined || m["tag"] === null);
}

function isGreetings(m: HydraJson): boolean {
  if (m["tag"] === "Greetings") return true;
  return (
    "headStatus" in m &&
    "hydraNodeVersion" in m &&
    "me" in m &&
    (m["seq"] === undefined || m["seq"] === null)
  );
}
