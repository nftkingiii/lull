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
import { headBlock as clockHead, nowSec } from './clock.js';
import { weekendStart } from './time.js';

const REFRESH_MS = Number(process.env.LULL_INDEX_REFRESH_MS ?? 10 * 60_000);
// While a weekend is live, the latest trade, drift and call refresh this often (new blocks only).
const LIVE_REFRESH_MS = Number(process.env.LULL_LIVE_REFRESH_MS ?? 2 * 60_000);
const DAY = 86_400;
const Q96 = 2n ** 96n;
const usdg = getAddress(USDG);
const SUMMARY_VERSION = 4; // bump to invalidate cached weekend summaries (4: pool chosen by weekend volume)

export const state = { running: false, done: 0, total: 0, step: null, error: null, lastBuiltAt: null, head: null };
let dataset = null;
export const getDataset = () => dataset;

/**
 * Saturdays (00:00 UTC) from the first one on/after HISTORY_START whose weekend has started:
 * from Friday 16:00 New York (the regular close), so the current weekend is live as soon as the
 * feeds start freezing rather than at Saturday noon.
 */
export function saturdays(until) {
  const out = [];
  const first = new Date(HISTORY_START * 1000);
  first.setUTCDate(first.getUTCDate() + ((6 - first.getUTCDay() + 7) % 7));
  for (let t = first.getTime() / 1000; weekendStart(t) <= until; t += 7 * DAY) out.push(t);
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
    get volume() { return volume; },
  };
}

/** Append exact hour boundaries up to `endTs` (new hours that passed since the last run). */
async function extendHours(bounds, endTs, headBlock) {
  for (let h = bounds.at(-1)[1] + 3600; h < endTs; h += 3600) {
    const [pb, pts] = bounds.at(-1);
    bounds.push([Number(await blockAtOrAfter(h, headBlock, { block: pb - 1, ts: Math.max(pts, h - 3600) - 1 })), h]);
  }
}

/**
 * The pool a stock's weekend is read from, decided by that weekend's own trading: the USDG pool with
 * the most in-range USDG swap volume between the Friday close and the reopen. A tie at the top, or no
 * volume at all, falls back to today's deepest pool. Same answer on every machine, no archive state.
 */
function pickByVolume(cands, s) {
  const max = Math.max(0, ...cands.map((c) => c.acc.volume));
  const top = max > 0 ? cands.filter((c) => c.acc.volume === max) : cands;
  if (top.length === 1 && max > 0) return { ...top[0], by: 'volume' };
  const deepest = s.pools.find((p) => !p.empty && top.some((c) => c.pool.pool === p.pool));
  const c = deepest && top.find((x) => x.pool.pool === deepest.pool);
  return c ? { ...c, by: max > 0 ? 'volume tie, deepest today' : 'no volume, deepest today' } : null;
}

/** Open one candidate pool for a window: an accumulator seeded with the pool's last swap before the close. */
async function openCandidate(pool, r, fromBlock, toBlock, hours, lastSeen, historyBlock) {
  const acc = weekendAccumulator({ pool, token: r.s.token, decimals: r.s.decimals, closeTs: r.close.ts, fromBlock: Number(fromBlock), toBlock, hours });
  const seen = lastSeen.get(pool.pool);
  const floor = seen && seen.block < fromBlock ? seen.block + 1n : historyBlock;
  acc.seed((await lastSwapAtOrBefore(pool.pool, fromBlock - 1n, floor)) ?? (seen && seen.block < fromBlock ? seen.swap : null));
  return { pool, acc, scannedTo: fromBlock - 1n, lastSwap: null };
}

/** Scan new blocks for every candidate and remember where each scan ended for the next weekend. */
async function scanCandidates(cands, to, lastSeen) {
  for (const c of cands) {
    if (to <= c.scannedTo) continue;
    await scanSwaps(c.pool.pool, c.scannedTo + 1n, to, (x) => { c.acc.add(x); c.lastSwap = x; });
    c.scannedTo = to;
    lastSeen.set(c.pool.pool, { block: to, swap: c.lastSwap ?? c.acc.before });
  }
}

/** The chosen candidate's summary, with exact trade times and the volume behind the choice. */
async function summaryOf(win, cands) {
  const o = win.acc.result();
  const trades = [o.highTrade, o.lowTrade, o.lastTrade].filter(Boolean);
  const ts = await blockTimestamps(trades.map((t) => t.block));
  for (const t of trades) t.ts = ts.get(t.block);
  o.poolChoice = { by: win.by, volumes: cands.map((c) => ({ pool: c.pool.pool, fee: c.pool.fee, usdgVolume: c.acc.volume })) };
  return o;
}

// Live weekend state per stock, kept between runs so each refresh scans only new blocks.
const live = new Map(); // symbol -> { closeTs, hours, cands }

/**
 * A weekend that has not reopened yet: every candidate pool brought up to the head incrementally,
 * and the pool picked by volume so far (it can change until the reopen, then it is fixed).
 */
async function liveSummary(r, headBlock, lastSeen, historyBlock) {
  const head = headBlock.number;
  const nowTs = Number(headBlock.timestamp);
  let L = live.get(r.s.symbol);
  // Start over if the Friday close moved (a later extended-hours round) or the test clock went back.
  if (L && (L.closeTs !== r.close.ts || L.cands.some((c) => c.scannedTo > head))) L = null;
  if (!L) {
    const fromBlock = await blockAtOrAfter(r.close.ts, headBlock);
    const hours = await hourBoundaries(r.close.ts, nowTs, fromBlock, headBlock);
    const cands = [];
    for (const p of r.s.pools) cands.push(await openCandidate(p, r, fromBlock, Infinity, hours, lastSeen, historyBlock));
    L = { closeTs: r.close.ts, hours, cands };
    live.set(r.s.symbol, L);
  }
  await extendHours(L.hours, nowTs, headBlock);
  await scanCandidates(L.cands, head, lastSeen);
  const win = pickByVolume(L.cands, r.s);
  return win ? summaryOf(win, L.cands) : null;
}

async function build() {
  const headBlock = await clockHead();
  const nowTs = Number(headBlock.timestamp);
  const historyBlock = await blockAtOrAfter(HISTORY_START, headBlock);
  const { matched } = await stockUniverse();
  const sats = saturdays(nowTs);
  state.total = matched.length * (1 + sats.length);
  state.done = 0;

  const stocks = [];
  for (const m of matched) {
    state.step = `rounds ${m.symbol}`;
    // Only rounds that existed at the head (matters when the test clock pins "now" in the past).
    const rounds = (await roundHistory(m.feed.proxyAddress)).filter((r) => r.ts <= nowTs);
    const pools = await usdgPools(m.token.address, m.token.decimals);
    const pool = pools.find((p) => !p.empty) ?? null;
    state.done++;
    stocks.push({ symbol: m.symbol, token: m.token.address, decimals: m.token.decimals, feed: m.feed.proxyAddress, rounds, pool, pools, poolsFound: pools.length });
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
      else if (!r.s.pools.length) entry.onchainNote = 'no USDG pool for this token';
      else {
        const key = `wk-${day}-${r.s.symbol}.json`;
        const hit = r.reopen && load(key, null);
        if (hit && hit.v === SUMMARY_VERSION && hit.closeTs === r.close.ts && hit.reopenTs === r.reopen.ts) entry.onchain = hit.summary;
        else if (!r.reopen) {
          // Live: candidates kept between runs, only new blocks scanned.
          entry.onchain = await liveSummary(r, headBlock, lastSeen, historyBlock);
        } else {
          live.delete(r.s.symbol); // reopened: the final window is computed once, here, then cached
          // Each stock gets its own window: from its Friday close to its reopen.
          const fromBlock = await blockAtOrAfter(r.close.ts, headBlock);
          const toBlock = await blockAtOrAfter(r.reopen.ts, headBlock);
          const hours = await hourBoundaries(r.close.ts, r.reopen.ts, fromBlock, headBlock);
          const cands = [];
          for (const p of r.s.pools) cands.push(await openCandidate(p, r, fromBlock, Number(toBlock), hours, lastSeen, historyBlock));
          await scanCandidates(cands, toBlock, lastSeen);
          const win = pickByVolume(cands, r.s);
          entry.onchain = win ? await summaryOf(win, cands) : null;
          save(key, { v: SUMMARY_VERSION, closeTs: r.close.ts, reopenTs: r.reopen.ts, summary: entry.onchain });
        }
        if (!entry.onchain) entry.onchainNote = 'no USDG volume this weekend and every USDG pool is empty today';
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

let timer = null;
let current = null;

/** Run now (or wait for the run in progress, then run again so the result reflects the latest head). */
export async function refreshNow() {
  if (current) await current;
  current = runIndexer().finally(() => { current = null; });
  await current;
  schedule();
}

/** Next run: every LIVE_REFRESH_MS while a weekend is live, else REFRESH_MS, and always at the next weekend's start. */
function schedule() {
  clearTimeout(timer);
  const newest = dataset?.weekends.at(-1);
  const isLive = newest?.rows.some((r) => r.close && !r.reopen);
  let wait = isLive ? LIVE_REFRESH_MS : REFRESH_MS;
  const now = nowSec();
  let sat = Math.floor(now / DAY) * DAY;
  while (new Date(sat * 1000).getUTCDay() !== 6 || weekendStart(sat) <= now) sat += DAY;
  wait = Math.min(wait, (weekendStart(sat) - now) * 1000 + 5_000);
  timer = setTimeout(() => refreshNow().catch(() => {}), Math.max(wait, 5_000));
  timer.unref?.();
}

export function startIndexer() {
  refreshNow().catch(() => {});
}
