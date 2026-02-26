# @hydra-ws/core

Deterministic matching engine, rolling SHA-256 event log + replay, normalized market events, and synthetic feeds.

## Registering a new asset class

Asset classes are labels used by `MarketEvent.assetClass` and by `@hydra-ws/market-config` (`asset_class` field in YAML/JSON).

1. **Define semantics** - Decide tick size, lot size, and timezone/trading hours in a market config file (`markets/*.yaml` or `.json`).
2. **Hook normalized events** - Implement `MarketDataAdapter<TRaw>` with `normalize(raw): MarketEvent | null`. Set `assetClass` on each emitted `MarketEvent`.
3. **Optional registry** - Call `registerAssetClass({ name, tickSize, lotSize })` from `marketEvent.ts` if you want a central lookup table for notebooks or tooling.

Cross-asset feeds (e.g. equities vs crypto) typically share the same `MatchingEngine` symbol namespace but different configs under `--markets`.
