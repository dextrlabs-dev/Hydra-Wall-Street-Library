import WebSocket, { type RawData } from "ws";

import { HydraClientConfig } from "./config.js";
import { TypedEmitter } from "./emitter.js";
import type { HydraInboundMessage, HydraJson } from "./messages.js";
import { parseHydraMessage } from "./parser.js";

/** Live WebSocket session to hydra-node client API. */
export class HydraSession {
  private ws: WebSocket | null = null;
  private readonly emitter = new TypedEmitter<HydraInboundMessage>();
  private doneListeners: Array<() => void> = [];

  constructor(readonly config: HydraClientConfig) {}

  /** Decoded server messages; first frame after connect is typically `Greetings`. */
  onMessage(listener: (m: HydraInboundMessage) => void): () => void {
    return this.emitter.on(listener);
  }

  onError(listener: (err: unknown) => void): () => void {
    return this.emitter.onError(listener);
  }

  onDone(listener: () => void): () => void {
    this.doneListeners.push(listener);
    return () => {
      this.doneListeners = this.doneListeners.filter((l) => l !== listener);
    };
  }

  get isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  connect(): Promise<void> {
    if (this.ws) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const url = this.config.webSocketUri().toString();
      const ws = new WebSocket(url);
      this.ws = ws;

      const onOpen = () => {
        ws.off("error", onError);
        resolve();
      };
      const onError = (err: Error) => {
        ws.off("open", onOpen);
        this.ws = null;
        reject(err);
      };

      ws.once("open", onOpen);
      ws.once("error", onError);

      ws.on("message", (data: RawData) => this.handleData(data));
      ws.on("error", (err: Error) => this.emitter.emitError(err));
      ws.on("close", () => {
        this.ws = null;
        for (const l of [...this.doneListeners]) {
          try {
            l();
          } catch {
            /* ignore */
          }
        }
      });
    });
  }

  private handleData(data: RawData): void {
    let text: string;
    if (typeof data === "string") {
      text = data;
    } else if (Buffer.isBuffer(data)) {
      text = data.toString("utf8");
    } else if (Array.isArray(data)) {
      text = Buffer.concat(data).toString("utf8");
    } else {
      text = Buffer.from(data as ArrayBuffer).toString("utf8");
    }
    try {
      this.emitter.emit(parseHydraMessage(text));
    } catch (err) {
      this.emitter.emitError(err);
    }
  }

  /** Sends a client input JSON object (e.g. `ClientInput.init()`). */
  send(clientInput: HydraJson): void {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      throw new Error("HydraSession.connect() must be called before send()");
    }
    ws.send(JSON.stringify(clientInput));
  }

  async close(): Promise<void> {
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    }
  }

  async dispose(): Promise<void> {
    await this.close();
    this.emitter.close();
    this.doneListeners = [];
  }
}
