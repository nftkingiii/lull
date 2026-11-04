import { FEEDS_URL, ASSETS_URL } from '../config.js';
import { cached, getJson } from '../http.js';

const HOUR = 3_600_000;

/** Chainlink equity feeds only (docs.assetClass === "Equity"). */
export function equityFeeds() {
  return cached('feeds', HOUR, async () => {
    const all = await getJson(FEEDS_URL);
    return all
      .filter((f) => f?.docs?.assetClass === 'Equity' && f.proxyAddress)
      .map((f) => ({
        name: f.name,
        symbol: feedBaseSymbol(f),
        proxyAddress: f.proxyAddress,
        decimals: f.decimals,
        heartbeat: f.heartbeat,
        marketHours: f.docs?.marketHours,
      }));
  });
}

// Feed docs.baseAsset equals the token symbol for 32 of 33 equity feeds (checked 4 Nov).
// Known exceptions are listed here explicitly rather than fuzzy-matched.
const FEED_ALIASES = { RHDELL: 'DELL' };
function feedBaseSymbol(f) {
  const base = String(f.docs.baseAsset).trim().toUpperCase();
  return FEED_ALIASES[base] ?? base;
}

/** Robinhood tokenized assets, keyed by upper-case tokenSymbol. */
export function tokens() {
  return cached('assets', HOUR, async () => {
    const body = await getJson(ASSETS_URL);
    if (!Array.isArray(body?.assets)) throw new Error('assets API: unexpected response shape');
    return body.assets
      .filter((a) => a?.deployments?.[0]?.contractAddress)
      .map((a) => ({
        symbol: String(a.tokenSymbol).toUpperCase(),
        address: a.deployments[0].contractAddress,
        decimals: a.tokenDecimals,
        name: a.tokenName,
        logoUrl: a.logoUrl,
        multiplier: Number(a.currentMultiplier ?? 1),
        tradingCapabilities: a.tradingCapabilities,
      }));
  });
}

/** Pair each equity feed with its token. Unmatched feeds are reported, never guessed. */
export async function stockUniverse() {
  const [feeds, toks] = await Promise.all([equityFeeds(), tokens()]);
  const bySym = new Map(toks.map((t) => [t.symbol, t]));
  const matched = [];
  const unmatched = [];
  for (const feed of feeds) {
    const token = bySym.get(feed.symbol);
    if (token) matched.push({ symbol: feed.symbol, feed, token });
    else unmatched.push(feed.name);
  }
  return { matched, unmatched, feedCount: feeds.length, tokenCount: toks.length };
}
