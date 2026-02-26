export interface AlpacaCredentials {
  keyId: string;
  secretKey: string;
}

export interface AlpacaTradingOptions extends AlpacaCredentials {
  /** Default paper trading API */
  baseUrl?: string;
}

const DEFAULT_PAPER = "https://paper-api.alpaca.markets";

function headers(c: AlpacaCredentials): Record<string, string> {
  return {
    "APCA-API-KEY-ID": c.keyId,
    "APCA-API-SECRET-KEY": c.secretKey,
    "Content-Type": "application/json",
  };
}

/** Minimal Alpaca Trading REST client (v2) */
export class AlpacaTradingClient {
  private readonly base: string;

  constructor(private readonly opts: AlpacaTradingOptions) {
    this.base = (opts.baseUrl ?? DEFAULT_PAPER).replace(/\/$/, "");
  }

  async getAccount(): Promise<unknown> {
    const r = await fetch(`${this.base}/v2/account`, { headers: headers(this.opts) });
    if (!r.ok) throw new Error(`Alpaca account ${r.status}: ${await r.text()}`);
    return r.json();
  }

  async getOrders(status?: "open" | "closed" | "all"): Promise<unknown> {
    const q = status ? `?status=${status}` : "";
    const r = await fetch(`${this.base}/v2/orders${q}`, { headers: headers(this.opts) });
    if (!r.ok) throw new Error(`Alpaca orders ${r.status}: ${await r.text()}`);
    return r.json();
  }

  async getClock(): Promise<{ timestamp: string; is_open: boolean; next_open: string; next_close: string }> {
    const r = await fetch(`${this.base}/v2/clock`, { headers: headers(this.opts) });
    if (!r.ok) throw new Error(`Alpaca clock ${r.status}: ${await r.text()}`);
    return r.json() as Promise<{
      timestamp: string;
      is_open: boolean;
      next_open: string;
      next_close: string;
    }>;
  }

  async submitOrder(body: Record<string, unknown>): Promise<unknown> {
    const r = await fetch(`${this.base}/v2/orders`, {
      method: "POST",
      headers: headers(this.opts),
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`Alpaca submit ${r.status}: ${await r.text()}`);
    return r.json();
  }

  async cancelOrder(orderId: string): Promise<void> {
    const r = await fetch(`${this.base}/v2/orders/${orderId}`, {
      method: "DELETE",
      headers: headers(this.opts),
    });
    if (!r.ok) throw new Error(`Alpaca cancel ${r.status}: ${await r.text()}`);
  }
}
