# Hydra Wall Street Library

Privacy-friendly, deterministic financial execution simulation:

- price-time matching engine (limit / IOC / cancel) with **hash-chained event log** and **replay**,
- normalized market data path (synthetic + Alpaca IEX adapters),
- YAML/JSON market configuration (tick / lot / hours / halts / holidays),
- **Hydra-anchored state hashes** with verification endpoint,
- engine-server (Fastify + WebSocket), React operator UI, and Python SDK with embedded backtest matcher,
- reproducible Docker images and a GitHub Actions CI pipeline.

> **Prototype.** Simulation-only matching — no real custody, no real settlement. See [Threat Model](THREAT_MODEL.md).

## Where to start

| You are… | Start here |
|---|---|
| Operator running the stack | [Runbook](RUNBOOK.md) |
| Integrator embedding the SDK | [Deep Dive](HYDRA_WALL_STREET_LIBRARY_DEEP_DIVE.md) |
| Security reviewer | [Threat Model](THREAT_MODEL.md) + [SECURITY.md](https://github.com/dextrlabs-dev/Hydra-Wall-Street-Library/blob/main/SECURITY.md) |
| LLM client developer | [MCP Setup](mcp/SETUP.md) |
| Reviewing v1.0.0 milestone | [Beta Feedback](BETA_FEEDBACK.md) + [Fuzz Report](FUZZ_REPORT.md) |

## Quick start

```bash
git clone https://github.com/dextrlabs-dev/Hydra-Wall-Street-Library
cd Hydra-Wall-Street-Library
./scripts/setup-env.sh             # interactive .env writer
npm install
npm run build
npm test                           # connector + market-config + matching-engine fuzz
node examples/scenario-trade.mjs   # place / partial / cancel / replay
npm run engine                     # http://localhost:8080
```

See [Runbook](RUNBOOK.md) for full operational guidance and [Deep Dive](HYDRA_WALL_STREET_LIBRARY_DEEP_DIVE.md) for the architecture walkthrough.

## v1.0.0 evidence package

- [Beta Feedback](BETA_FEEDBACK.md) — four triaged beta-era issues, all resolved
- [Threat Model](THREAT_MODEL.md) — STRIDE across five surfaces, plus cross-cutting controls
- [Fuzz Report](FUZZ_REPORT.md) — 50,000-op property test with multi-seed sweep
- [Runbook](RUNBOOK.md) — operations + recovery + key rotation
- [MCP Setup](mcp/SETUP.md) — Cursor / Claude Desktop integration

## License

MIT — see [LICENSE](https://github.com/dextrlabs-dev/Hydra-Wall-Street-Library/blob/main/LICENSE).
