# Lull design system (locked 4 Nov)

Apply this to `web/` in place of the neutral styling. The reference screen is `design/tonight-reference.html`; match it. Process follows unslop by Damir Sokolovsky (@heydamir, CC BY 4.0).

## Direction
- Product: shows stock-token holders and borrowers on Robinhood Chain where Monday's frozen price feed will reopen.
- Character: watchful, exact, unhurried.
- World: the night shift, an arrivals board after midnight, sodium streetlight.
- Moment: the weekend's real price path against the frozen feed. One per screen, nothing else rich.
- Signature: the FRI → MON route (airport-code style) under the chart. Nowhere else.

## Tokens
```css
--deep:#0f0f10; --page:#141415; --card:#19191b; --raised:#232325;
--line:rgba(237,237,237,.08); --line-2:rgba(237,237,237,.14);
--fg:#ededed; --fg-2:#a1a1a6; --fg-3:#85858b;
--accent:#e8a24a;            /* price line, "now"/last-trade dot, focus ring only */
--up:#4cc38a; --down:#e5484d;
--ease:cubic-bezier(.22,1,.36,1);
```
- Spacing on a 4px grid: page edge 32 (16 mobile), card padding 24, section gap 24, list rows min 56 with 8 vertical padding, top bar 56.
- Radius: cards 16, inputs/buttons 10, segmented control 10 outer / 8 inner, ticker tags 6.
- Depth: surface steps and hairlines only. No shadows except `inset 0 1px 0 rgba(255,255,255,.08)` on the selected tab.

## Type
- Geist 400/500 for the interface, Geist Mono for every number (tabular), Instrument Serif 400 for the page headline only.
- Sizes: 12 meta, 13 labels, 14 body, 20 route codes, 28 card figures, 56 headline (40 mobile, letter-spacing −0.02em).
- Sentence case everywhere. No uppercase tracked labels, no italic, no 600+, no negative tracking under 16px.

## Layout
- Top bar: moon glyph + "Lull" left; segmented control right: Tonight / Replay / Positions.
- Page head: ticker (Robinhood `logoUrl` + symbol + "Apple stock token on Robinhood Chain"), headline, mode on the right ("Live" with a still dot, or "Replay of the weekend of 24 Oct").
- Tonight: 8/4 grid. Left card = status line, chart (≥2/3 width, 320 tall, 220 mobile), route, journey legs. Right column = Morpho exposure + wallet check, other stocks list, hit-rate.
- Replay: same chart component per weekend; a table of weekends (date, stock, last-trade gap, reopen gap, called/missed). Flag decoupled rows quietly.
- Positions: wallet field first (one action), then positions as rows with current health, liquidation price, and the two reopen scenarios.
- Below 960px: one column in reading order, no horizontal scroll.

## Components
- Status line: arrow icon + "Called lower/higher/flat" in the semantic colour, then "Last trade −0.13% vs frozen feed, feed reopened −0.01%". In live mode the second half is "feed reopens Mon 00:00 UTC".
- Chart: hourly closing trades as one smooth accent line, frozen feed as a dashed `--fg-2` line, faint neutral fill between them, grid at rgba(237,237,237,.05), mono 11px labels in a 64px right gutter, the feed value in a small `--raised` tag on its line, Sat/Sun day dividers, a vertical line at the reopen. Single-trade high/low go in the legs, not the chart.
- Legs: Feed froze → Highest trade → Lowest trade → Last trade before reopen (accent dot) → Feed reopened. Each row: label, exact UTC time, price, change "vs feed".
- Other stocks: ticker tag, "Called higher" + "last trade +0.46%", right side reopen change + "reopened". A miss shows the call in `--fg-3`.
- Primary button: `--fg` fill with `--page` text, 44 tall. Hover background #fff, press scale .98.
- Icons: lucide only, 16 or 18px, stroke 1.5, text colour.

## Copy
- Every change says what it compares to ("vs feed", "vs Friday").
- No exclamation marks, no trailing periods on labels, no hype words.
- Read-only note: "Read-only, no wallet connection or signature".
- Replay and live are always labelled. A failed read shows an error state, never demo numbers.

## Motion
- No looping animation, no entrance animations on data, no hover scale on cards.
- Hover/press 150ms on colour, background and transform only, one easing.

## Data acceptance check (run before styling)
The RPC returns `blockTimestamp` 0 on logs. Get exact times with batched `eth_getBlockByNumber`, not by interpolating block numbers. For the weekend of 24 Oct the app must show:
- AAPL: feed $346.80 frozen Fri 14:39:15 UTC; highest trade $348.44 Fri 15:27; lowest $345.51 Sun 23:42; last trade $346.34 Mon 00:00:35 (−0.13%); reopened $346.76 Mon 00:00:38 (−0.01%).
- NVDA: feed $211.16 (Fri 19:55), last trade +0.46%, reopened +0.36%.
- TSLA: feed $372.07 (Fri 16:15), last trade −0.01%, reopened +0.28%.
If any number differs, fix the data before the UI, and recompute the "286 of 341" hit-rate the same way.
