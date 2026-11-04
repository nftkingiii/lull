# Lull

Read-only watcher for Robinhood Chain (4663) tokenized stocks while US markets are closed.
No wallet connection, no keys, no transactions.

## Run

    cd server && npm install && npm start      # API on :8787

Behind an HTTPS proxy (e.g. a cloud sandbox), Node's fetch needs `NODE_USE_ENV_PROXY=1` (Node >= 22.21).

## Data notes (measured 4 Nov 2026)

- Public RPC rate-limits by call count (~8-10 eth_calls/s). Reads go through Multicall3
  (`0xcA11...CA11`, deployed) and HTTP requests are paced; 429s back off.
- Feed `docs.baseAsset` is the token symbol except `RHDELL` -> `DELL` (explicit alias).
- Assets API envelope is `{ assets: [...] }`; `tokenDecimals` is used for pool maths.
- Pools holding < `LULL_MIN_POOL_USDG` (default 100) USDG are flagged empty and never priced.
