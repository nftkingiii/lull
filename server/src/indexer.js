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
import { blockTimestamps } from './sources/blocktime.js';
import { load, save } from './store.js';

const REFRESH_MS = Number(process.env.LULL_INDEX_REFRESH_MS ?? 10 * 60_000);
const DAY = 86_400;
const Q96 = 2n ** 96n;
const usdg = getAddress(USDG);
const SUMMARY_VERSION = 3; // bump to invalidate cached weekend summaries

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
 * Exact hour boundaries for a window: [firstBlock, hourStartTs] pairs, where firstBlock is the first
 * block whose header timestamp is at/after that hour (found by searching real headers). Swaps are
 * bucketed by block against these, so no swap time is ever estimated from block numbers.
 */
export async function hourBoundaries(closeTs, endTs, fromBlock, headBlock) {
  const out = [[Number(fromBlock), closeTs - (closeTs % 3600)]];
  let prev = { block: Number(fromBlock), ts: closeTs }; // fromBlock is the first block at/after closeTs
  for (let h = closeTs - (closeTs % 3600) + 3600; h < endTs; h += 3600) {
    const b = Number(await blockAtOrAfter(h, headBlock, prev.ts < h ? { block: prev.block - 1, ts: prev.ts - 1 } : undefined));
    out.push([b, h]);
    prev = { block: b, ts: h };
  }
  return out;
}

/**
 * Streaming weekend summary: feed swaps in block order, read the result at the end.
 * Membership is by block: [fromBlock, toBlock) is the freeze, earlier blocks are "before".
 * Highest, lowest and last trades keep their block so their exact time can be read afterwards.
 */
export function weekendAccumulator({ pool, token, decimals, closeTs, fromBlock, toBlock, hours: bounds }) {
  const usdgIsToken0 = getAddress(pool.token0) === usdg;
  const price = (s) => priceFromSqrt(s.sp, pool.token0, token, decimals);
  const usable = (s) => virtualUsdg(s, usdgIsToken0) >= MIN_POOL_USDG;
  let before = null; // last swap before the close block
  let low = null; let high = null; let last = null; // trades only
  let swaps = 0; let thin = 0; let volume = 0;
  const hours = new Map(); // hourStartTs -> [hourStartTs, open, high, low, close]
  let hi = 0; // index into bounds, advanced as blocks increase
  const bucket = (h, p) => {
    const c = hours.get(h);
    if (!c) hours.set(h, [h, p, p, p, p]);
    else { c[2] = Math.max(c[2], p); c[3] = Math.min(c[3], p); c[4] = p; }
  };
  let started = false;
  const start = () => {
    if (started) return;
    started = true;
    // The pool's standing price at the close opens the first hour (it is not a weekend trade).
    if (before && usable(before)) bucket(bounds[0][1], price(before));
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
      const p = price(s);
      if (!low || p < low.price) low = { price: p, block: s.b };
      if (!high || p > high.price) high = { price: p, block: s.b };
      last = { price: p, block: s.b };
      while (hi + 1 < bounds.length && bounds[hi + 1][0] <= s.b) hi++;
      bucket(bounds[hi][1], p);
    },
    result() {
      start();
      const standing = before && usable(before) ? price(before) : null;
      return {
        pool: pool.pool, fee: pool.fee,
        priceAtClose: standing,
        highTrade: high, lowTrade: low, lastTrade: last, // { price, block }, exact time added by build()
        // Legacy aggregates: include the standing price so a quiet weekend still has a level.
        low: low ? Math.min(low.price, standing ?? Infinity) : standing,
        high: high ? Math.max(high.price, standing ?? -Infinity) : standing,
        last: last ? last.price : standing,
        swaps, swapsExcludedThin: thin, usdgVolume: volume,
        hourly: [...hours.values()].sort((x, y) => x[0] - y[0]),
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
          const hours = await hourBoundaries(r.close.ts, r.reopen ? endTs : Number(headBlock.timestamp), fromBlock, headBlock);
          const acc = weekendAccumulator({ pool: r.s.pool, token: r.s.token, decimals: r.s.decimals, closeTs: r.close.ts, fromBlock: Number(fromBlock), toBlock: Number(toBlock), hours });
          // Search back only to where the previous weekend's scan ended, then reuse its last swap.
          const seen = lastSeen.get(r.s.pool.pool);
          const floor = seen && seen.block < fromBlock ? seen.block + 1n : historyBlock;
          acc.seed((await lastSwapAtOrBefore(r.s.pool.pool, fromBlock - 1n, floor)) ?? (seen && seen.block < fromBlock ? seen.swap : null));
          let lastScanned = null;
          await scanSwaps(r.s.pool.pool, fromBlock, toBlock, (x) => { acc.add(x); lastScanned = x; });
          lastSeen.set(r.s.pool.pool, { block: toBlock, swap: lastScanned ?? acc.before });
          entry.onchain = acc.result();
          const o = entry.onchain;
          const trades = [o.highTrade, o.lowTrade, o.lastTrade].filter(Boolean);
          const ts = await blockTimestamps(trades.map((t) => t.block));
          for (const t of trades) t.ts = ts.get(t.block);
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
