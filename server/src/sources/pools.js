import { getAddress } from 'viem';
import { client } from '../chain.js';
import { factoryAbi, poolAbi, erc20Abi } from '../abi.js';
import { UNIV3_FACTORY, USDG, USDG_DECIMALS, FEE_TIERS, MIN_POOL_USDG } from '../config.js';
import { cached } from '../http.js';

const ZERO = '0x0000000000000000000000000000000000000000';
const DAY = 86_400_000;
const usdg = getAddress(USDG);

/** Every non-empty token/USDG pool, deepest (most USDG) first. */
export async function usdgPools(token) {
  const addrs = await cached(`pools:${token}`, DAY, async () => {
    const found = await Promise.all(FEE_TIERS.map((fee) =>
      client.readContract({ address: UNIV3_FACTORY, abi: factoryAbi, functionName: 'getPool', args: [token, usdg, fee] })
        .then((pool) => ({ fee, pool }))));
    return found.filter((p) => p.pool !== ZERO);
  });
  const decimals = await cached(`dec:${token}`, DAY, () =>
    client.readContract({ address: token, abi: erc20Abi, functionName: 'decimals' }));

  const pools = await Promise.all(addrs.map(async ({ fee, pool }) => {
    const [bal, slot0, token0] = await Promise.all([
      client.readContract({ address: usdg, abi: erc20Abi, functionName: 'balanceOf', args: [pool] }),
      client.readContract({ address: pool, abi: poolAbi, functionName: 'slot0' }),
      cached(`t0:${pool}`, DAY, () => client.readContract({ address: pool, abi: poolAbi, functionName: 'token0' })),
    ]);
    const usdgHeld = Number(bal) / 10 ** USDG_DECIMALS;
    return { pool, fee, usdgHeld, price: priceFromSqrt(slot0[0], token0, token, Number(decimals)) };
  }));
  // Empty pools report absurd prices, so they are dropped rather than shown.
  return pools.filter((p) => p.usdgHeld >= MIN_POOL_USDG && p.price > 0).sort((a, b) => b.usdgHeld - a.usdgHeld);
}

/** USDG per one whole stock token, from sqrtPriceX96. */
export function priceFromSqrt(sqrtPriceX96, token0, token, tokenDecimals) {
  const ratio = (Number(sqrtPriceX96) / 2 ** 96) ** 2; // raw token1 per raw token0
  const stockIsToken0 = getAddress(token0) === getAddress(token);
  const raw = stockIsToken0 ? ratio : 1 / ratio; // raw USDG per raw stock
  return raw * 10 ** (tokenDecimals - USDG_DECIMALS);
}
