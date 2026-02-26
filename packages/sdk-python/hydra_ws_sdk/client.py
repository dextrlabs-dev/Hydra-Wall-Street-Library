"""HTTP + WebSocket client for the engine-server."""

from __future__ import annotations

from dataclasses import asdict
from typing import Any, AsyncIterator
from urllib.parse import urlparse, urlunparse

import httpx

try:
    import websockets  # type: ignore
except ImportError:  # pragma: no cover - optional dep
    websockets = None  # type: ignore[assignment]

from .types import BookSnapshot, Cancel, LimitOrIoc, OrderInput


def _serialize(order: OrderInput) -> dict[str, Any]:
    d = asdict(order)
    return d


def _ws_url(base_url: str, symbol: str) -> str:
    parsed = urlparse(base_url)
    scheme = "wss" if parsed.scheme == "https" else "ws"
    return urlunparse((scheme, parsed.netloc, f"/stream/{symbol}", "", "", ""))


class EngineClient:
    """Synchronous HTTP client; ``stream`` is the only async path (websockets)."""

    def __init__(self, base_url: str = "http://localhost:8080", *, timeout: float = 5.0) -> None:
        self.base_url = base_url.rstrip("/")
        self._http = httpx.Client(base_url=self.base_url, timeout=timeout)

    def __enter__(self) -> "EngineClient":
        return self

    def __exit__(self, *_: Any) -> None:
        self.close()

    def close(self) -> None:
        self._http.close()

    def health(self) -> dict[str, Any]:
        r = self._http.get("/health")
        r.raise_for_status()
        return r.json()

    def list_markets(self) -> list[dict[str, Any]]:
        r = self._http.get("/markets")
        r.raise_for_status()
        return r.json()

    def book(self, symbol: str) -> BookSnapshot:
        r = self._http.get(f"/book/{symbol}")
        r.raise_for_status()
        data = r.json()
        from .types import BookLevel

        return BookSnapshot(
            type="book",
            symbol=data["symbol"],
            bids=[BookLevel(**lvl) for lvl in data.get("bids", [])],
            asks=[BookLevel(**lvl) for lvl in data.get("asks", [])],
            sequence=data.get("sequence", 0),
        )

    def submit_order(self, order: LimitOrIoc) -> dict[str, Any]:
        r = self._http.post("/orders", json=_serialize(order))
        if r.status_code == 409:
            return r.json()
        r.raise_for_status()
        return r.json()

    def cancel_order(self, cancel_id: str, target_order_id: str) -> dict[str, Any]:
        r = self._http.request(
            "DELETE",
            f"/orders/{cancel_id}",
            json={"targetOrderId": target_order_id},
        )
        r.raise_for_status()
        return r.json()

    def metrics(self) -> dict[str, Any]:
        r = self._http.get("/metrics")
        r.raise_for_status()
        return r.json()

    def verify(self, hash_hex: str) -> dict[str, Any]:
        r = self._http.get(f"/verify/{hash_hex}")
        r.raise_for_status()
        return r.json()

    async def stream(self, symbol: str) -> AsyncIterator[dict[str, Any]]:
        """Async generator over WS frames for ``symbol``.

        Requires the optional ``websockets`` dependency (install ``hydra_ws_sdk[ws]``).
        """
        if websockets is None:
            raise RuntimeError("install hydra_ws_sdk[ws] (websockets) to use stream()")
        url = _ws_url(self.base_url, symbol)
        async with websockets.connect(url) as ws:  # type: ignore[attr-defined]
            async for raw in ws:
                yield _parse_frame(raw)


def _parse_frame(raw: str | bytes) -> dict[str, Any]:
    import json

    if isinstance(raw, (bytes, bytearray)):
        raw = raw.decode("utf-8")
    return json.loads(raw)


def cancel(cancel_id: str, target_order_id: str) -> Cancel:
    return Cancel(kind="cancel", id=cancel_id, targetOrderId=target_order_id)
