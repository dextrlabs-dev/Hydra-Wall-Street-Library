# Operations Runbook

Operational reference for running `hydra-wall-street-library` at the `v1.0.0` cut. Covers start/stop, health checks, common failure modes, key rotation, and recovery. Use [SECURITY.md](../SECURITY.md) for the credential-handling policy and [THREAT_MODEL.md](./THREAT_MODEL.md) for the trust-boundary picture.

## Processes and ports

| Process | Source | Default port | Health |
|---|---|---|---|
| `engine-server` | [apps/engine-server](../apps/engine-server) | `8080` (env `ENGINE_PORT`) | `GET /health` → `{ "ok": true }` |
| `anchoring-server` | [apps/anchoring-server](../apps/anchoring-server) | `8090` (env `ANCHOR_PORT`) | `GET /health` → `{ "ok": true }` |
| `web` (operator UI) | [apps/web](../apps/web) | `5173` (Vite dev) / `8081` (Docker nginx) | served if `index.html` returns 200 |
| `hydra-ws-mcp` | [apps/hydra-ws-mcp](../apps/hydra-ws-mcp) | stdio (no port) | LLM client lists tools |

## Start / stop

### Local dev (npm workspaces)

```bash
# from repo root
npm install
npm run build

# engine + anchoring + mock Hydra anchor
npm run engine               # blocks; Ctrl+C to stop

# in another terminal:
npm run demo                 # Vite dev server for the React UI
```

The engine listens on `0.0.0.0:8080` by default. **Bind it to `127.0.0.1` in production deployments** unless a reverse proxy is in front of it — see [THREAT_MODEL.md](./THREAT_MODEL.md) ("S — Spoofing" on `engine-server`).

### Docker

```bash
docker compose up --build
# engine-server -> http://localhost:8080
# web           -> http://localhost:8081
docker compose down
```

The `hydra-node` block in `docker-compose.yml` is commented out; uncomment when attaching a real Head.

### MCP server (Cursor / Claude Desktop)

The MCP server is launched by the LLM client per the config in [docs/mcp/SETUP.md](./mcp/SETUP.md). Restarting it means restarting the LLM client; there is no separate `systemctl`-style supervisor.

## Health checks

```bash
curl -fsS http://localhost:8080/health
curl -fsS http://localhost:8090/health
curl -fsS http://localhost:8080/markets        # lists loaded market configs
curl -fsS http://localhost:8080/metrics        # accepted/rejected/filled counters + head hash
curl -fsS http://localhost:8080/anchors        # recent anchor receipts (if --anchor flag set)
```

A `2xx` response with the head hash visible in `/metrics` means the engine is accepting orders and the hash chain is advancing.

## Common failures

### Alpaca returns `401 Unauthorized`

**Symptom**: `node examples/alpaca-account.mjs` or the adapter prints `401`.

**Diagnosis**: `.env` not loaded, or keys revoked.

**Fix**:
1. Confirm `.env` exists at the path the process was started from.
2. Re-run `./scripts/setup-env.sh` and paste fresh keys when prompted.
3. If the keys were exposed (screenshot, shell history, `~/.cursor/mcp.json` literal), follow the rotation steps below.

### Hydra connector loops on reconnect

**Symptom**: `apps/anchoring-server` logs `reconnecting in <N>ms` repeatedly.

**Diagnosis**: Hydra Head URL unreachable, or wrong port.

**Fix**:
1. Check the `HYDRA_HOST`, `HYDRA_PORT`, `HYDRA_SECURE` env vars in `.env`.
2. Run `node examples/hydra-connect.mjs` to confirm a one-shot connection.
3. The connector backoff is implemented in [packages/hydra-connector/src/reconnectPolicy.ts](../packages/hydra-connector/src/reconnectPolicy.ts) — capped exponential backoff with jitter. No tuning needed unless the head is intentionally flaky.

### Engine `/health` 200 but `/metrics` head hash never changes

**Symptom**: Orders submitted but the head hash stays constant.

**Diagnosis**: Orders are being rejected. Check `rejected` counter in `/metrics`.

**Fix**: Inspect the engine's stdout for `rejected` events with the reason field (e.g. `invalid quantity or price`, `unknown order`). Replay-driven debugging is supported — the canonical input JSON is hashed into every entry, so reproducing a rejected order means resubmitting the same canonical-JSON payload.

### Replay throws `ReplayMismatchError`

**Symptom**: `replay()` of a persisted log throws at step N.

**Diagnosis**: Either the log file was edited, or it was produced by a code version that differs from the running engine.

**Fix**:
1. Verify the log file hasn't been modified since it was written.
2. Match the engine version (`packages/core/package.json` → `version`) to the version that produced the log. The hash chain is bound to the engine's `canonicalJson` shape.
3. If both match and replay still fails, file a `sev:high` issue with the log file + engine version — this is a regression in the canonicalization layer.

### Anchor receipts are missing

**Symptom**: `GET /anchors` returns `[]`.

**Diagnosis**: engine started without `--anchor`, or the anchor transport is failing.

**Fix**: Restart with `npm run engine` (which already passes `--anchor`). For a custom invocation, ensure `--anchor` is on the command line. The default transport is the [`MockHydraAnchorTransport`](../packages/anchoring/src/mock.ts); replace it with a real `HydraSigner` in deployments that want on-chain anchoring.

## Key rotation

Per [SECURITY.md](../SECURITY.md):

1. Open [Alpaca dashboard](https://app.alpaca.markets/) → **Paper Trading** → **API Keys**.
2. **Revoke** the exposed pair, **generate** a new one.
3. Run `./scripts/setup-env.sh` and paste the new pair when prompted (writes `.env` with `0600`).
4. Restart every process that reads the file: `engine-server`, anchoring-server, any running examples, MCP host.
5. If keys were ever in `~/.cursor/mcp.json` (or any other MCP client config) as literals, edit the file to use env-var references instead.

The Hydra signer key is **not** in this repo. Rotation of the signer key is the responsibility of whoever supplies the `HydraSigner` implementation to the connector.

## Hydra Head graceful close

When detaching from a Head:

1. Stop `engine-server` (`Ctrl+C` or `docker compose stop engine-server`). This drains in-flight WS frames.
2. Stop `anchoring-server`. The last anchor receipt is durable in whatever store the operator wired into the `Anchorer`; the default mock transport keeps it in memory.
3. Call the Hydra Head's own close command from outside this library.

The library does **not** initiate Head close. That is operator-controlled.

## Backup and recovery

| Asset | Location | Recovery |
|---|---|---|
| Event log | In-memory `EventLog` by default; operators should serialize `log.toArray()` to disk on shutdown | Reload by replaying via `replay(entries)` ([packages/core/src/replay.ts](../packages/core/src/replay.ts)) |
| Market configs | `markets/*.yaml`, `markets/*.json` | Re-read on next `engine-server` start |
| Anchor receipts | `anchorer.list()` accessible via `/anchors` | Persist alongside the event log; not built-in for v1.0.0 |
| `.env` | Operator workstation, `0600` | Re-create via `scripts/setup-env.sh` |

Operators running with persisted state SHOULD add a periodic snapshot of `log.toArray()` to disk. The library does not ship a built-in persistence layer for v1.0.0 (acceptable residual; see [THREAT_MODEL.md](./THREAT_MODEL.md) follow-ups).

## Escalation

- **High-severity**: credential exposure, replay-chain divergence, repeated `ReplayMismatchError`. Open a private security advisory (see [SECURITY.md](../SECURITY.md)).
- **Medium**: integrator-blocking bugs that aren't security-relevant. File a GitHub issue with `sev:medium`.
- **Low**: docs / ergonomics. Batched into the next maintenance commit.

The full incident-response intake lives in [BETA_FEEDBACK.md](./BETA_FEEDBACK.md) under "How issues are tracked going forward".
