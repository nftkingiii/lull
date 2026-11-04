// Morpho Blue on Robinhood Chain. GraphQL is used only to list markets; every number about a
// position (shares, totals, oracle price, market params) is read on-chain.
import { parseAbi, getAddress } from 'viem';
import { client } from '../chain.js';
import { MORPHO_GQL, CHAIN_ID } from '../config.js';
import { cached, getJson } from '../http.js';
import { tokens } from './catalog.js';

export const MORPHO_BLUE = getAddress('0x9D53d5E3bd5E8d4Cbfa6DB1ca238AEA02E651010'); // from api.morpho.org, verified on-chain below

const blueAbi = parseAbi([
  'function position(bytes32 id, address user) view returns (uint256 supplyShares, uint128 borrowShares, uint128 collateral)',
  'function market(bytes32 id) view returns (uint128 totalSupplyAssets, uint128 totalSupplyShares, uint128 totalBorrowAssets, uint128 totalBorrowShares, uint128 lastUpdate, uint128 fee)',
  'function idToMarketParams(bytes32 id) view returns (address loanToken, address collateralToken, address oracle, address irm, uint256 lltv)',
]);
const oracleAbi = parseAbi(['function price() view returns (uint256)']);
const irmAbi = parseAbi([
  'function borrowRateView((address loanToken, address collateralToken, address oracle, address irm, uint256 lltv) marketParams, (uint128 totalSupplyAssets, uint128 totalSupplyShares, uint128 totalBorrowAssets, uint128 totalBorrowShares, uint128 lastUpdate, uint128 fee) market) view returns (uint256)',
]);

async function gql(query, variables) {
  const body = await getJson(MORPHO_GQL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query, variables }) });
  if (body.errors) throw new Error(`Morpho API: ${body.errors[0]?.message}`);
  return body.data;
}

/** Every Morpho market on 4663 whose on-chain collateral token is a Robinhood stock token. */
export function stockMarkets() {
  return cached('morpho-stock-markets', 10 * 60_000, async () => {
    const listed = [];
    for (let skip = 0; ; skip += 100) {
      const d = await gql(`query($skip:Int,$chain:[Int!]){ markets(first:100, skip:$skip, where:{chainId_in:$chain}) {
        pageInfo{countTotal} items { marketId collateralAsset{symbol address decimals} loanAsset{symbol address decimals} } } }`, { skip, chain: [CHAIN_ID] });
      listed.push(...d.markets.items);
      if (skip + 100 >= d.markets.pageInfo.countTotal) break;
    }
    const rh = new Map((await tokens()).map((t) => [t.address.toLowerCase(), t]));
    const candidates = listed.filter((m) => rh.has(m.collateralAsset?.address?.toLowerCase()));
    // Trust the chain, not the index: re-read params and keep only markets whose on-chain collateral is the RH token.
    const params = await client.multicall({
      contracts: candidates.map((m) => ({ address: MORPHO_BLUE, abi: blueAbi, functionName: 'idToMarketParams', args: [m.marketId] })),
      allowFailure: false,
    });
    return candidates.map((m, i) => {
      const [loanToken, collateralToken, oracle, irm, lltv] = params[i];
      const token = rh.get(collateralToken.toLowerCase());
      if (!token) return null;
      return {
        id: m.marketId, loanToken, collateralToken, oracle, irm, lltv,
        symbol: token.symbol, collateralDecimals: m.collateralAsset.decimals ?? token.decimals,
        loanSymbol: m.loanAsset?.symbol, loanDecimals: m.loanAsset?.decimals,
      };
    }).filter(Boolean);
  });
}

// Morpho's share math: VIRTUAL_SHARES = 1e6, VIRTUAL_ASSETS = 1, borrow assets round up.
const toAssetsUp = (shares, totalAssets, totalShares) =>
  (shares * (totalAssets + 1n) + (totalShares + 1_000_000n) - 1n) / (totalShares + 1_000_000n);

// Morpho's wTaylorCompounded: e^(x) - 1 to three terms, WAD-scaled.
const WAD = 10n ** 18n;
const wTaylor = (x, n) => {
  const first = x * n;
  const second = (first * first) / (2n * WAD);
  const third = (second * first) / (3n * WAD);
  return first + second + third;
};

/** On-chain positions of `wallet` in stock-collateral markets, with interest accrued to now. */
export async function walletPositions(wallet) {
  const markets = await stockMarkets();
  const positions = await client.multicall({
    contracts: markets.map((m) => ({ address: MORPHO_BLUE, abi: blueAbi, functionName: 'position', args: [m.id, wallet] })),
    allowFailure: false,
  });
  const open = markets.map((m, i) => ({ m, borrowShares: positions[i][1], collateral: positions[i][2] }))
    .filter((p) => p.borrowShares > 0n || p.collateral > 0n);
  if (!open.length) return { scanned: markets.length, positions: [] };

  const [states, prices, block] = await Promise.all([
    client.multicall({ contracts: open.map(({ m }) => ({ address: MORPHO_BLUE, abi: blueAbi, functionName: 'market', args: [m.id] })), allowFailure: false }),
    client.multicall({ contracts: open.map(({ m }) => ({ address: m.oracle, abi: oracleAbi, functionName: 'price' })), allowFailure: true }),
    client.getBlock(),
  ]);
  const rates = await client.multicall({
    contracts: open.map(({ m }, i) => ({
      address: m.irm, abi: irmAbi, functionName: 'borrowRateView',
      args: [{ loanToken: m.loanToken, collateralToken: m.collateralToken, oracle: m.oracle, irm: m.irm, lltv: m.lltv }, toMarketStruct(states[i])],
    })),
    allowFailure: true,
  });

  return {
    scanned: markets.length,
    block: Number(block.number),
    positions: open.map(({ m, borrowShares, collateral }, i) => {
      const s = states[i];
      let totalBorrow = s[2];
      const elapsed = block.timestamp - s[4];
      const accrued = rates[i].status === 'success' && elapsed > 0n;
      if (accrued) totalBorrow += (totalBorrow * wTaylor(rates[i].result, elapsed)) / WAD;
      const borrowRaw = toAssetsUp(borrowShares, totalBorrow, s[3]);
      return {
        m, borrowRaw, collateralRaw: collateral,
        oraclePriceRaw: prices[i].status === 'success' ? prices[i].result : null,
        oracleError: prices[i].status === 'success' ? null : (prices[i].error?.shortMessage ?? 'oracle price() reverted'),
        interestAccrued: accrued,
      };
    }),
  };
}

const toMarketStruct = (s) => ({ totalSupplyAssets: s[0], totalSupplyShares: s[1], totalBorrowAssets: s[2], totalBorrowShares: s[3], lastUpdate: s[4], fee: s[5] });
