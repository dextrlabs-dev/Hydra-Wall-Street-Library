"""Canonical JSON encoder used by the Python event log to match the TS chain."""

from __future__ import annotations

from dataclasses import asdict, is_dataclass
from typing import Any


def to_jsonable(value: Any) -> Any:
    if is_dataclass(value):
        return _strip_none(asdict(value))
    if isinstance(value, dict):
        return _strip_none(value)
    if isinstance(value, (list, tuple)):
        return [to_jsonable(v) for v in value]
    return value


def _strip_none(d: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for k, v in d.items():
        if v is None:
            continue
        out[k] = to_jsonable(v)
    return out


def canonical_json(value: Any) -> str:
    """Stable JSON: keys sorted recursively; matches TS canonicalJson."""
    v = to_jsonable(value)
    return _encode(v)


def _encode(value: Any) -> str:
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        if isinstance(value, float) and not value.is_integer():
            return repr(value)
        if isinstance(value, float):
            return str(int(value))
        return str(value)
    if isinstance(value, str):
        return _encode_string(value)
    if isinstance(value, list):
        return "[" + ",".join(_encode(v) for v in value) + "]"
    if isinstance(value, dict):
        items = sorted(((k, v) for k, v in value.items() if v is not None), key=lambda x: x[0])
        return "{" + ",".join(f"{_encode_string(k)}:{_encode(v)}" for k, v in items) + "}"
    raise TypeError(f"unsupported type for canonical json: {type(value)}")


def _encode_string(s: str) -> str:
    """Mirror JSON.stringify minimal escaping (no /-escape, no \\u for printable)."""
    out = ['"']
    for ch in s:
        code = ord(ch)
        if ch == '"':
            out.append('\\"')
        elif ch == "\\":
            out.append("\\\\")
        elif ch == "\b":
            out.append("\\b")
        elif ch == "\f":
            out.append("\\f")
        elif ch == "\n":
            out.append("\\n")
        elif ch == "\r":
            out.append("\\r")
        elif ch == "\t":
            out.append("\\t")
        elif code < 0x20:
            out.append("\\u%04x" % code)
        else:
            out.append(ch)
    out.append('"')
    return "".join(out)
