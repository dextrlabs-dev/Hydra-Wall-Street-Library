# Security

## API keys

This project never hardcodes Alpaca credentials. They are read from `.env` only.

If your **Alpaca paper** key (`APCA_API_KEY_ID`) and secret (`APCA_API_SECRET_KEY`) have been visible in a screenshot, terminal share, or commit, treat them as **compromised**:

1. Open the [Alpaca dashboard](https://app.alpaca.markets/) → **Paper Trading** → **API Keys**.
2. **Revoke** the exposed pair and **generate** a new one.
3. Run `./scripts/setup-env.sh` and paste the new pair when prompted. The script writes `.env` with permissions `0600` so the secret never lands in your shell history.

`.env` is listed in [`.gitignore`](./.gitignore); never commit it.

## Custody

This library does not custody real assets:

- The matching engine is deterministic and **simulation-only**.
- Hydra L2 transactions are signed by an externally supplied `HydraSigner` implementation (interface only - no key material lives in this repo).
- Default Alpaca endpoint is **paper** (`https://paper-api.alpaca.markets`); switching to live requires an explicit env override.

## Reporting issues

Please open a private security advisory in the upstream repository for any vulnerability that affects key handling, replay, or signer integration before publishing details.
