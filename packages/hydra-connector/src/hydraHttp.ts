import type { HydraClientConfig } from "./config.js";

export interface HydraHttpClientInit {
  config: HydraClientConfig;
  /** Optional injected fetch (test stub or pinned client). Defaults to `globalThis.fetch`. */
  fetchImpl?: typeof fetch;
}

/**
 * HTTP endpoints exposed by hydra-node alongside WebSockets.
 *
 * For TLS pinning, pass a `fetchImpl` backed by a custom `https.Agent` /
 * `undici.Dispatcher`; the default uses the platform trust store.
 */
export class HydraHttpClient {
  private readonly config: HydraClientConfig;
  private readonly fetchImpl: typeof fetch;

  constructor(init: HydraHttpClientInit) {
    this.config = init.config;
    this.fetchImpl =
      init.fetchImpl ??
      (typeof fetch === "function" ? fetch.bind(globalThis) : undefined as unknown as typeof fetch);
    if (!this.fetchImpl) {
      throw new Error("Global fetch unavailable; pass fetchImpl");
    }
  }

  postCommit(body: unknown): Promise<Response> {
    return this.jsonPost("/commit", body);
  }

  postCardanoTransaction(body: unknown): Promise<Response> {
    return this.jsonPost("/cardano-transaction", body);
  }

  /**
   * Submit a signed transaction to the open Hydra head (L2).
   * Body must match Hydra `Transaction` JSON (cborHex, type, description, optional txId).
   */
  postTransaction(body: unknown): Promise<Response> {
    return this.jsonPost("/transaction", body);
  }

  getProtocolParameters(): Promise<Response> {
    return this.fetchImpl(this.config.httpUri("/protocol-parameters"));
  }

  getSnapshotUtxo(): Promise<Response> {
    return this.fetchImpl(this.config.httpUri("/snapshot/utxo"));
  }

  /** operationId: `getSeenSnapshot` */
  getSnapshotLastSeen(): Promise<Response> {
    return this.fetchImpl(this.config.httpUri("/snapshot/last-seen"));
  }

  /** operationId: `getConfirmedSnapshot` */
  getSnapshot(): Promise<Response> {
    return this.fetchImpl(this.config.httpUri("/snapshot"));
  }

  /** operationId: `sideLoadSnapshotRequest` — body is a `ConfirmedSnapshot` JSON object. */
  postSnapshot(body: unknown): Promise<Response> {
    return this.jsonPost("/snapshot", body);
  }

  /** operationId: `decommitRequest` — body is a Hydra `Transaction` JSON object. */
  postDecommit(body: unknown): Promise<Response> {
    return this.jsonPost("/decommit", body);
  }

  getHeadState(): Promise<Response> {
    return this.fetchImpl(this.config.httpUri("/head"));
  }

  /** operationId: `getHeadInitialization` */
  getHeadInitialization(): Promise<Response> {
    return this.fetchImpl(this.config.httpUri("/head-initialization"));
  }

  getPendingCommits(): Promise<Response> {
    return this.fetchImpl(this.config.httpUri("/commits"));
  }

  /** operationId: `recoverDepositRequest` — `txId` is the deposit transaction id (hex). */
  deleteCommitTx(txId: string): Promise<Response> {
    const enc = encodeURIComponent(txId);
    return this.fetchImpl(this.config.httpUri(`/commits/${enc}`), { method: "DELETE" });
  }

  private jsonPost(path: string, body: unknown): Promise<Response> {
    return this.fetchImpl(this.config.httpUri(path), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  /** No-op; provided for parity with the Dart `close()` method. */
  close(): void {
    /* fetch has no shared state to close */
  }
}
