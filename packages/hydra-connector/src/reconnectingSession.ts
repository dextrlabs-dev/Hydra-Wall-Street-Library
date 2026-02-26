import type { HydraClientConfig } from "./config.js";
import type { HydraConnectionState } from "./connectionState.js";
import { TypedEmitter } from "./emitter.js";
import type { HydraInboundMessage, HydraJson } from "./messages.js";
import { HydraReconnectPolicy } from "./reconnectPolicy.js";
import { HydraSession } from "./session.js";

export type HydraDelayer = (ms: number) => Promise<void>;

const defaultDelayer: HydraDelayer = (ms) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

export interface ReconnectingHydraSessionInit {
  config: HydraClientConfig;
  policy?: HydraReconnectPolicy;
  delayer?: HydraDelayer;
}

/**
 * WebSocket session with automatic reconnect and a long-lived [messages]
 * stream that survives socket cycles.
 */
export class ReconnectingHydraSession {
  readonly config: HydraClientConfig;
  readonly policy: HydraReconnectPolicy;
  private readonly delayer: HydraDelayer;

  private readonly messagesEmitter = new TypedEmitter<HydraInboundMessage>();
  private readonly statesEmitter = new TypedEmitter<HydraConnectionState>();

  private session: HydraSession | null = null;
  private unsubMessage: (() => void) | null = null;
  private unsubError: (() => void) | null = null;
  private unsubDone: (() => void) | null = null;

  private userStop = true;
  private failAttempt = 0;
  private currentState: HydraConnectionState = "disconnected";

  /** Serializes connect / drop / disconnect operations. */
  private opQueue: Promise<void> = Promise.resolve();

  constructor(init: ReconnectingHydraSessionInit) {
    this.config = init.config;
    this.policy = init.policy ?? new HydraReconnectPolicy();
    this.delayer = init.delayer ?? defaultDelayer;
  }

  onMessage(listener: (m: HydraInboundMessage) => void): () => void {
    return this.messagesEmitter.on(listener);
  }

  onMessageError(listener: (err: unknown) => void): () => void {
    return this.messagesEmitter.onError(listener);
  }

  onConnectionState(listener: (state: HydraConnectionState) => void): () => void {
    return this.statesEmitter.on(listener);
  }

  get state(): HydraConnectionState {
    return this.currentState;
  }

  get isConnected(): boolean {
    return this.currentState === "connected" && this.session !== null;
  }

  private emitState(s: HydraConnectionState): void {
    this.currentState = s;
    this.statesEmitter.emit(s);
  }

  private serialize(fn: () => Promise<void>): Promise<void> {
    let resolve!: () => void;
    let reject!: (err: unknown) => void;
    const p = new Promise<void>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    this.opQueue = this.opQueue.then(async () => {
      try {
        await fn();
        resolve();
      } catch (err) {
        reject(err);
      }
    });
    return p;
  }

  /** Opens the first socket or resumes after disconnect. */
  connect(): Promise<void> {
    this.userStop = false;
    return this.serialize(async () => {
      if (this.isConnected) return;
      this.failAttempt = 0;
      while (!this.userStop) {
        this.emitState("connecting");
        try {
          await this.openSession();
          this.failAttempt = 0;
          this.emitState("connected");
          return;
        } catch (err) {
          if (this.userStop) break;
          if (!this.policy.autoReconnect) {
            await this.tearDownSession();
            this.emitState("disconnected");
            throw err;
          }
          this.emitState("reconnecting");
          await this.delayer(this.policy.delayForAttempt(this.failAttempt));
          if (this.userStop) break;
          this.failAttempt += 1;
        }
      }
      await this.tearDownSession();
      this.emitState("disconnected");
    });
  }

  private async openSession(): Promise<void> {
    await this.tearDownSession();
    const session = new HydraSession(this.config);
    this.session = session;
    this.unsubMessage = session.onMessage((m) => this.messagesEmitter.emit(m));
    this.unsubError = session.onError((e) => this.messagesEmitter.emitError(e));
    this.unsubDone = session.onDone(() => this.handleSessionDone());
    await session.connect();
  }

  private handleSessionDone(): void {
    void this.serialize(async () => {
      this.unsubMessage?.();
      this.unsubError?.();
      this.unsubDone?.();
      this.unsubMessage = this.unsubError = this.unsubDone = null;
      const s = this.session;
      this.session = null;
      if (s) await s.dispose();

      if (this.userStop) {
        this.emitState("disconnected");
        return;
      }
      if (!this.policy.autoReconnect) {
        this.emitState("disconnected");
        return;
      }

      this.failAttempt = 0;
      while (!this.userStop && this.policy.autoReconnect) {
        this.emitState("reconnecting");
        await this.delayer(this.policy.delayForAttempt(this.failAttempt));
        if (this.userStop) break;
        this.failAttempt += 1;
        this.emitState("connecting");
        try {
          await this.openSession();
          this.failAttempt = 0;
          this.emitState("connected");
          return;
        } catch {
          if (this.userStop) break;
        }
      }
      await this.tearDownSession();
      this.emitState("disconnected");
    });
  }

  private async tearDownSession(): Promise<void> {
    this.unsubMessage?.();
    this.unsubError?.();
    this.unsubDone?.();
    this.unsubMessage = this.unsubError = this.unsubDone = null;
    const s = this.session;
    this.session = null;
    if (s) await s.dispose();
  }

  /** Stops reconnecting and closes the socket. */
  disconnect(): Promise<void> {
    return this.serialize(async () => {
      this.userStop = true;
      await this.tearDownSession();
      this.emitState("disconnected");
    });
  }

  /** Sends a client input. Throws if not connected. */
  send(clientInput: HydraJson): void {
    const s = this.session;
    if (!s || !s.isConnected) {
      throw new Error("ReconnectingHydraSession is not connected; call connect() first.");
    }
    s.send(clientInput);
  }

  async dispose(): Promise<void> {
    await this.disconnect();
    this.messagesEmitter.close();
    this.statesEmitter.close();
  }
}
