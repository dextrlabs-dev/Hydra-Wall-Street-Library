import { ClientInput } from "./clientInput.js";
import type { HydraClientConfig } from "./config.js";
import type { HydraConnectionState } from "./connectionState.js";
import { TypedEmitter } from "./emitter.js";
import { HydraHttpClient } from "./hydraHttp.js";
import type { HydraInboundMessage, HydraJson } from "./messages.js";
import { HydraReconnectPolicy } from "./reconnectPolicy.js";
import { ReconnectingHydraSession } from "./reconnectingSession.js";
import { SeqTracker, type HydraSyncPolicy } from "./seqSync.js";
import type { HydraSigner } from "./signer.js";
import { InMemoryHydraStateStore, type HydraStateStore } from "./stateStore.js";

export interface HydraHeadFacadeInit {
  config: HydraClientConfig;
  reconnectPolicy?: HydraReconnectPolicy;
  syncPolicy?: HydraSyncPolicy;
  stateStore?: HydraStateStore;
  fetchImpl?: typeof fetch;
  signer?: HydraSigner;
  onSeqGap?: (lastSeq: number, receivedSeq: number) => void;
}

/**
 * High-level Hydra head client: reconnecting WebSocket, HTTP, optional seq
 * sync, and typed head lifecycle helpers.
 *
 * For low-level control use HydraSession / ReconnectingHydraSession directly.
 */
export class HydraHeadFacade {
  readonly config: HydraClientConfig;
  readonly stateStore: HydraStateStore;
  readonly hydraHttp: HydraHttpClient;
  readonly signer?: HydraSigner;

  private readonly session: ReconnectingHydraSession;
  private readonly seq: SeqTracker;
  private readonly messages = new TypedEmitter<HydraInboundMessage>();
  private unsubMessage: (() => void) | null = null;

  constructor(init: HydraHeadFacadeInit) {
    this.config = init.config;
    this.stateStore = init.stateStore ?? new InMemoryHydraStateStore();
    this.signer = init.signer;
    this.hydraHttp = new HydraHttpClient({ config: this.config, fetchImpl: init.fetchImpl });
    this.session = new ReconnectingHydraSession({
      config: this.config,
      policy: init.reconnectPolicy ?? new HydraReconnectPolicy(),
    });
    const policy = init.syncPolicy ?? "none";
    this.seq = new SeqTracker({
      policy,
      store: this.stateStore,
      http: policy === "dedupeAndRefreshOnGap" ? this.hydraHttp : undefined,
      onSeqGap: init.onSeqGap,
    });
  }

  onMessage(listener: (m: HydraInboundMessage) => void): () => void {
    return this.messages.on(listener);
  }

  onMessageError(listener: (err: unknown) => void): () => void {
    return this.messages.onError(listener);
  }

  onConnectionState(listener: (s: HydraConnectionState) => void): () => void {
    return this.session.onConnectionState(listener);
  }

  get connectionState(): HydraConnectionState {
    return this.session.state;
  }

  get lastProcessedSeq(): number | undefined {
    return this.seq.lastSeq;
  }

  /** Subscribe to message flow, then open the socket (and reconnect if configured). */
  async connect(options: { restoreSeq?: boolean } = {}): Promise<void> {
    this.unsubMessage?.();
    this.unsubMessage = null;
    if (options.restoreSeq ?? true) {
      await this.seq.restore();
    } else {
      this.seq.reset();
    }
    this.unsubMessage = this.session.onMessage((m) => {
      void this.seq.process(m).then((forwarded) => {
        if (forwarded) this.messages.emit(forwarded);
      }).catch((err) => this.messages.emitError(err));
    });
    this.session.onMessageError((err) => this.messages.emitError(err));
    await this.session.connect();
  }

  async disconnect(): Promise<void> {
    this.unsubMessage?.();
    this.unsubMessage = null;
    await this.session.disconnect();
  }

  sendInit(): void {
    this.session.send(ClientInput.init());
  }

  sendClose(): void {
    this.session.send(ClientInput.close());
  }

  sendSafeClose(): void {
    this.session.send(ClientInput.safeClose());
  }

  sendContest(): void {
    this.session.send(ClientInput.contest());
  }

  sendFanout(): void {
    this.session.send(ClientInput.fanout());
  }

  sendNewTx(transaction: HydraJson): void {
    this.session.send(ClientInput.newTx(transaction));
  }

  sendRecover(recoverTxId: string): void {
    this.session.send(ClientInput.recover(recoverTxId));
  }

  sendDecommit(decommitTx: HydraJson): void {
    this.session.send(ClientInput.decommit(decommitTx));
  }

  sendSideLoadSnapshot(snapshot: HydraJson): void {
    this.session.send(ClientInput.sideLoadSnapshot(snapshot));
  }

  /** Raw client input JSON (escape hatch). */
  sendRaw(clientInput: HydraJson): void {
    this.session.send(clientInput);
  }

  async dispose(): Promise<void> {
    await this.disconnect();
    await this.session.dispose();
    this.messages.close();
    this.hydraHttp.close();
  }
}
