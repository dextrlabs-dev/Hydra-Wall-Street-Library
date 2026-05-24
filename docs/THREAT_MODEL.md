# Threat Model

This document is the STRIDE-style threat model for `hydra-wall-street-library` at the `v1.0.0` cut. It complements [SECURITY.md](../SECURITY.md), which states the project's custody posture and credential-handling policy. The system is a **deterministic financial-execution simulator**: no real assets are custodied, and the matching engine is a simulation surface only.

## Trust boundaries

```
+------------------+  stdio   +------------------+  REST/WS   +-------------------+
| LLM client       | -------> | hydra-ws-mcp     | ---------> | engine-server     |
| (Cursor, Claude  |          | (apps/           |  http(s)   | (apps/            |
|  Desktop)        |          |  hydra-ws-mcp)   |            |  engine-server)   |
+------------------+          +------------------+            +-------------------+
                                                                        |
                                                                        | event log
                                                                        v
+------------------+  HTTPS   +------------------+  WSS       +-------------------+
| Alpaca IEX +     | <------- | adapters-alpaca  |            | anchoring-server  |
| Paper Trading    |          | (packages/...)   |            | (apps/            |
+------------------+          +------------------+            |  anchoring-server)|
                                                              +-------------------+
                                                                        |
                                                                        | WSS
                                                                        v
                                                              +-------------------+
                                                              | hydra-connector   |
                                                              | (packages/...)    |
                                                              +-------------------+
                                                                        |
                                                                        | WSS
                                                                        v
                                                              +-------------------+
                                                              | Hydra Head        |
                                                              | (external, signed |
                                                              |  by external      |
                                                              |  HydraSigner)     |
                                                              +-------------------+
```

Inside the local-process boundary, components are trusted relative to each other. External boundaries — the LLM stdio channel, the Alpaca HTTPS hop, and the Hydra Head WSS — are the focus of this model.

## STRIDE per surface

Severity scale: **L** = low (acceptable residual risk for a prototype), **M** = medium (mitigation present, follow-up tracked), **H** = high (mitigation must hold; documented in [RUNBOOK.md](./RUNBOOK.md)).

### 1. `engine-server` REST + WS — order intake, book snapshots

| Category | Threat | Mitigation | Residual |
|---|---|---|---|
| **S**poofing | Attacker submits orders as another client | Bind engine-server to `127.0.0.1` by default; no built-in auth (prototype). For exposed deployments, front with reverse-proxy mTLS. See [RUNBOOK.md](./RUNBOOK.md). | M |
| **T**ampering | Order payload modified in flight | TLS at the proxy layer; matching engine treats every order as canonical JSON before hashing into the event log ([`canonicalJson` in `packages/core/src/eventLog.ts`](../packages/core/src/eventLog.ts)) so any post-hoc tampering breaks `replay()`. | L |
| **R**epudiation | Client denies submitting an order | Hash-chained event log (SHA-256 over `prevHash \| input \| outputs`) makes order acceptance non-repudiable per [`EventLog.append`](../packages/core/src/eventLog.ts). | L |
| **I**nfo disclosure | Order book leaked to unauthorized observer | All book state is simulation; no PII. Acceptable. | L |
| **D**oS | Order flood saturates the engine | Single-process Fastify; no built-in rate limit. Operator-side reverse proxy SHOULD apply rate limits. Documented in [RUNBOOK.md](./RUNBOOK.md). | M |
| **E**oP | Malformed order escalates privileges | Engine has no privileges beyond an in-memory book; payload schema validated at API ingress. | L |

### 2. `anchoring-server` REST — hash-chain anchor submission

| Category | Threat | Mitigation | Residual |
|---|---|---|---|
| S | Forged anchor request | Same local-bind posture as engine-server; anchor payload includes head hash from the event log. | M |
| T | Anchor payload swapped after submission | Hashes are bound to the event-log chain; a swap breaks `replay()` invariants. | L |
| R | Operator denies anchoring a state | Anchor receipts include the engine head-hash + timestamp; replay reproduces. | L |
| I | Anchor history leaked | Simulation data only. | L |
| D | Anchor flood | Operator-side rate-limit at proxy. | M |
| E | Anchor side-effects beyond simulation | Anchorer interface is mockable ([`packages/anchoring/src/mock.ts`](../packages/anchoring/src/mock.ts)); real Hydra writes go through external `HydraSigner`. | L |

### 3. `hydra-connector` WebSocket — Hydra Head signer + state pump

| Category | Threat | Mitigation | Residual |
|---|---|---|---|
| S | Impostor Hydra Head | Connection URL is operator-supplied; integrators are expected to use WSS + pinned hostname. | M |
| T | Tampered Hydra messages | Hydra Head's own message format + signatures govern; connector validates message shapes via [`packages/hydra-connector/src/parser.ts`](../packages/hydra-connector/src/parser.ts). | L |
| R | Disputed head transitions | State is sequenced; `seqSync.ts` enforces monotonic state advancement and reconnect resumes from last known seq. | L |
| I | Head state leak | Same simulation posture. | L |
| D | Reconnect storm | [`reconnectPolicy.ts`](../packages/hydra-connector/src/reconnectPolicy.ts) implements exponential backoff with jitter; covered by `reconnectPolicy.test.mjs`. | L |
| E | Signer privilege escalation | The `HydraSigner` interface is **externally supplied**; no key material lives in this repo. SDK consumers own key custody. Documented in [SECURITY.md](../SECURITY.md). | L |

### 4. `adapters-alpaca` outbound HTTPS — IEX market data + paper trading

| Category | Threat | Mitigation | Residual |
|---|---|---|---|
| S | Spoofed Alpaca endpoint | Default endpoint is `https://paper-api.alpaca.markets`; switching to live requires explicit env override. TLS pinning is delegated to OS trust store. | M |
| T | Tampered market-data frames | TLS in transit; frames are parsed into typed shapes before reaching the engine. | L |
| R | Alpaca side denies a trade was sent | Alpaca's own audit log is authoritative; local event log also captures the request canonical-JSON. | L |
| I | API key leakage via screenshots / shell history | `scripts/setup-env.sh` writes `.env` with `0600`; key never echoes; revocation playbook in [SECURITY.md](../SECURITY.md). Tracked under [BETA-001](./BETA_FEEDBACK.md). | M |
| D | Rate-limited by Alpaca | Adapter respects HTTP 429 backoff; the library does not throttle on the client side beyond that. | L |
| E | Adapter escalation | Adapter is paper-trading by default; live mode is gated behind explicit env. | M |

### 5. `hydra-ws-mcp` stdio — LLM-client controlled tools

| Category | Threat | Mitigation | Residual |
|---|---|---|---|
| S | Malicious MCP host impersonates the user | MCP is run as a subprocess of the LLM client; trust boundary is the LLM client itself. Documented in [docs/mcp/SETUP.md](./mcp/SETUP.md). | M |
| T | Tool calls altered before reaching engine | All tool calls re-serialize into canonical JSON before invoking the engine; the engine's event log hashes the input. | L |
| R | User denies issuing an action from the LLM | Event log records every input from the MCP path identically to direct API calls. | L |
| I | Sensitive info exfiltrated via prompt injection | MCP server only exposes engine/anchor/feed operations. Alpaca credentials are read from `.env` at process start, not exposed through any tool. | M |
| D | Tool flood from a runaway LLM | Engine-side limits apply (same as direct API). | M |
| E | Tool unexpectedly performs live trading | MCP defaults inherit `adapters-alpaca` paper mode; live mode requires explicit env override (same gate as the adapter). | M |

## Cross-cutting controls

- **Hash-chained event log**: every order intake — regardless of channel (HTTP, MCP, scenario script) — flows through `EventLog.append`. The chain is replayable via [`replay()`](../packages/core/src/replay.ts), which throws `ReplayMismatchError` on any divergence. This is the system's primary integrity control.
- **Canonical JSON**: `canonicalJson()` sorts keys recursively before hashing, so bit-identical replay is independent of object construction order.
- **Externalized key custody**: `HydraSigner` is an interface, not an implementation. Real key material lives outside this repo. `.env` (Alpaca paper keys) is gitignored and `0600`.
- **Default paper trading**: live trading is gated by explicit env (`APCA_API_BASE_URL` override). Documented in [SECURITY.md](../SECURITY.md).

## Out of scope

- Real asset custody. The matching engine is a deterministic simulator. There is no on-chain settlement of trades.
- Multi-tenant isolation inside a single `engine-server` process. Deployments are expected to be single-operator; multi-tenant operation needs per-tenant book isolation that this prototype does not provide.
- Side-channel resistance (timing/cache attacks against the matching engine). Out of scope for a simulation library.
- Adversarial Hydra Head models. The connector assumes the head implementation itself is honest; verifying the head is the responsibility of the operator's deployment topology.

## Follow-ups

| Item | Tracked in | Disposition |
|---|---|---|
| Built-in rate limiting on `engine-server` | Backlog | Acceptable residual for a prototype; operators deploy behind reverse-proxy rate limits |
| First-class auth (mTLS, JWT) on REST/WS endpoints | Backlog | Same — push to proxy layer for v1 |
| Per-channel quotas for the MCP path | Backlog | Reuse engine-side limits once they land |
| Stability test coverage of cancel-storm scenarios | [FUZZ_REPORT.md](./FUZZ_REPORT.md) | Covered by v1.0.0 fuzz run |

Every "M" residual above is acceptable for the `v1.0.0` prototype cut. Promoting to "L" requires the matching follow-up in the backlog.
