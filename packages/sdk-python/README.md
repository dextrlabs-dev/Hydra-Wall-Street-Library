# hydra-ws-sdk (Python)

Python SDK for Hydra Wall Street Library.

## Install (editable)

```bash
pip install -e packages/sdk-python[dev]
```

## Quick start: remote (engine-server)

```python
from hydra_ws_sdk import EngineClient, LimitOrIoc

with EngineClient("http://localhost:8080") as c:
    print(c.list_markets())
    r = c.submit_order(LimitOrIoc(
        kind="limit", id="o-1", symbol="AAPL",
        side="buy", priceTicks=10000, quantity=10,
    ))
    print(r)
    print(c.book("AAPL"))
```

## Quick start: embedded matcher (backtest)

```python
from hydra_ws_sdk import EventLog, LimitOrIoc, LocalMatchingEngine, replay

engine = LocalMatchingEngine()
log = EventLog()

orders = []  # your sequence of order dicts or LimitOrIoc instances
for order in orders:
    out = engine.submit(order)
    log.append(order, out)

# Hash-chain replay verifies determinism
final = replay(log.to_list())
assert final == log.head_hash
```

## Tests

```bash
pytest packages/sdk-python
```
