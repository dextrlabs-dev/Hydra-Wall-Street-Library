/** Connection settings for a single hydra-node client API (`--api-port`). */
export interface HydraClientConfigInit {
  host: string;
  port?: number;
  /** Use wss/https when true */
  secure?: boolean;
  /** Maps to query `history=yes|no`; omit to use server default */
  history?: boolean;
  /** Maps to query `snapshot-utxo=yes|no`; omit to use server default */
  snapshotUtxo?: boolean;
  /** Maps to query `address=...` for filtered server outputs */
  addressFilter?: string;
}

export class HydraClientConfig {
  readonly host: string;
  readonly port: number;
  readonly secure: boolean;
  readonly history?: boolean;
  readonly snapshotUtxo?: boolean;
  readonly addressFilter?: string;

  constructor(init: HydraClientConfigInit) {
    if (!init.host || !init.host.trim()) {
      throw new Error("hydra-node host is empty");
    }
    this.host = init.host;
    this.port = init.port ?? 4001;
    this.secure = init.secure ?? false;
    this.history = init.history;
    this.snapshotUtxo = init.snapshotUtxo;
    this.addressFilter = init.addressFilter;
  }

  /** Parses typical UI text fields (optional `ws://` / `http://` URL, host:port, [ipv6]:port). */
  static fromUiFields(
    hostField: string,
    portField: string,
    options: { history?: boolean; snapshotUtxo?: boolean; addressFilter?: string } = {},
  ): HydraClientConfig {
    let host = hostField.trim();
    let port = parseIntStrict(portField.trim());
    let secure = false;

    if (!host) throw new Error("hydra-node host is empty");

    if (host.includes("://")) {
      const url = new URL(host);
      secure = url.protocol === "wss:" || url.protocol === "https:";
      if (!url.hostname) throw new Error(`Could not parse host from URL: ${hostField}`);
      host = url.hostname;
      if (url.port) port = parseIntStrict(url.port);
      if (port === undefined) port = parseIntStrict(portField.trim()) ?? 4001;
    } else {
      if (port === undefined) port = parseIntStrict(portField.trim()) ?? 4001;
      if (host.startsWith("[")) {
        const idx = host.indexOf("]:");
        if (idx !== -1 && idx < host.length - 2) {
          const p = parseIntStrict(host.substring(idx + 2));
          if (p !== undefined) {
            port = p;
            host = host.substring(0, idx + 1);
          }
        }
      } else {
        const lastColon = host.lastIndexOf(":");
        if (lastColon > 0) {
          const tail = host.substring(lastColon + 1);
          if (/^\d{1,5}$/.test(tail)) {
            const p = parseIntStrict(tail);
            if (p !== undefined && p <= 65535) {
              port = p;
              host = host.substring(0, lastColon);
            }
          }
        }
      }
    }

    if (!host) throw new Error("hydra-node host is empty after parsing");

    return new HydraClientConfig({
      host,
      port: port ?? 4001,
      secure,
      history: options.history,
      snapshotUtxo: options.snapshotUtxo,
      addressFilter: options.addressFilter,
    });
  }

  webSocketUri(): URL {
    const url = new URL(`${this.secure ? "wss" : "ws"}://${formatHost(this.host)}:${this.port}/`);
    this.appendQuery(url);
    return url;
  }

  httpUri(path: string, query?: Record<string, string>): URL {
    const p = path.startsWith("/") ? path : `/${path}`;
    const url = new URL(`${this.secure ? "https" : "http"}://${formatHost(this.host)}:${this.port}${p}`);
    if (query) {
      for (const [k, v] of Object.entries(query)) url.searchParams.append(k, v);
    }
    return url;
  }

  private appendQuery(url: URL): void {
    if (this.history !== undefined) url.searchParams.append("history", this.history ? "yes" : "no");
    if (this.snapshotUtxo !== undefined)
      url.searchParams.append("snapshot-utxo", this.snapshotUtxo ? "yes" : "no");
    if (this.addressFilter && this.addressFilter.length) {
      url.searchParams.append("address", this.addressFilter);
    }
  }
}

function parseIntStrict(value: string): number | undefined {
  if (!value || !/^-?\d+$/.test(value)) return undefined;
  const n = Number(value);
  return Number.isSafeInteger(n) ? n : undefined;
}

function formatHost(host: string): string {
  if (host.includes(":") && !host.startsWith("[")) return `[${host}]`;
  return host;
}
