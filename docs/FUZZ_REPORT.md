# Stability / Fuzz Report

This is the recorded output of the v1.0.0 stability run against `@hydra-ws/core`'s matching engine + event log + replay pipeline.

## Test under load

[`packages/core/test/matching.fuzz.test.mjs`](../packages/core/test/matching.fuzz.test.mjs) is a property-style stability harness over [`MatchingEngine`](../packages/core/src/engine.ts), [`EventLog`](../packages/core/src/eventLog.ts), and [`replay()`](../packages/core/src/replay.ts). It:

- Generates random order operations using a seeded Mulberry32 PRNG (so any failure is reproducible by re-running with `FUZZ_SEED=<hex>`).
- Mixes ~70% limit / ~20% IOC / ~10% cancel operations across two symbols (`AAPL`, `BTCUSDT`).
- Submits each through `withLog(engine, log)` so every step appends to the hash-chained event log.
- After the run, replays the full log against a fresh engine and asserts the recomputed final hash matches.

### Invariants asserted per step

| # | Invariant | Failure surface |
|---|---|---|
| 1 | Hash chain advances on every successful submit (`log.headHash` strictly changes) | event-log replay |
| 2 | Book never crosses (`bestBid < bestAsk`) on every emitted `book` snapshot | matching correctness |
| 3 | Bid levels strictly descending, ask levels strictly ascending in every snapshot | book-level ordering |
| 4 | Cancel of a resting order emits exactly one `cancelled` event, or one `rejected` if unknown — never both, never zero | cancel handling |
| 5 | Taker fill quantity never exceeds the submitted taker quantity | quantity conservation |
| 6 | `replay()` of the recorded log reproduces the recorded final head hash and step count | full-cycle determinism |

## Recorded runs

All runs were executed locally on the operator's workstation against the `dist/` build produced by `npm run build -w @hydra-ws/core` on the v1.0.0 cut. No invariant violations were observed.

### Default run — 10,000 ops, seed `0xc0ffee`

```json
{
  "seed": "0xc0ffee",
  "iterations": 10000,
  "elapsedMs": 1446,
  "opsPerSec": 6916,
  "counts": {
    "limits": 7015,
    "iocs": 1984,
    "cancels": 1001,
    "fills": 6344,
    "rejects": 2093,
    "cancelEvents": 174
  },
  "finalHash": "0d69aeb23b27a57505d10563b6722903e266f933c100b8931fc447880a824733",
  "replaySteps": 10000
}
```

### Multi-seed sweep (10,000 ops each)

Four additional seeds confirm the invariants hold across distinct order distributions:

| Seed | elapsedMs | opsPerSec | finalHash |
|---|---|---|---|
| `0x1` | 1249 | 8006 | `151933f8346f6e2dd5f47dd33f78ff5c5f46162bda9b1f7e4bfdb02a999f4523` |
| `0x42` | 1424 | 7021 | `b74ed3b2a6aa60e652467b994d6dbcc136ed6a5c8a3d433406d570d22c8bc19d` |
| `0xdeadbeef` | 1396 | 7163 | `54aa881b124cb46093e7860c80d6f9aa511c1415f68a3e19ba83e61429e65ef7` |
| `0xfeedface` | 1437 | 6960 | `3616f8497b30635e68250328e047dee1a91b866e3bda6c8a2d107cb7131a3eb4` |

### Long run — 50,000 ops, seed `0xc0ffee`

```json
{
  "iterations": 50000,
  "elapsedMs": 16220,
  "opsPerSec": ~3083,
  "counts": {
    "limits": 35107,
    "iocs": 9956,
    "cancels": 4937,
    "fills": 32032,
    "rejects": 10658,
    "cancelEvents": 778
  },
  "finalHash": "cdffec6ee4dd4ed2c36af21be88c9db0040909ed329a460751a2cf551000dcdd",
  "replaySteps": 50000
}
```

Throughput drops on the long run because the per-symbol book grows large enough that the linear `bidPrices` / `askPrices` arrays in [`engine.ts`](../packages/core/src/engine.ts) shoulder the cost. This is documented in [THREAT_MODEL.md](./THREAT_MODEL.md) ("DoS — order flood saturates the engine") as a known prototype characteristic: operators front the engine with a reverse-proxy rate limit.

## How to reproduce

```bash
npm install --no-audit --fund=false
npm run build -w @hydra-ws/core
# Default 10k iteration run
node --test packages/core/test/matching.fuzz.test.mjs
# Override seed and iteration count
FUZZ_SEED=0xdeadbeef FUZZ_ITERATIONS=50000 node --test packages/core/test/matching.fuzz.test.mjs
```

A failure prints the seed in the assertion message so the run can be replayed deterministically.

## CI integration

The fuzz test is wired into the workspace `npm test` script so every push to `main` (and every PR) runs ≥10,000 operations against the engine via [`.github/workflows/ci.yml`](../.github/workflows/ci.yml). Failure of any invariant blocks the workflow.

## Out of scope for v1.0.0

- **Multi-symbol cancel-storm benchmarks**. The harness exercises cancels but does not target a single book with adversarial cancel/limit interleavings.
- **Concurrent submission**. `MatchingEngine.submit` is single-threaded by design; the harness submits sequentially. Concurrent access is an integrator responsibility.
- **Adapter-side fuzzing**. The Alpaca adapter and Hydra connector are exercised by their own unit suites (`packages/hydra-connector/test/`) but not by this property test.
