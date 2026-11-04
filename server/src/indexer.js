// Background indexer for Replay. For each weekend since HISTORY_START it reads the feed's
// Friday close and Monday reopen from round history, then the deepest pool's swaps over the
// freeze. Closed weekends are immutable and cached on disk; the ongoing one is recomputed.
// Until the first full pass completes, consumers get progress, never partial or substitute data.
import { getAddress } from 'viem';
import { client } from './chain.js';
import { USDG, USDG_DECIMALS, MIN_POOL_USDG, HISTORY_START } from './config.js';
import { stockUniverse } from './sources/catalog.js';
import { usdgPools, priceFromSqrt } from './sources/pools.js';
import { roundHistory } from './sources/rounds.js';
import { scanSwaps, lastSwapAtOrBefore } from './sources/poollogs.js';
import { blockAtOrAfter } from './sources/blocks.js';
import { load, save } from './store.js';

const REFRESH_MS = Number(process.env.LULL_INDEX_REFRESH_MS ?? 10 * 60_000);
const DAY = 86_400;
const Q96 = 2n ** 96n;
const usdg = getAddress(USDG);
const SUMMARY_VERSION = 2; // bump to invalidate cached weekend summaries

export const state = { running: false, done: 0, total: 0, step: null, error: null, lastBuiltAt: null, head: null };
let dataset = null;
export const getDataset = () => dataset;

/** Saturdays (00:00 UTC) from the first one on/after HISTORY_START whose noon has passed. */
export function saturdays(until) {
  const out = [];
  const first = new Date(HISTORY_START * 1000);
  first.setUTCDate(first.getUTCDate() + ((6 - first.getUTCDay() + 7) % 7));
  for (let t = first.getTime() / 1000; t + DAY / 2 <= until; t += 7 * DAY) out.push(t);
  return out;
}

/** Feed close/reopen around a weekend, anchored at Saturday 12:00 UTC when feeds are frozen. */
export function closeAndReopen(rounds, sat) {
  const anchor = sat + DAY / 2;
  let ci = -1;
  for (let i = 0; i < rounds.length && rounds[i].ts <= anchor; i++) ci = i;
  return ci < 0 ? { close: null, reopen: null } : { close: rounds[ci], reopen: rounds[ci + 1] ?? null };
}

/** Virtual USDG in range at a swap: L*sqrtP (USDG token1) or L/sqrtP (USDG token0). Upper bound on usable USDG. */
function virtualUsdg(s, usdgIsToken0) {
  const raw = usdgIsToken0 ? (s.liq * Q96) / (s.sp || 1n) : (s.liq * s.sp) / Q96;
  return Number(raw) / 10 ** USDG_DECIMALS;
}

/**
 * Block -> timestamp inside a window, by linear interpolation between exact anchors. Logs carry no
 * usable timestamp, and the block rate is steady (~9.5-9.75/s), so 6-hour anchors are accurate to seconds.
 */
export async function windowClock(startTs, endTs, headBlock) {
  const anchorTs = [startTs];
  for (let t = Math.ceil(startTs / 21_600) * 21_600; t < endTs; t += 21_600) if (t > startTs) anchorTs.push(t);
  anchorTs.push(endTs);
  const anchors = [];
  for (const t of anchorTs) anchors.push([Number(await blockAtOrAfter(t, headBlock)), t]);
  return (b) => {
    let i = 1;
    while (i < anchors.length - 1 && anchors[i][0] <= b) i++;
    const [b0, t0] = anchors[i - 1]; const [b1, t1] = anchors[i];
    return b1 === b0 ? t0 : Math.round(t0 + ((b - b0) / (b1 - b0)) * (t1 - t0));
  };
}

/**
 * Streaming weekend summary: feed swaps in block order, read the result at the end.
 * Membership is by block: [fromBlock, toBlock) is the freeze, earlier blocks are "before".
 */
export function weekendAccumulator({ pool, token, decimals, closeTs, fromBlock, toBlock, clock }) {
  const usdgIsToken0 = getAddress(pool.token0) === usdg;
  const price = (s) => priceFromSqrt(s.sp, pool.token0, token, decimals);
  const usable = (s) => virtualUsdg(s, usdgIsToken0) >= MIN_POOL_USDG;
  let before = null; // last swap at or before the close
  let low = null; let high = null; let last = null;
  let swaps = 0; let thin = 0; let volume = 0;
  // Hourly OHLC keeps the chart honest without storing every swap.
  const hours = new Map();
  const point = (ts, p) => {
    low = low == null || p < low ? p : low;
    high = high == null || p > high ? p : high;
    last = p;
    const h = ts - (ts % 3600);
    const c = hours.get(h);
    if (!c) hours.set(h, [h, p, p, p, p]);
    else { c[2] = Math.max(c[2], p); c[3] = Math.min(c[3], p); c[4] = p; }
  };
  let started = false;
  const start = () => {
    if (started) return;
    started = true;
    if (before && usable(before)) point(closeTs, price(before));
  };
  return {
    seed(s) { if (s && s.b < fromBlock) before = s; },
    add(s) {
      if (s.b < fromBlock) { before = s; return; }
      if (s.b >= toBlock) return;
      start();
      swaps++;
      if (!usable(s)) { thin++; return; }
      volume += Math.abs(Number(usdgIsToken0 ? s.a0 : s.a1)) / 10 ** USDG_DECIMALS;
      point(clock(s.b), price(s));
    },
    result() {
      start();
      return {
        pool: pool.pool, fee: pool.fee,
        priceAtClose: before && usable(before) ? price(before) : null,
        low, high, last, swaps, swapsExcludedThin: thin, usdgVolume: volume,
        hourly: [...hours.values()], // [hourStartTs, open, high, low, close]
      };
    },
    get before() { return before; },
  };
}

async function build() {
  const headBlock = await client.getBlock();
  const nowTs = Number(headBlock.timestamp);
  const historyBlock = await blockAtOrAfter(HISTORY_START, headBlock);
  const { matched } = await stockUniverse();
  const sats = saturdays(nowTs);
  state.total = matched.length * (1 + sats.length);
  state.done = 0;

  const stocks = [];
  for (const m of matched) {
    state.step = `rounds ${m.symbol}`;
    const rounds = await roundHistory(m.feed.proxyAddress);
    const pools = await usdgPools(m.token.address, m.token.decimals);
    const pool = pools.find((p) => !p.empty) ?? null;
    state.done++;
    stocks.push({ symbol: m.symbol, token: m.token.address, decimals: m.token.decimals, feed: m.feed.proxyAddress, rounds, pool, poolsFound: pools.length });
  }

  const weekends = [];
  const lastSeen = new Map(); // pool -> { block, swap } from the previous weekend's scan
  for (const sat of sats) {
    const day = new Date(sat * 1000).toISOString().slice(0, 10);
    const rows = stocks.map((s) => ({ s, ...closeAndReopen(s.rounds, sat) }));
    const out = [];
    for (const r of rows) {
      state.step = `weekend ${day} ${r.s.symbol}`;
      const entry = { symbol: r.s.symbol, close: r.close, reopen: r.reopen, onchain: null, onchainNote: null };
      if (!r.close) entry.onchainNote = 'feed has no round before this weekend';
      else if (!r.s.pool) entry.onchainNote = r.s.poolsFound ? 'every USDG pool for this token is empty today' : 'no USDG pool for this token';
      else {
        const key = `wk-${day}-${r.s.pool.pool.toLowerCase()}.json`;
        const hit = r.reopen && load(key, null);
        if (hit && hit.v === SUMMARY_VERSION && hit.closeTs === r.close.ts && hit.reopenTs === r.reopen.ts) entry.onchain = hit.summary;
        else {
          // Each stock gets its own window: from its Friday close to its reopen (or now).
          const endTs = r.reopen ? r.reopen.ts : nowTs;
          const fromBlock = await blockAtOrAfter(r.close.ts, headBlock);
          const toBlock = r.reopen ? await blockAtOrAfter(endTs, headBlock) : headBlock.number;
          const clock = await windowClock(r.close.ts, r.reopen ? endTs : Number(headBlock.timestamp), headBlock);
          const acc = weekendAccumulator({ pool: r.s.pool, token: r.s.token, decimals: r.s.decimals, closeTs: r.close.ts, fromBlock: Number(fromBlock), toBlock: Number(toBlock), clock });
          // Search back only to where the previous weekend's scan ended, then reuse its last swap.
          const seen = lastSeen.get(r.s.pool.pool);
          const floor = seen && seen.block < fromBlock ? seen.block + 1n : historyBlock;
          acc.seed((await lastSwapAtOrBefore(r.s.pool.pool, fromBlock - 1n, floor)) ?? (seen && seen.block < fromBlock ? seen.swap : null));
          let lastScanned = null;
          await scanSwaps(r.s.pool.pool, fromBlock, toBlock, (x) => { acc.add(x); lastScanned = x; });
          lastSeen.set(r.s.pool.pool, { block: toBlock, swap: lastScanned ?? acc.before });
          entry.onchain = acc.result();
          if (r.reopen) save(key, { v: SUMMARY_VERSION, closeTs: r.close.ts, reopenTs: r.reopen.ts, summary: entry.onchain });
        }
      }
      out.push(entry);
      state.done++;
    }
    weekends.push({ sat, rows: out });
  }
  return { head: Number(headBlock.number), headTs: nowTs, builtAt: Math.floor(Date.now() / 1000), weekends };
}

export async function runIndexer() {
  if (state.running) return;
  state.running = true;
  state.error = null;
  try {
    dataset = await build();
    state.lastBuiltAt = dataset.builtAt;
    state.head = dataset.head;
    state.step = 'idle';
  } catch (e) {
    state.error = e.shortMessage ?? e.message;
    console.error('indexer:', e);
  } finally {
    state.running = false;
  }
}

export function startIndexer() {
  runIndexer();
  setInterval(runIndexer, REFRESH_MS).unref();
}
