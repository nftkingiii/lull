import { getDataset, state } from '../indexer.js';
import { MIN_POOL_USDG } from '../config.js';

// A pool whose last weekend price is this far from the feed's reopen was not tracking the stock
// (measured: 316/345 weekends are within 1%, the worst legitimate case 6.2%, decoupled pools 20-85%).
export const DECOUPLED_PCT = 10;

const pct = (a, b) => (a == null || b == null ? null : ((a - b) / b) * 100);
const trade = (t, ref) => (t ? { price: t.price, at: iso(t.ts), block: t.block, vsFeedPct: pct(t.price, ref) } : null);
const iso = (ts) => (ts == null ? null : new Date(ts * 1000).toISOString());

function row(e, nowTs, withHourly) {
  if (!e.close) return { symbol: e.symbol, status: 'no-feed-history', onchain: null, onchainNote: e.onchainNote };
  const { close, reopen, onchain: o } = e;
  const hasRange = o && o.low != null;
  // Range = low/high of hourly closes (robust to one-off prints); absolute extremes kept separately.
  const closes = (o?.hourly ?? []).map((h) => h[4]);
  const rangeLow = closes.length ? closes.reduce((a, b) => (b < a ? b : a)) : null;
  const rangeHigh = closes.length ? closes.reduce((a, b) => (b > a ? b : a)) : null;
  const lastVsReopenPct = reopen && hasRange ? pct(o.last, reopen.price) : null;
  return {
    symbol: e.symbol,
    status: reopen ? 'closed' : 'ongoing',
    fridayClose: { price: close.price, at: iso(close.ts) },
    reopen: reopen ? { price: reopen.price, at: iso(reopen.ts), vsFeedPct: pct(reopen.price, close.price) } : null,
    frozenHours: ((reopen ? reopen.ts : nowTs) - close.ts) / 3600,
    gapPct: reopen ? pct(reopen.price, close.price) : null,
    onchain: o && {
      pool: o.pool, fee: o.fee, priceAtClose: o.priceAtClose,
      rangeLow, rangeHigh, rangeLowPct: pct(rangeLow, close.price), rangeHighPct: pct(rangeHigh, close.price),
      extremeLow: o.low, extremeHigh: o.high, extremeLowPct: pct(o.low, close.price), extremeHighPct: pct(o.high, close.price),
      last: o.last, lastPct: pct(o.last, close.price),
      // Actual weekend trades with exact times from block headers.
      highTrade: trade(o.highTrade, close.price), lowTrade: trade(o.lowTrade, close.price), lastTrade: trade(o.lastTrade, close.price),
      swaps: o.swaps, swapsExcludedThin: o.swapsExcludedThin, usdgVolume: o.usdgVolume,
      hourly: withHourly ? o.hourly : undefined, // only with ?symbol=, to keep the list small
    },
    decoupled: lastVsReopenPct != null && Math.abs(lastVsReopenPct) > DECOUPLED_PCT,
    onchainNote: e.onchainNote ?? (o && !hasRange ? `no usable swaps (in-range USDG >= ${MIN_POOL_USDG}) at or during this weekend` : null),
    reopenInsideRange: reopen && rangeLow != null ? reopen.price >= rangeLow && reopen.price <= rangeHigh : null,
    lastVsReopenPct,
  };
}

export function weekends({ symbol } = {}) {
  const ds = getDataset();
  const indexer = { running: state.running, done: state.done, total: state.total, step: state.step, error: state.error, builtAt: iso(state.lastBuiltAt), head: state.head };
  const method = {
    anchor: 'Friday close = last feed round at or before Saturday 12:00 UTC; reopen = the next round.',
    pool: 'Deepest USDG pool today (no free archive RPC exists for historical balances).',
    thinSwaps: `Swaps whose in-range virtual USDG is below ${MIN_POOL_USDG} are excluded and counted.`,
    range: 'Weekend range = low/high of hourly closing pool prices; single-swap extremes are reported separately.',
    decoupled: `A weekend is flagged decoupled when the pool's last price is more than ${DECOUPLED_PCT}% from the reopen; it is shown but left out of summary stats.`,
  };
  if (!ds) return { label: 'replay', ready: false, indexer, method, weekends: [] };
  const want = symbol?.toUpperCase();
  return {
    label: 'replay', ready: true, indexer, method, asOfBlock: ds.head, asOf: iso(ds.headTs),
    weekends: [...ds.weekends].reverse().map((w) => ({
      saturday: iso(w.sat).slice(0, 10),
      stocks: w.rows.filter((e) => !want || e.symbol === want).map((e) => row(e, ds.headTs, Boolean(want))),
    })),
  };
}
