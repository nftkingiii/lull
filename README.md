# Lull

**The feed sleeps. The market doesn't.** Live at **https://lull.up.railway.app**

Robinhood's stock tokens trade on Robinhood Chain around the clock, but their Chainlink price feeds
follow US market hours. Every weekend the feed freezes while the tokens keep trading, and lenders keep
valuing collateral at the frozen price until the first update on Sunday 20:00 New York time. Lull shows
that gap: the live price against the frozen feed, a call for Monday's reopen, every past weekend, and
what a reopen gap would do to Morpho loans backed by stock tokens.

Read-only for Robinhood Chain (4663): no wallet connection, no keys, no transactions. Every number in
the UI is labelled **live**, **replay** or **scenario**, and failed reads show as errors — there is no demo data.

## Why it matters (read from the chain, 5 Nov 2026)

| | |
|---|---|
| Weekend feed freeze, 18 weekends since 1 Jul | median **52 h**, up to **91.5 h** over a holiday |
| Trading while frozen, weekend of 24 Oct | **29,713** swaps, about **$9.0M** USDG volume |
| Borrowed on Morpho against stock tokens | about **$1.71M**, valued at the frozen price all weekend |
| Largest reopen gap since July | USO **−7.75%** (weekend of 1 Aug) |
| Last weekend trade called the reopen direction | right in **304 of 371** stock-weekends (decoupled pools left out) |

## What it does

- **Tonight** — for 33 stock tokens, the deepest pool's live price against the frozen feed, the weekend's
  highest, lowest and latest trades with exact times, and the reopen call (higher, lower or flat).
- **Replay** — every weekend since 1 Jul with the actual reopen, so each call can be checked.
- **Positions** — paste a wallet to see its Morpho loans backed by stock tokens, the liquidation price,
  and the health after a reopen at today's price or at the stock's worst gap since July.
- [Method and limits](https://lull.up.railway.app/method.html) · [plain-text summary](https://lull.up.railway.app/llms.txt)

## How it was built

Built for Vibeathon 02 (Vibestarter, 2–9 Nov 2026) with Claude Code end to end:

- **Research and verification** — the idea, the on-chain probes (feeds, pools, Morpho markets) and every
  number above were checked by an agent reading Robinhood Chain directly, before any code was written.
- **Implementation** — the server, indexer and UI were written by Claude Code in four proof-first slices,
  each one tested against live chain data before the next.
- **Independent checks** — each slice's numbers were re-derived by a second agent from raw RPC reads; that
  caught a block-time estimate (now exact header timestamps) and a hardcoded reopen time that broke when US
  clocks changed on 1 Nov.
- **Design** — directions researched from shipped products (Flighty's flight status), then a fixed design
  system (`LULL_DESIGN.md`) applied and checked at desktop and phone widths.

## Run

    npm run build && npm start                 # production: one service, API and built UI on $PORT
    cd server && npm install && npm start      # API on :8787, starts the Replay indexer
    cd web && npm install && npm run dev       # UI on :5173, proxies /api to :8787

Behind an HTTPS proxy (e.g. a cloud sandbox), Node's fetch needs `NODE_USE_ENV_PROXY=1` (Node >= 22.21).

| Env | Default | |
|---|---|---|
| `LULL_RPC_URL` | Robinhood public RPC | must serve logs over wide ranges |
| `LULL_RPC_GAP_MS` | 150 | minimum gap between RPC requests |
| `LULL_MIN_POOL_USDG` | 100 | pools / swaps below this USDG are treated as empty |
| `LULL_INDEX_REFRESH_MS` | 600000 | refresh interval when no weekend is live |
| `LULL_LIVE_REFRESH_MS` | 120000 | refresh interval while a weekend is live (new blocks only) |
| `LULL_CACHE_DIR` | `server/.cache` | feed rounds, block lookups, weekend summaries |
| `LULL_NO_INDEXER` | unset | `1` disables the indexer (Replay then reports not ready) |
| `LULL_TEST_CLOCK` | unset | `1` enables a pinned test clock for rehearsals (ignored when `NODE_ENV=production`) |
| `LULL_TEST_NOW` | unset | with the test clock: the instant to pin, e.g. `2026-10-31T15:00:00Z`; `POST /api/_test/clock?at=…` moves it |

## API

- `GET /api/now` — per stock: deepest USDG pool price, latest feed price, drift %, feed age. `label: live`.
- `GET /api/weekends[?symbol=X]` — every weekend since 1 Jul: feed Friday close, on-chain low/high/last
  over the freeze, Monday reopen, gap. `?symbol=` adds hourly OHLC. `ready: false` with progress until built.
  The current weekend is listed, `live: true`, from Friday 16:00 New York; rows that have not reopened carry
  `expectedReopen`, `reopenOverdue` (no round 15 min after it) and, until Friday 20:00 New York,
  `feedMayUpdateUntil`. `upcoming` gives the next weekend's start and expected reopen.
- `GET /api/positions/:wallet` — Morpho positions with Robinhood-stock collateral: health factor,
  liquidation price, and `scenario` rows for the next reopen (current pool price; worst gap since 1 Jul).
- `GET /api/stocks` — names, Robinhood logos and Morpho exposure per token. `GET /api/health` — liveness.

## Method and data notes (measured 4 Nov 2026)

- **Friday close / reopen:** last feed round at or before Saturday 12:00 UTC, and the next round. A weekend
  goes live at Friday 16:00 New York (its close is the latest round so far until Friday 20:00 New York, when
  extended-hours rounds stop), refreshes every 2 minutes from new blocks only, and each stock flips to
  closed on its own first reopen round, so one late feed doesn't hold the others.
- **Pool per weekend:** each stock's weekend is read from the USDG pool with the most in-range USDG swap
  volume between the Friday close and the reopen (ties or no volume: the deepest pool today), so every machine
  gets the same answer; a live weekend can switch pools until it reopens.
- **Pool:** Tonight's live drift uses the deepest USDG pool by `balanceOf`. The RPC has no archive state
  (nor does the free drpc endpoint; publicnode needs a token), so weekends pick their pool by that weekend's
  volume instead (below), and individual swaps whose in-range virtual USDG (`L·√P`) is below the floor are
  dropped — an upper bound on usable USDG, so those prices are genuinely thin. Excluded swaps are counted.
- **RPC limits:** ~8–10 eth_calls/s (429 beyond; reads go through Multicall3, which is deployed);
  `eth_getLogs` single-value filters span ≤ 10M blocks, multi-value ≤ 100k, topic-only ≤ 30k; > 10,000
  matches is an error (not truncation) and busy ranges can time out — both are split and retried.
  Logs carry a `blockTimestamp` field but it is always `0x0`. Weekend windows are cut by block number
  (first block whose header is at/after the feed's close and reopen), hourly buckets by the first block
  of each hour, and the highest, lowest and last trades get their exact time from batched
  `eth_getBlockByNumber` headers. No time is ever estimated from block numbers.
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

The UI follows the locked design system in `LULL_DESIGN.md` (reference: `design/tonight-reference.html`). Tokens live in `web/src/theme.css`; fonts are Geist, Geist Mono and Instrument Serif from Google Fonts; icons are lucide.
