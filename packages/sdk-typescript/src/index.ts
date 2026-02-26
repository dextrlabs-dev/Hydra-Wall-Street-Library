import { MatchingEngine, type EngineEvent, type FillEvent, type OrderInput } from "@hydra-ws/core";
import {
  AlpacaMarketDataStream,
  AlpacaTradingClient,
  type AlpacaTradingOptions,
} from "@hydra-ws/adapters-alpaca";
import {
  HydraClientConfig,
  HydraHeadFacade,
  type HydraHeadFacadeInit,
  type HydraJson,
} from "@hydra-ws/hydra-connector";

export type {
  EngineEvent,
  FillEvent,
  LimitOrIocInput,
  OrderInput,
} from "@hydra-ws/core";
export { MatchingEngine, SyntheticFeed } from "@hydra-ws/core";
export {
  AlpacaMarketDataStream,
  AlpacaTradingClient,
} from "@hydra-ws/adapters-alpaca";
export {
  HydraClientConfig,
  HydraHeadFacade,
  HydraReconnectPolicy,
  ClientInput,
  parseHydraMessage,
  HydraHttpClient,
  HydraHeadState,
  HydraSeenSnapshot,
  HydraConfirmedSnapshot,
  InMemoryHydraStateStore,
  FileHydraStateStore,
  SeqTracker,
} from "@hydra-ws/hydra-connector";
export type {
  HydraClientConfigInit,
  HydraConnectionState,
  HydraInboundMessage,
  HydraTimedServerOutput,
  HydraTxValid,
  HydraTxInvalid,
  HydraServerSnapshot,
  HydraGreetings,
  HydraInvalidInput,
  HydraRawMessage,
  HydraJson,
  HydraSyncPolicy,
  HydraStateStore,
  HydraSigner,
  HydraReconnectPolicyInit,
} from "@hydra-ws/hydra-connector";

export interface SessionTelemetry {
  ordersSubmitted: number;
  eventsProcessed: number;
  startedAt: number;
  hydraReconnects: number;
  seqGaps: number;
}

/** App-supplied function turning a fill into Hydra `Transaction` JSON (cborHex/type/description). */
export type HydraTxBuilder = (fill: FillEvent) => HydraJson | null;

/** Thin façade: deterministic engine + optional Alpaca REST/stream + optional Hydra head. */
export class HydraWallStreetSession {
  readonly engine = new MatchingEngine();
  telemetry: SessionTelemetry = {
    ordersSubmitted: 0,
    eventsProcessed: 0,
    startedAt: Date.now(),
    hydraReconnects: 0,
    seqGaps: 0,
  };

  private hydra?: HydraHeadFacade;
  private hydraDisposers: Array<() => void> = [];

  constructor(
    readonly symbol: string,
    readonly alpaca?: AlpacaTradingClient,
  ) {}

  /** Optional injected Alpaca REST client for mirrored brokerage workflows */
  getAlpaca(): AlpacaTradingClient | undefined {
    return this.alpaca;
  }

  /** Returns the attached Hydra head facade, if any. */
  getHydra(): HydraHeadFacade | undefined {
    return this.hydra;
  }

  submit(order: OrderInput): EngineEvent[] {
    this.telemetry.ordersSubmitted += 1;
    const ev = this.engine.submit(order);
    this.telemetry.eventsProcessed += ev.length;
    return ev;
  }

  snapshot() {
    return this.engine.snapshot(this.symbol);
  }

  /** Attach a HydraHeadFacade and start counting reconnects / seq gaps. */
  attachHydra(facade: HydraHeadFacade): void {
    this.hydra = facade;
    let last: string | undefined;
    this.hydraDisposers.push(
      facade.onConnectionState((s) => {
        if (last && s === "connecting" && (last === "connected" || last === "reconnecting")) {
          this.telemetry.hydraReconnects += 1;
        }
        last = s;
      }),
    );
  }

  /**
   * Spin up a new HydraHeadFacade with the given init, attach it, and connect.
   * Convenience wrapper around `attachHydra(new HydraHeadFacade(...))`.
   */
  async connectHydra(init: HydraHeadFacadeInit): Promise<HydraHeadFacade> {
    const facade = new HydraHeadFacade({
      ...init,
      onSeqGap: (lastSeq, receivedSeq) => {
        this.telemetry.seqGaps += 1;
        init.onSeqGap?.(lastSeq, receivedSeq);
      },
    });
    this.attachHydra(facade);
    await facade.connect();
    return facade;
  }

  /**
   * Forward a `FillEvent` to the attached Hydra head as a `NewTx` client input.
   * `txBuilder` returns the `Transaction` JSON (cborHex, type, description, optional txId)
   * or `null` to skip mirroring this fill.
   */
  mirrorFillToHydra(fill: FillEvent, txBuilder: HydraTxBuilder): boolean {
    const facade = this.hydra;
    if (!facade) return false;
    const tx = txBuilder(fill);
    if (!tx) return false;
    facade.sendNewTx(tx);
    return true;
  }

  async disposeHydra(): Promise<void> {
    for (const d of this.hydraDisposers.splice(0)) d();
    if (this.hydra) {
      await this.hydra.dispose();
      this.hydra = undefined;
    }
  }

  /** Paper REST client from env */
  static alpacaFromEnv(): AlpacaTradingClient | undefined {
    const keyId = process.env.APCA_API_KEY_ID;
    const secretKey = process.env.APCA_API_SECRET_KEY;
    if (!keyId || !secretKey) return undefined;
    const opts: AlpacaTradingOptions = {
      keyId,
      secretKey,
      baseUrl:
        process.env.ALPACA_TRADING_BASE_URL ??
        (process.env.ALPACA_PAPER !== "false"
          ? "https://paper-api.alpaca.markets"
          : "https://api.alpaca.markets"),
    };
    return new AlpacaTradingClient(opts);
  }

  static marketStreamFromEnv(): AlpacaMarketDataStream | undefined {
    const keyId = process.env.APCA_API_KEY_ID;
    const secretKey = process.env.APCA_API_SECRET_KEY;
    if (!keyId || !secretKey) return undefined;
    return new AlpacaMarketDataStream({ keyId, secretKey });
  }

  /** Build a `HydraClientConfig` from `HYDRA_HOST` / `HYDRA_PORT` / `HYDRA_SECURE` / `HYDRA_HISTORY`. */
  static hydraConfigFromEnv(): HydraClientConfig | undefined {
    const host = process.env.HYDRA_HOST;
    if (!host) return undefined;
    const port = process.env.HYDRA_PORT ? Number(process.env.HYDRA_PORT) : 4001;
    const secure = process.env.HYDRA_SECURE === "true";
    const history =
      process.env.HYDRA_HISTORY === undefined
        ? undefined
        : process.env.HYDRA_HISTORY === "yes" || process.env.HYDRA_HISTORY === "true";
    return new HydraClientConfig({ host, port, secure, history });
  }
}
