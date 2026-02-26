from hydra_ws_sdk import (
    Cancel,
    EventLog,
    LimitOrIoc,
    LocalMatchingEngine,
    replay,
)


def _submit_with_log(engine: LocalMatchingEngine, log: EventLog, order):
    out = engine.submit(order)
    log.append(order, out)
    return out


def test_limit_partial_cancel_replay_deterministic():
    engine = LocalMatchingEngine()
    log = EventLog()

    o1 = LimitOrIoc(kind="limit", id="o-1", symbol="DEMO", side="buy", priceTicks=10000, quantity=10)
    o2 = LimitOrIoc(kind="limit", id="o-2", symbol="DEMO", side="sell", priceTicks=10000, quantity=6)
    cancel = Cancel(kind="cancel", id="c-1", targetOrderId="o-1")

    e1 = _submit_with_log(engine, log, o1)
    e2 = _submit_with_log(engine, log, o2)
    e3 = _submit_with_log(engine, log, cancel)

    fills = [e for e in e2 if e.type == "fill"]
    assert len(fills) == 1
    assert fills[0].quantity == 6

    cancelled = [e for e in e3 if e.type == "cancelled"]
    assert len(cancelled) == 1
    assert cancelled[0].remainingQty == 4

    book = engine.snapshot("DEMO")
    assert book is not None and not book.bids and not book.asks

    final_hash = replay(log.to_list())
    assert final_hash == log.head_hash


def test_replay_detects_tampering():
    engine = LocalMatchingEngine()
    log = EventLog()
    o1 = LimitOrIoc(kind="limit", id="o-1", symbol="X", side="buy", priceTicks=100, quantity=1)
    _submit_with_log(engine, log, o1)
    entries = log.to_list()
    # Tamper with the recorded hash
    entries[0].hash = "0" * 64
    try:
        replay(entries)
    except ValueError:
        return
    raise AssertionError("replay should have raised on tampered hash")


def test_ioc_with_no_match_rejects():
    engine = LocalMatchingEngine()
    out = engine.submit(
        LimitOrIoc(kind="limit", id="m-1", symbol="X", side="sell", priceTicks=200, quantity=5)
    )
    assert any(e.type == "accepted" for e in out)
    out = engine.submit(
        LimitOrIoc(kind="ioc", id="t-1", symbol="X", side="buy", priceTicks=100, quantity=5)
    )
    assert any(e.type == "rejected" for e in out)
