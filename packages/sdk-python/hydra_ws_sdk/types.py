"""Typed dataclasses mirroring @hydra-ws/core types."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal, Union

Side = Literal["buy", "sell"]


@dataclass(frozen=True)
class LimitOrIoc:
    kind: Literal["limit", "ioc"]
    id: str
    symbol: str
    side: Side
    priceTicks: int
    quantity: int


@dataclass(frozen=True)
class Cancel:
    kind: Literal["cancel"]
    id: str
    targetOrderId: str


OrderInput = Union[LimitOrIoc, Cancel]


@dataclass(frozen=True)
class FillEvent:
    type: Literal["fill"]
    tradeId: str
    symbol: str
    makerOrderId: str
    takerOrderId: str
    priceTicks: int
    quantity: int


@dataclass(frozen=True)
class OrderAccepted:
    type: Literal["accepted"]
    orderId: str
    symbol: str
    side: Side | None = None
    priceTicks: int | None = None
    quantity: int | None = None


@dataclass(frozen=True)
class OrderRejected:
    type: Literal["rejected"]
    orderId: str
    reason: str


@dataclass(frozen=True)
class OrderCancelled:
    type: Literal["cancelled"]
    orderId: str
    symbol: str
    remainingQty: int


@dataclass(frozen=True)
class BookLevel:
    priceTicks: int
    quantity: int


@dataclass
class BookSnapshot:
    type: Literal["book"]
    symbol: str
    bids: list[BookLevel] = field(default_factory=list)
    asks: list[BookLevel] = field(default_factory=list)
    sequence: int = 0


EngineEvent = Union[FillEvent, OrderAccepted, OrderRejected, OrderCancelled, BookSnapshot]
