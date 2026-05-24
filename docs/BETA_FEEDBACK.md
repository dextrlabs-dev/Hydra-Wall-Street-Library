# Public Beta Feedback Resolution

This document tracks feedback raised during the public beta of `hydra-wall-street-library`. Each issue carries an ID, severity, status, root cause, and the commit(s) that closed it. The four entries below cover the items that drove visible commits on `main` between project start and the v1.0.0 cut.

The pattern matches a standard issue tracker: scan, triage, resolve (or defer with rationale), record the commit SHA.

## BETA-001 — Alpaca API key handling is too easy to leak

| Field | Value |
|---|---|
| ID | BETA-001 |
| Reported via | Internal beta dogfood; early external tester pasted keys into a shared shell |
| Severity | High (credential exposure) |
| Status | Resolved |
| Resolution commit | [`eae0024`](https://github.com/dextrlabs-dev/Hydra-Wall-Street-Library/commit/eae0024) |
| Related docs | [SECURITY.md](../SECURITY.md), [scripts/setup-env.sh](../scripts/setup-env.sh) |

**Symptom.** Beta testers reported risk of Alpaca keys showing up in screenshots, shell history, and `~/.cursor/mcp.json` while wiring up the MCP integration. There was no canonical "write a `.env` safely" path.

**Root cause.** Free-form `.env` writing left credentials in tester shell history and risked `chmod 644` files in their home directory.

**Resolution.** Added `scripts/setup-env.sh` that prompts for credentials and writes `.env` with `0600`. Documented the leak-response playbook in [SECURITY.md](../SECURITY.md) ("If your Alpaca paper key has been visible in a screenshot…"). `.env` is gitignored at the repo root.

## BETA-002 — Specification PDFs duplicated under subdirectories

| Field | Value |
|---|---|
| ID | BETA-002 |
| Reported via | Documentation review |
| Severity | Low (docs hygiene) |
| Status | Resolved |
| Resolution commit | [`cb39204`](https://github.com/dextrlabs-dev/Hydra-Wall-Street-Library/commit/cb39204) |

**Symptom.** The five specification PDFs (Requirements, Architecture, Feasibility, Landscape Review, Technical Assessment) appeared in multiple locations across `docs/` and the repo root, producing stale duplicates whenever a PDF was updated.

**Root cause.** Initial uploads dropped each PDF wherever felt convenient, with no single source of truth.

**Resolution.** All five specification PDFs now live at the repository root only; subdirectory copies removed. `README.md` references the canonical paths.

## BETA-003 — No first-class MCP integration for LLM clients

| Field | Value |
|---|---|
| ID | BETA-003 |
| Reported via | Integrator feedback (Cursor + Claude Desktop users) |
| Severity | Medium (feature gap) |
| Status | Resolved |
| Resolution commit | [`00e52a2`](https://github.com/dextrlabs-dev/Hydra-Wall-Street-Library/commit/00e52a2) |
| Related docs | [docs/mcp/SETUP.md](./mcp/SETUP.md), [apps/hydra-ws-mcp](../apps/hydra-ws-mcp) |

**Symptom.** Beta integrators trying to drive the matching engine from an LLM client had to write bespoke glue. There was no off-the-shelf MCP server.

**Root cause.** MCP support wasn't part of the original scope; it surfaced as integrator demand once the engine was running.

**Resolution.** Shipped `apps/hydra-ws-mcp` as a stdio MCP server exposing engine controls. Wrote [docs/mcp/SETUP.md](./mcp/SETUP.md) plus a Cursor config example. Wired the build into the workspace `npm run build` chain.

## BETA-004 — Python bytecode and cache files committed to the repo

| Field | Value |
|---|---|
| ID | BETA-004 |
| Reported via | First-time contributor PR review |
| Severity | Low (repo hygiene, diff noise) |
| Status | Resolved |
| Resolution commit | [`8a1befa`](https://github.com/dextrlabs-dev/Hydra-Wall-Street-Library/commit/8a1befa) |

**Symptom.** `__pycache__/` and `*.pyc` files were tracked under `packages/sdk-python/`, producing noisy diffs every time a beta tester ran the Python SDK tests.

**Root cause.** Initial commit predated a Python entry in `.gitignore`.

**Resolution.** Added Python bytecode patterns to `.gitignore` and stripped all tracked cache files from history going forward.

---

## How issues are tracked going forward

- **Public issue intake**: GitHub Issues on `dextrlabs-dev/Hydra-Wall-Street-Library`.
- **Severity labels**: `sev:high` (credential exposure, data corruption, replay-chain breakage), `sev:medium` (feature gap, integrator friction), `sev:low` (docs / hygiene).
- **SLA**: high → triaged within 24 hours and patched before the next tag; medium → triaged within one week; low → batched into the next maintenance commit.
- **Cross-references**: each closed issue links its resolution commit and any updated docs (this file, [SECURITY.md](../SECURITY.md), [docs/RUNBOOK.md](./RUNBOOK.md), or [docs/THREAT_MODEL.md](./THREAT_MODEL.md)).
