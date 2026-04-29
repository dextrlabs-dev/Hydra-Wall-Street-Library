# MCP integration (Alpaca + Hydra Wall Street)

This project supports two complementary MCP setups:

1. **Alpaca’s official MCP server** — full Trading API tool surface (Python, `uvx`). Best for market data, watchlists, and broker orders in natural language.
2. **`hydra-ws-mcp`** (this repo) — Node stdio server that exposes **local `engine-server`** REST plus **optional** Alpaca REST via the same credential names as `@hydra-ws/adapters-alpaca`.

Never commit API keys. Use your MCP client’s `env` block or a local `.env` that stays gitignored. If a key was ever shown in a screenshot or chat, **rotate it** in the Alpaca dashboard (see repository `SECURITY.md`).

## 1. Official Alpaca MCP (recommended for Alpaca-only workflows)

Prerequisites: Python 3.10+, [uv](https://docs.astral.sh/uv/getting-started/installation/), paper or live Alpaca keys.

The upstream server expects (paper by default):

| Variable | Required | Notes |
|----------|----------|--------|
| `ALPACA_API_KEY` | Yes | Key ID from dashboard |
| `ALPACA_SECRET_KEY` | Yes | Secret key |
| `ALPACA_PAPER_TRADE` | No | `true` (default) for paper; `false` for live |

Optional: `ALPACA_TOOLSETS` to restrict exposed tools (see [Alpaca MCP Server](https://github.com/alpacahq/alpaca-mcp-server) README).

### Cursor (`~/.cursor/mcp.json`)

Merge this into your `mcpServers` object (replace placeholders):

```json
{
  "mcpServers": {
    "alpaca-official": {
      "command": "uvx",
      "args": ["alpaca-mcp-server"],
      "env": {
        "ALPACA_API_KEY": "YOUR_KEY_ID",
        "ALPACA_SECRET_KEY": "YOUR_SECRET",
        "ALPACA_PAPER_TRADE": "true"
      }
    }
  }
}
```

Restart Cursor after editing. Use a **new chat** when switching MCP versions so tool lists refresh.

### Same keys as the Hydra `.env` convention

Library examples use `APCA_API_KEY_ID` and `APCA_API_SECRET_KEY`. The official MCP server uses **`ALPACA_API_KEY`** / **`ALPACA_SECRET_KEY`**. You can paste the **same** key id and secret into the JSON `env` block above; only the variable names differ.

## 2. Hydra Wall Street MCP (`hydra-ws-mcp`)

Build once from the repo root:

```bash
npm install
npm run build -w @hydra-ws/adapters-alpaca
npm run build -w hydra-ws-mcp
```

Run **`engine-server`** (for example `npm run engine` from the root `package.json`) so engine tools can reach `ENGINE_BASE_URL`.

### Environment

| Variable | Purpose |
|----------|---------|
| `ENGINE_BASE_URL` | Base URL for engine-server (default `http://127.0.0.1:8080`) |
| `APCA_API_KEY_ID` / `APCA_API_SECRET_KEY` | Enable Alpaca tools (same as library `.env.example`) |
| `ALPACA_API_KEY` / `ALPACA_SECRET_KEY` | Alternative names for Alpaca tools |
| `ALPACA_PAPER` or `ALPACA_PAPER_TRADE` | `false` selects live host when `ALPACA_TRADING_BASE_URL` is unset |
| `ALPACA_TRADING_BASE_URL` | Override trading REST base URL |

### Cursor entry

Use the absolute path to `dist/main.js` on your machine. Example:

```json
{
  "mcpServers": {
    "hydra-wall-street": {
      "command": "node",
      "args": ["/path/to/hydra-wall-street-library/apps/hydra-ws-mcp/dist/main.js"],
      "env": {
        "ENGINE_BASE_URL": "http://127.0.0.1:8080",
        "APCA_API_KEY_ID": "YOUR_KEY_ID",
        "APCA_API_SECRET_KEY": "YOUR_SECRET",
        "ALPACA_PAPER": "true"
      }
    }
  }
}
```

You may run **both** `alpaca-official` and `hydra-wall-street` if you want the full Alpaca toolset plus explicit **local matching engine** tools (`hydra_engine_*`).

### Tools exposed by `hydra-ws-mcp`

- **Engine:** `hydra_engine_health`, `hydra_engine_markets`, `hydra_engine_book`, `hydra_engine_metrics`, `hydra_engine_submit_order`, `hydra_engine_cancel_order`
- **Alpaca** (only if keys are set): `alpaca_get_account`, `alpaca_get_orders`, `alpaca_submit_order`, `alpaca_cancel_order`

See also: [example Cursor fragment](cursor-mcp.example.json) in this folder.
