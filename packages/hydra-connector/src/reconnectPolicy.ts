/** Backoff and behavior for ReconnectingHydraSession. */
export interface HydraReconnectPolicyInit {
  autoReconnect?: boolean;
  /** Delay before the first reconnect attempt after a drop (default 200 ms). */
  initialDelayMs?: number;
  /** Upper bound for backoff (default 3000 ms; matches Technical Assessment ~3s). */
  maxDelayMs?: number;
  /** Multiply delay after each failed attempt until maxDelayMs. Default 2. */
  backoffMultiplier?: number;
}

export class HydraReconnectPolicy {
  readonly autoReconnect: boolean;
  readonly initialDelayMs: number;
  readonly maxDelayMs: number;
  readonly backoffMultiplier: number;

  constructor(init: HydraReconnectPolicyInit = {}) {
    this.autoReconnect = init.autoReconnect ?? true;
    this.initialDelayMs = init.initialDelayMs ?? 200;
    this.maxDelayMs = init.maxDelayMs ?? 3000;
    this.backoffMultiplier = init.backoffMultiplier ?? 2;
    if (this.backoffMultiplier < 1) {
      throw new Error("backoffMultiplier must be >= 1");
    }
  }

  /** Delay used before reconnect attempt index `attempt` (0 = first retry). */
  delayForAttempt(attempt: number): number {
    let ms = this.initialDelayMs;
    for (let i = 0; i < attempt; i++) {
      const next = ms * this.backoffMultiplier;
      ms = next > this.maxDelayMs ? this.maxDelayMs : next;
    }
    return ms;
  }
}
