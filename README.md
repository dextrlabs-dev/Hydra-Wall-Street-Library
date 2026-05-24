# Hydra Wall Street Library

[![CI](https://github.com/dextrlabs-dev/Hydra-Wall-Street-Library/actions/workflows/ci.yml/badge.svg)](https://github.com/dextrlabs-dev/Hydra-Wall-Street-Library/actions/workflows/ci.yml)
[![Docs](https://github.com/dextrlabs-dev/Hydra-Wall-Street-Library/actions/workflows/docs.yml/badge.svg)](https://dextrlabs-dev.github.io/Hydra-Wall-Street-Library/)
[![Release](https://img.shields.io/github/v/release/dextrlabs-dev/Hydra-Wall-Street-Library?include_prereleases&display_name=tag)](https://github.com/dextrlabs-dev/Hydra-Wall-Street-Library/releases)

## v1.0.0 evidence package

| Resource | URL |
|---|---|
| Documentation site (GitHub Pages) | [dextrlabs-dev.github.io/Hydra-Wall-Street-Library](https://dextrlabs-dev.github.io/Hydra-Wall-Street-Library/) |
| Beta Feedback Resolution | [docs/BETA_FEEDBACK.md](./docs/BETA_FEEDBACK.md) |
| Threat Model | [docs/THREAT_MODEL.md](./docs/THREAT_MODEL.md) |
| Fuzz / Stability Report | [docs/FUZZ_REPORT.md](./docs/FUZZ_REPORT.md) |
| Operations Runbook | [docs/RUNBOOK.md](./docs/RUNBOOK.md) |
| Releases | [GitHub Releases](https://github.com/dextrlabs-dev/Hydra-Wall-Street-Library/releases) |

Deterministic financial execution simulation:

- price-time matching engine (limit / IOC / cancel) with hash-chained event log and replay,
- normalized market data path (synthetic + Alpaca IEX adapters),
- YAML/JSON market configuration (tick / lot / hours / halts / holidays),
- Hydra-anchored state hashes with verification endpoint,
- engine-server (Fastify + WebSocket), React UI, and Python SDK with embedded backtest matcher,
- reproducible Docker images and a GitHub Actions CI pipeline.

**Primary project path on this machine (large disk):**

`/mnt/volume_blr1_1777391751889/Hydra-Wall-Street-Library`

Keep builds and `node_modules` on that volume if root (`/`) is full.

## Workspace layout

| Path | Purpose |
| --- | --- |
| `packages/core` | `@hydra-ws/core` - engine, event log, replay, MarketEvent, SyntheticFeed |
| `packages/market-config` | `@hydra-ws/market-config` - YAML/JSON loader + `applyTo(engine, cfg)` guard |
| `packages/adapters-alpaca` | `@hydra-ws/adapters-alpaca` - Trading REST + Market Data WS + normalizer |
| `packages/hydra-connector` | `@hydra-ws/hydra-connector` - reconnecting WS + HTTP + seq sync + head facade |
| `packages/anchoring` | `@hydra-ws/anchoring` - `Anchorer` that submits state-hash `NewTx` and indexes `TxValid` |
| `packages/sdk-typescript` | `@hydra-ws/sdk` - façade tying core / Alpaca / Hydra together |
| `packages/sdk-python` | `hydra_ws_sdk` - `EngineClient` + pure-Python `LocalMatchingEngine` for backtests |
| `apps/engine-server` | Fastify + `ws` engine server (`/orders`, `/book`, `/metrics`, `/stream/:symbol`) |
| `apps/anchoring-server` | Fastify anchoring server (`/anchor`, `/verify/:hash`, `/metrics`) |
| `apps/web` | Vite + React UI: order entry, L2 book, trade tape, P&L, metrics |
| `apps/hydra-ws-mcp` | stdio MCP server: `engine-server` REST + optional Alpaca REST ([`docs/mcp/SETUP.md`](./docs/mcp/SETUP.md)) |
| `markets/` | Sample YAML/JSON market configurations (AAPL, BTCUSDT) |
| `examples/` | `scenario-trade.mjs`, `anchor-once.mjs`, `alpaca-account.mjs`, `hydra-connect.mjs`, `btc-paper-hft-sim.mjs` |
| `docs/` | Deep dive: [`HYDRA_WALL_STREET_LIBRARY_DEEP_DIVE.md`](./docs/HYDRA_WALL_STREET_LIBRARY_DEEP_DIVE.md) |

## Prerequisites

- Node.js **20+**
- Python **3.11+** (for the Python SDK)
- Docker (optional, for `docker compose up`)
- Optional: **Alpaca paper** API keys ([dashboard](https://app.alpaca.markets/)) - see `.env.example`

## Quick start

```bash
export TMPDIR=/mnt/volume_blr1_1777391751889/tmp   # if / is full
cd /mnt/volume_blr1_1777391751889/Hydra-Wall-Street-Library

./scripts/setup-env.sh             # interactive .env writer (chmod 600 + verifies Alpaca)
npm install
npm run build
npm test                           # connector + market-config tests

node examples/scenario-trade.mjs   # place / partial / cancel / replay (hash check)
node examples/anchor-once.mjs      # mock Hydra anchor + verify

# Run engine-server with both market configs and mock anchoring
npm run engine                     # listens on http://localhost:8080

# Run React UI in another terminal
npm run demo                       # http://localhost:5173
```

If you previously shared your Alpaca paper key/secret in a screenshot, see
[`SECURITY.md`](./SECURITY.md) and rotate them first.

## MCP (Cursor / VS Code)

- **Official Alpaca MCP** (`uvx alpaca-mcp-server`): broad Trading API tools; set `ALPACA_API_KEY` / `ALPACA_SECRET_KEY` in the client config.
- **This repo (`hydra-ws-mcp`)**: tools for the **local** matching engine plus the same Alpaca REST surface as `@hydra-ws/adapters-alpaca` when `APCA_*` (or `ALPACA_*`) env vars are set.

Full steps, Cursor snippets, and a copy-paste example live in [`docs/mcp/SETUP.md`](./docs/mcp/SETUP.md).

## Docker

```bash
docker compose up --build
# engine-server  -> http://localhost:8080
# web (nginx)    -> http://localhost:8081
```

A commented `hydra-node` block is included for attaching a real head later.

## Python SDK

```bash
pip install -e packages/sdk-python[dev]
pytest packages/sdk-python
```

```python
from hydra_ws_sdk import EngineClient, LimitOrIoc

with EngineClient("http://localhost:8080") as c:
    print(c.list_markets())
    c.submit_order(LimitOrIoc(
        kind="limit", id="o-1", symbol="AAPL",
        side="buy", priceTicks=10000, quantity=10,
    ))
```

For backtests, use the embedded matcher (`LocalMatchingEngine`, `EventLog`, `replay`)
which mirrors the TypeScript core's event names and hash chain.

## Smoke tests (live services)

With `.env` populated:

```bash
node examples/alpaca-account.mjs   # GET /v2/account + /v2/orders + 5s market data WS
node examples/hydra-connect.mjs    # connect to hydra-node (HYDRA_HOST/PORT/SECURE/HISTORY)
```

## Optional: regenerate local run logs

Sample transcripts and a UI screenshot under [`docs/development/`](docs/development/)
were produced by scripts in [`docs/development/scripts/`](docs/development/scripts/).
You can run them again after `npm run build`:

```bash
bash docs/development/scripts/capture-scenario-trade.sh
bash docs/development/scripts/capture-data-path.sh
bash docs/development/scripts/capture-market-config.sh
bash docs/development/scripts/capture-anchor.sh
bash docs/development/scripts/capture-integration.sh
bash docs/development/scripts/capture-ci-local.sh
```

## MIT License

See `LICENSE`.
