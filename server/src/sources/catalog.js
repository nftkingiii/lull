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

// Feed names look like "AAPL / USD"; docs.baseAsset is preferred when present.
// UNVERIFIED: field names beyond docs.assetClass, marketHours and proxyAddress were not checked.
function feedBaseSymbol(f) {
  return String(f.docs?.baseAsset ?? String(f.name).split('/')[0]).trim().toUpperCase();
}

/** Robinhood tokenized assets, keyed by upper-case tokenSymbol. */
export function tokens() {
  return cached('assets', HOUR, async () => {
    const body = await getJson(ASSETS_URL);
    // UNVERIFIED: the envelope shape (bare array vs { results }) was not checked.
    const list = Array.isArray(body) ? body : body.results ?? body.data ?? [];
    return list
      .filter((a) => a?.deployments?.[0]?.contractAddress)
      .map((a) => ({
        symbol: String(a.tokenSymbol).toUpperCase(),
        address: a.deployments[0].contractAddress,
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
