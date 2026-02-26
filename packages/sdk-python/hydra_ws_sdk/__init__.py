"""hydra_ws_sdk: Python client + embedded matcher for Hydra Wall Street Library.

- ``EngineClient`` talks to the engine-server (HTTP + WebSocket) for live use.
- ``LocalMatchingEngine`` and ``EventLog`` provide a pure-Python deterministic
  matcher for offline backtests, mirroring the TypeScript core so notebooks can
  swap between embedded and remote modes without changing event shapes.
"""

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
from .matcher import EventLog, EventLogEntry, LocalMatchingEngine, replay
from .client import EngineClient

__all__ = [
    "BookLevel",
    "BookSnapshot",
    "Cancel",
    "EngineClient",
    "EngineEvent",
    "EventLog",
    "EventLogEntry",
    "FillEvent",
    "LimitOrIoc",
    "LocalMatchingEngine",
    "OrderAccepted",
    "OrderCancelled",
    "OrderInput",
    "OrderRejected",
    "Side",
    "replay",
]
