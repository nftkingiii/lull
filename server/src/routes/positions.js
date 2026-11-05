import { isAddress, getAddress } from 'viem';
import { walletPositions } from '../sources/morpho.js';
import { stockUniverse } from '../sources/catalog.js';
import { latestRound } from '../sources/feeds.js';
import { usdgPools } from '../sources/pools.js';
import { getDataset } from '../indexer.js';
import { HISTORY_START } from '../config.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const since = (() => { const d = new Date(HISTORY_START * 1000); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`; })();

const pct = (a, b) => ((a - b) / b) * 100;

/** Worst (most negative) Friday-close -> Monday-reopen gap for a symbol across closed weekends. */
function worstGap(symbol) {
  const ds = getDataset();
  if (!ds) return null;
  let worst = null;
  for (const w of ds.weekends) {
    const e = w.rows.find((r) => r.symbol === symbol);
    if (!e?.close || !e.reopen) continue;
    const g = pct(e.reopen.price, e.close.price);
    if (!worst || g < worst.gapPct) worst = { gapPct: g, saturday: new Date(w.sat * 1000).toISOString().slice(0, 10) };
  }
  return worst;
}

export async function positions(wallet) {
  if (!isAddress(wallet)) {
    const err = new Error('not a valid wallet address');
    err.status = 400;
    throw err;
  }
  const user = getAddress(wallet);
  const [{ scanned, block, positions: raw }, { matched }] = await Promise.all([walletPositions(user), stockUniverse()]);
  const bySymbol = new Map(matched.map((m) => [m.symbol, m]));

  const out = await Promise.all(raw.map(async (p) => {
    const { m } = p;
    const coll = Number(p.collateralRaw) / 10 ** m.collateralDecimals;
    const borrowed = Number(p.borrowRaw) / 10 ** m.loanDecimals;
    const lltv = Number(m.lltv) / 1e18;
    const base = {
      marketId: m.id, symbol: m.symbol, collateralToken: m.collateralToken, loanSymbol: m.loanSymbol,
      lltv, collateral: coll, borrowed, interestAccrued: p.interestAccrued, oracle: m.oracle,
    };
    if (p.oraclePriceRaw == null) return { ...base, error: p.oracleError };

    // Oracle price: loan units per collateral unit, scaled 1e36 and by the decimals gap.
    const oraclePrice = (Number(p.oraclePriceRaw) / 1e36) * 10 ** (m.collateralDecimals - m.loanDecimals);
    const maxBorrow = coll * oraclePrice * lltv;
    const hf = borrowed > 0 ? maxBorrow / borrowed : null;
    const liquidationPrice = borrowed > 0 && coll > 0 ? borrowed / (coll * lltv) : null;

    // Feed and pool context (only for stocks with a Chainlink equity feed).
    const feedRef = bySymbol.get(m.symbol);
    let feed = null; let pool = null;
    if (feedRef) {
      const [round, pools] = await Promise.all([latestRound(feedRef.feed.proxyAddress), usdgPools(feedRef.token.address, feedRef.token.decimals)]);
      feed = { price: round.price, updatedAt: new Date(round.updatedAt * 1000).toISOString() };
      const best = pools.find((x) => !x.empty);
      pool = best ? { price: best.price, address: best.pool, fee: best.fee } : null;
    }

    // Scenarios move the oracle by the same ratio as the feed (the oracle tracks the feed within ~0.1%).
    const scenario = (name, price, basis) => {
      const hfAt = hf == null ? null : hf * (price / basis);
      return { label: 'scenario', name, price, movePct: pct(price, basis), healthFactor: hfAt, liquidated: hfAt != null && hfAt < 1 };
    };
    const scenarios = [];
    if (feed && pool) scenarios.push(scenario('Next reopen at the current pool price', pool.price, feed.price));
    const wg = worstGap(m.symbol);
    if (feed && wg) scenarios.push({ ...scenario(`Next reopen with the worst weekend gap since ${since} (${wg.saturday})`, feed.price * (1 + wg.gapPct / 100), feed.price), basedOn: 'replay' });

    return {
      ...base,
      label: 'live',
      oraclePrice,
      healthFactor: hf,
      liquidationPrice,
      distanceToLiquidationPct: liquidationPrice ? pct(liquidationPrice, oraclePrice) : null,
      feed, oracleVsFeedPct: feed ? pct(oraclePrice, feed.price) : null,
      pool,
      liquidatableNow: hf != null && hf < 1,
      scenarios,
      worstGapAvailable: Boolean(wg),
    };
  }));

  return { label: 'live', wallet: user, block, marketsScanned: scanned, positions: out };
}
