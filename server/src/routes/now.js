import { stockUniverse } from '../sources/catalog.js';
import { latestRound } from '../sources/feeds.js';
import { usdgPools } from '../sources/pools.js';
import { MIN_POOL_USDG } from '../config.js';

export async function now() {
  const { matched, unmatched, feedCount, tokenCount } = await stockUniverse();
  const at = Math.floor(Date.now() / 1000);
  const stocks = await Promise.all(matched.map(async ({ symbol, feed, token }) => {
    const row = { symbol, token: token.address, feed: feed.proxyAddress };
    try {
      const [round, pools] = await Promise.all([latestRound(feed.proxyAddress), usdgPools(token.address, token.decimals)]);
      const best = pools.find((p) => !p.empty) ?? null;
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
  return { label: 'live', at, feedCount, tokenCount, unmatchedFeeds: unmatched, stocks };
}
