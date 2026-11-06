import { stockUniverse } from '../sources/catalog.js';
import { latestRound } from '../sources/feeds.js';
import { usdgPools } from '../sources/pools.js';
import { MIN_POOL_USDG } from '../config.js';
import { nowSec, testNow, headBlock } from '../clock.js';
import { roundHistory } from '../sources/rounds.js';
import { lastSwapAtOrBefore } from '../sources/poollogs.js';
import { priceFromSqrt } from '../sources/pools.js';

const REHEARSAL_LOOKBACK = 3_000_000n; // ~3.5 days of blocks to find the pool's last swap

/**
 * Under the test clock the RPC can't serve past state (no archive), so the same two numbers are read
 * from history instead: the latest feed round at or before "now", and the pool price after its last
 * swap at or before the head block. Production uses latestRoundData and slot0 directly.
 */
async function asOfHead(feed, token, best, head, at) {
  const rounds = (await roundHistory(feed.proxyAddress)).filter((r) => r.ts <= at);
  const r = rounds.at(-1);
  const round = { price: r.price, updatedAt: r.ts };
  if (!best) return { round, price: null };
  const s = await lastSwapAtOrBefore(best.pool, head.number, head.number - REHEARSAL_LOOKBACK);
  return { round, price: s ? priceFromSqrt(s.sp, best.token0, token.address, token.decimals) : null };
}

export async function now() {
  const { matched, unmatched, feedCount, tokenCount } = await stockUniverse();
  const rehearsal = testNow();
  const head = rehearsal ? await headBlock() : null;
  const at = rehearsal ? Number(head.timestamp) : nowSec();
  const stocks = await Promise.all(matched.map(async ({ symbol, feed, token }) => {
    const row = { symbol, token: token.address, feed: feed.proxyAddress };
    try {
      const pools = await usdgPools(token.address, token.decimals);
      let best = pools.find((p) => !p.empty) ?? null;
      let round;
      if (rehearsal) {
        const h = await asOfHead(feed, token, best, head, at);
        round = h.round;
        if (best) best = h.price == null ? null : { ...best, price: h.price };
      } else round = await latestRound(feed.proxyAddress);
      return {
        ...row,
        feedPrice: round.price,
        feedUpdatedAt: round.updatedAt,
        feedAgeSec: at - round.updatedAt,
        poolPrice: best?.price ?? null,
        pool: best ? { address: best.pool, fee: best.fee, usdgHeld: best.usdgHeld } : null,
        poolsFound: pools.length,
        noPoolReason: best ? null
          : pools.length ? `${pools.length} USDG pool(s), all below the ${MIN_POOL_USDG} USDG floor`
          : 'no USDG pool at any fee tier',
        driftPct: best ? ((best.price - round.price) / round.price) * 100 : null,
        error: null,
      };
    } catch (e) {
      // Per-stock failure is reported on that row; nothing is filled in.
      return { ...row, error: e.shortMessage ?? e.message };
    }
  }));
  stocks.sort((a, b) => Math.abs(b.driftPct ?? 0) - Math.abs(a.driftPct ?? 0));
  return { label: 'live', at, testClock: rehearsal, feedCount, tokenCount, unmatchedFeeds: unmatched, stocks };
}
