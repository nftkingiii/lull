import { stockUniverse } from '../sources/catalog.js';
import { stockExposure } from '../sources/morpho.js';
import { cached } from '../http.js';

const KIND = /\b(ETF|Trust|Fund)\b/i;

/** Static facts per equity-feed stock: name and logo from api.robinhood.com, plus live Morpho exposure. */
export async function stocks() {
  const [{ matched }, exposure] = await Promise.all([stockUniverse(), cached('exposure', 60_000, stockExposure)]);
  const ex = new Map(exposure.map((e) => [e.symbol, e]));
  return {
    label: 'live',
    stocks: matched.map(({ symbol, token }) => {
      const name = String(token.name ?? '').split('•')[0].trim();
      return {
        symbol, token: token.address, logoUrl: token.logoUrl ?? null, name,
        kind: KIND.test(name) ? 'ETF token' : 'stock token',
        morpho: ex.get(symbol) ?? { symbol, borrowed: 0, marketsWithDebt: 0, lltv: null, mainMarket: null },
      };
    }),
  };
}
