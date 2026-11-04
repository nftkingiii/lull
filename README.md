# Lull

Read-only watcher for Robinhood Chain (4663) tokenized stocks while US markets are closed.
No wallet connection, no keys, no transactions. Every number in the UI is labelled
**live**, **replay** or **scenario**, and failed reads show as errors — there is no demo data.

## Run

    cd server && npm install && npm start      # API on :8787, starts the Replay indexer
    cd web && npm install && npm run dev       # UI on :5173, proxies /api to :8787

Behind an HTTPS proxy (e.g. a cloud sandbox), Node's fetch needs `NODE_USE_ENV_PROXY=1` (Node >= 22.21).

| Env | Default | |
|---|---|---|
| `LULL_RPC_URL` | Robinhood public RPC | must serve logs over wide ranges |
| `LULL_RPC_GAP_MS` | 150 | minimum gap between RPC requests |
| `LULL_MIN_POOL_USDG` | 100 | pools / swaps below this USDG are treated as empty |
| `LULL_INDEX_REFRESH_MS` | 600000 | Replay refresh interval |
| `LULL_CACHE_DIR` | `server/.cache` | feed rounds, block lookups, weekend summaries |
| `LULL_NO_INDEXER` | unset | `1` disables the indexer (Replay then reports not ready) |

## API

- `GET /api/now` — per stock: deepest USDG pool price, latest feed price, drift %, feed age. `label: live`.
- `GET /api/weekends[?symbol=X]` — every weekend since 1 Jul: feed Friday close, on-chain low/high/last
  over the freeze, Monday reopen, gap. `?symbol=` adds hourly OHLC. `ready: false` with progress until built.
- `GET /api/positions/:wallet` — Morpho positions with Robinhood-stock collateral: health factor,
  liquidation price, and `scenario` rows for the next reopen (current pool price; worst gap since 1 Jul).

## Method and data notes (measured 4 Nov 2026)

- **Friday close / reopen:** last feed round at or before Saturday 12:00 UTC, and the next round.
- **Pool:** deepest USDG pool by `balanceOf`. For Replay, the RPC has no archive state (nor does the
  free drpc endpoint; publicnode needs a token), so historical balances can't be read: Replay uses
  today's deepest pool and drops individual swaps whose in-range virtual USDG (`L·√P`) is below the
  floor — an upper bound on usable USDG, so those prices are genuinely thin. Excluded swaps are counted.
- **RPC limits:** ~8–10 eth_calls/s (429 beyond; reads go through Multicall3, which is deployed);
  `eth_getLogs` single-value filters span ≤ 10M blocks, multi-value ≤ 100k, topic-only ≤ 30k; > 10,000
  matches is an error (not truncation) and busy ranges can time out — both are split and retried.
  Logs carry a `blockTimestamp` field but it is always `0x0`, so weekend windows are cut by block
  number (first block at/after the feed's close and reopen) and swap times for the hourly chart are
  interpolated between exact 6-hourly block anchors (accurate to seconds; block rate ≈ 9.5–9.75/s).
- **Volume:** the busiest pools (NVDA, GOOGL 0.05%) see thousands of swaps per hour, so weekends are
  streamed into summaries (low/high/last/volume/hourly OHLC) rather than stored. Cold build ≈ 1 hour.
- **Feeds:** `docs.baseAsset` is the token symbol except `RHDELL` → `DELL` (explicit alias).
  Feed answers already include the corporate-action multiplier.
- **Morpho:** markets are listed from api.morpho.org, but collateral is matched by Robinhood token
  *address* re-read on-chain (`idToMarketParams`) — copycat tickers (`AAPLon`, `bNVDA`, …) are excluded.
  Positions, totals, oracle prices and accrued interest are read on-chain from Morpho Blue
  `0x9D53d5E3bd5E8d4Cbfa6DB1ca238AEA02E651010`. Oracles sit within ~0.1% of the feeds; scenarios
  move the oracle by the same ratio as the feed.

## Styling

All colours, fonts and radii live in `web/src/theme.css` (light + dark). Swap that file to apply a house style.
