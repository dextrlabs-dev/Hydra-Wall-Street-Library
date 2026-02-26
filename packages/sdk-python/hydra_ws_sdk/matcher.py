"""Pure-Python deterministic matching engine for backtesting.

Mirrors the event names of the TypeScript core so notebooks and tests can swap
between this embedded engine and a remote ``EngineClient`` without code changes.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from typing import Iterable, Sequence

from ._canonical import canonical_json, to_jsonable
from .types import (
    BookLevel,
    BookSnapshot,
    Cancel,
    EngineEvent,
    FillEvent,
    LimitOrIoc,
    OrderAccepted,
    OrderCancelled,
    OrderInput,
    OrderRejected,
    Side,
)

_GENESIS = "00" * 32


def _next_hash(prev_hash: str, order: OrderInput, outputs: Sequence[EngineEvent]) -> str:
    h = hashlib.sha256()
    h.update(prev_hash.encode("ascii"))
    h.update(b"|")
    h.update(canonical_json(order).encode("utf-8"))
    h.update(b"|")
    h.update(canonical_json(list(outputs)).encode("utf-8"))
    return h.hexdigest()


@dataclass
class _RestingOrder:
    id: str
    side: Side
    priceTicks: int
    remainingQty: int
    arrival: int


@dataclass
class _SymbolBook:
    symbol: str
    seq: int = 0
    trade_seq: int = 0
    bids: dict[int, list[_RestingOrder]] = field(default_factory=dict)
    asks: dict[int, list[_RestingOrder]] = field(default_factory=dict)
    bid_prices: list[int] = field(default_factory=list)
    ask_prices: list[int] = field(default_factory=list)
    order_to_price: dict[str, tuple[Side, int]] = field(default_factory=dict)

    def has_order(self, oid: str) -> bool:
        return oid in self.order_to_price

    def handle(self, order: LimitOrIoc) -> list[EngineEvent]:
        if order.quantity <= 0 or order.priceTicks <= 0:
            return [OrderRejected(type="rejected", orderId=order.id, reason="invalid quantity or price")]
        out: list[EngineEvent] = []
        remaining = order.quantity

        if order.side == "buy":
            while remaining > 0 and self.ask_prices:
                best = self.ask_prices[0]
                if best > order.priceTicks:
                    break
                queue = self.asks.get(best)
                if not queue:
                    self._remove_ask(best)
                    continue
                maker = queue[0]
                take = min(remaining, maker.remainingQty)
                self.trade_seq += 1
                out.append(self._fill(order.id, maker.id, best, take))
                maker.remainingQty -= take
                remaining -= take
                if maker.remainingQty <= 0:
                    queue.pop(0)
                    self.order_to_price.pop(maker.id, None)
                if not queue:
                    self._remove_ask(best)
        else:
            while remaining > 0 and self.bid_prices:
                best = self.bid_prices[0]
                if best < order.priceTicks:
                    break
                queue = self.bids.get(best)
                if not queue:
                    self._remove_bid(best)
                    continue
                maker = queue[0]
                take = min(remaining, maker.remainingQty)
                self.trade_seq += 1
                out.append(self._fill(order.id, maker.id, best, take))
                maker.remainingQty -= take
                remaining -= take
                if maker.remainingQty <= 0:
                    queue.pop(0)
                    self.order_to_price.pop(maker.id, None)
                if not queue:
                    self._remove_bid(best)

        filled = order.quantity - remaining

        if remaining > 0 and order.kind == "limit":
            self.seq += 1
            resting = _RestingOrder(
                id=order.id,
                side=order.side,
                priceTicks=order.priceTicks,
                remainingQty=remaining,
                arrival=self.seq,
            )
            if order.side == "buy":
                self._add_bid(resting)
            else:
                self._add_ask(resting)
            self.order_to_price[order.id] = (order.side, order.priceTicks)
            out.append(
                OrderAccepted(
                    type="accepted",
                    orderId=order.id,
                    symbol=self.symbol,
                    side=order.side,
                    priceTicks=order.priceTicks,
                    quantity=remaining,
                )
            )
        elif remaining > 0 and order.kind == "ioc":
            reason = "ioc remainder cancelled" if filled > 0 else "ioc had no match"
            out.append(OrderRejected(type="rejected", orderId=order.id, reason=reason))
        elif filled > 0 and remaining == 0:
            out.append(
                OrderAccepted(
                    type="accepted",
                    orderId=order.id,
                    symbol=self.symbol,
                    side=order.side,
                    priceTicks=order.priceTicks,
                    quantity=filled,
                )
            )

        out.append(self.snapshot())
        return out

    def cancel(self, cancel_id: str, target: str) -> list[EngineEvent]:
        meta = self.order_to_price.get(target)
        if not meta:
            return [OrderRejected(type="rejected", orderId=cancel_id, reason="unknown order")]
        side, price = meta
        queue = self.bids.get(price) if side == "buy" else self.asks.get(price)
        if not queue:
            return [OrderRejected(type="rejected", orderId=cancel_id, reason="order not in book")]
        idx = next((i for i, o in enumerate(queue) if o.id == target), -1)
        if idx < 0:
            return [OrderRejected(type="rejected", orderId=cancel_id, reason="order not in book")]
        removed = queue.pop(idx)
        self.order_to_price.pop(target, None)
        if not queue:
            if side == "buy":
                self._remove_bid(price)
            else:
                self._remove_ask(price)
        return [
            OrderCancelled(
                type="cancelled",
                orderId=target,
                symbol=self.symbol,
                remainingQty=removed.remainingQty,
            ),
            self.snapshot(),
        ]

    def snapshot(self) -> BookSnapshot:
        self.seq += 1
        bids = [
            BookLevel(priceTicks=p, quantity=sum(o.remainingQty for o in self.bids[p]))
            for p in self.bid_prices
            if self.bids.get(p)
        ]
        asks = [
            BookLevel(priceTicks=p, quantity=sum(o.remainingQty for o in self.asks[p]))
            for p in self.ask_prices
            if self.asks.get(p)
        ]
        return BookSnapshot(type="book", symbol=self.symbol, bids=bids, asks=asks, sequence=self.seq)

    def _fill(self, taker: str, maker: str, price: int, qty: int) -> FillEvent:
        return FillEvent(
            type="fill",
            tradeId=f"T-{self.seq}-{self.trade_seq}",
            symbol=self.symbol,
            makerOrderId=maker,
            takerOrderId=taker,
            priceTicks=price,
            quantity=qty,
        )

    def _add_bid(self, o: _RestingOrder) -> None:
        self.bids.setdefault(o.priceTicks, [])
        if o.priceTicks not in self.bid_prices:
            self.bid_prices.append(o.priceTicks)
            self.bid_prices.sort(reverse=True)
        self.bids[o.priceTicks].append(o)

    def _add_ask(self, o: _RestingOrder) -> None:
        self.asks.setdefault(o.priceTicks, [])
        if o.priceTicks not in self.ask_prices:
            self.ask_prices.append(o.priceTicks)
            self.ask_prices.sort()
        self.asks[o.priceTicks].append(o)

    def _remove_bid(self, p: int) -> None:
        self.bid_prices = [x for x in self.bid_prices if x != p]
        self.bids.pop(p, None)

    def _remove_ask(self, p: int) -> None:
        self.ask_prices = [x for x in self.ask_prices if x != p]
        self.asks.pop(p, None)


class LocalMatchingEngine:
    """Pure-Python price-time matcher (limit / IOC / cancel)."""

    def __init__(self) -> None:
        self._books: dict[str, _SymbolBook] = {}

    def submit(self, order: OrderInput) -> list[EngineEvent]:
        if isinstance(order, Cancel):
            for sym, book in self._books.items():
                if book.has_order(order.targetOrderId):
                    return book.cancel(order.id, order.targetOrderId)
            return [OrderRejected(type="rejected", orderId=order.id, reason="unknown order")]
        return self._book(order.symbol).handle(order)

    def snapshot(self, symbol: str) -> BookSnapshot | None:
        book = self._books.get(symbol)
        return book.snapshot() if book else None

    def _book(self, symbol: str) -> _SymbolBook:
        book = self._books.get(symbol)
        if not book:
            book = _SymbolBook(symbol=symbol)
            self._books[symbol] = book
        return book


@dataclass
class EventLogEntry:
    index: int
    input: OrderInput
    outputs: list[EngineEvent]
    hash: str


class EventLog:
    """Append-only log with a SHA-256 chain over (input, outputs)."""

    def __init__(self) -> None:
        self._entries: list[EventLogEntry] = []

    @staticmethod
    def genesis_hash() -> str:
        return _GENESIS

    @property
    def head_hash(self) -> str:
        return self._entries[-1].hash if self._entries else _GENESIS

    @property
    def size(self) -> int:
        return len(self._entries)

    def to_list(self) -> list[EventLogEntry]:
        return list(self._entries)

    def append(self, order: OrderInput, outputs: Iterable[EngineEvent]) -> EventLogEntry:
        outs = list(outputs)
        h = _next_hash(self.head_hash, order, outs)
        entry = EventLogEntry(index=len(self._entries), input=order, outputs=outs, hash=h)
        self._entries.append(entry)
        return entry


def replay(entries: Sequence[EventLogEntry]) -> str:
    """Replays the log on a fresh engine and returns the final chain hash.

    Raises ValueError on hash mismatch.
    """
    engine = LocalMatchingEngine()
    prev = _GENESIS
    for entry in entries:
        outs = engine.submit(entry.input)
        # When asdict-ing dataclasses, BookSnapshot.bids/asks contain
        # BookLevel instances; canonical_json handles dataclasses recursively.
        if to_jsonable(outs) != to_jsonable(entry.outputs):
            raise ValueError(f"replay output mismatch at step {entry.index}")
        prev = _next_hash(prev, entry.input, outs)
        if prev != entry.hash:
            raise ValueError(f"replay hash mismatch at step {entry.index}")
    return prev
