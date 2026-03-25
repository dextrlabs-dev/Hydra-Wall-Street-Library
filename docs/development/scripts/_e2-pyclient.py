"""Drive the Python SDK against a running engine-server (used by capture-integration.sh)."""

from __future__ import annotations

import json
import os
import sys

from hydra_ws_sdk import EngineClient, LimitOrIoc

base_url = os.environ.get("ENGINE_URL", "http://localhost:8080")

print(f"# Python SDK session against {base_url}")
print(f"# python {sys.version.split()[0]}")

with EngineClient(base_url) as c:
    print("\n## health")
    print(json.dumps(c.health(), indent=2))

    print("\n## list_markets()")
    markets = c.list_markets()
    print(json.dumps(markets, indent=2))

    # BTCUSDT is 24/7 — avoids trading_hours rejection when CI runs outside NY equity hours.
    sym = "BTCUSDT"
    px = 65_000_000

    print(f"\n## submit_order(buy 10 {sym} @ {px})")
    r = c.submit_order(
        LimitOrIoc(
            kind="limit",
            id="py-buy-1",
            symbol=sym,
            side="buy",
            priceTicks=px,
            quantity=10,
        )
    )
    print(json.dumps(r, indent=2))

    print(f"\n## submit_order(sell 4 {sym} @ {px}) -- partial fill of py-buy-1")
    r = c.submit_order(
        LimitOrIoc(
            kind="limit",
            id="py-sell-1",
            symbol=sym,
            side="sell",
            priceTicks=px,
            quantity=4,
        )
    )
    print(json.dumps(r, indent=2))

    print(f"\n## book({sym})")
    book = c.book(sym)
    print(
        json.dumps(
            {
                "symbol": book.symbol,
                "bids": [{"priceTicks": b.priceTicks, "quantity": b.quantity} for b in book.bids],
                "asks": [{"priceTicks": a.priceTicks, "quantity": a.quantity} for a in book.asks],
                "sequence": book.sequence,
            },
            indent=2,
        )
    )

    print("\n## metrics()")
    print(json.dumps(c.metrics(), indent=2))

print("\n# Python SDK session: ok")
