import respx
from httpx import Response

from hydra_ws_sdk import EngineClient, LimitOrIoc


@respx.mock
def test_list_markets():
    respx.get("http://localhost:8080/markets").mock(
        return_value=Response(200, json=[{"symbol": "AAPL", "asset_class": "equity", "tick_size": 1, "lot_size": 1}])
    )
    with EngineClient() as c:
        markets = c.list_markets()
    assert markets[0]["symbol"] == "AAPL"


@respx.mock
def test_submit_order():
    respx.post("http://localhost:8080/orders").mock(
        return_value=Response(200, json={"events": [{"type": "accepted", "orderId": "o-1", "symbol": "X"}]})
    )
    with EngineClient() as c:
        result = c.submit_order(
            LimitOrIoc(kind="limit", id="o-1", symbol="X", side="buy", priceTicks=100, quantity=1)
        )
    assert result["events"][0]["type"] == "accepted"


@respx.mock
def test_submit_order_rejected_returns_409_payload():
    respx.post("http://localhost:8080/orders").mock(
        return_value=Response(409, json={"rejected": {"reason": "tick_size"}, "events": []})
    )
    with EngineClient() as c:
        result = c.submit_order(
            LimitOrIoc(kind="limit", id="o-2", symbol="AAPL", side="buy", priceTicks=10003, quantity=1)
        )
    assert result["rejected"]["reason"] == "tick_size"


@respx.mock
def test_book_parses_snapshot():
    respx.get("http://localhost:8080/book/X").mock(
        return_value=Response(
            200,
            json={
                "type": "book",
                "symbol": "X",
                "bids": [{"priceTicks": 100, "quantity": 1}],
                "asks": [{"priceTicks": 110, "quantity": 2}],
                "sequence": 5,
            },
        )
    )
    with EngineClient() as c:
        snap = c.book("X")
    assert snap.bids[0].priceTicks == 100
    assert snap.asks[0].quantity == 2
