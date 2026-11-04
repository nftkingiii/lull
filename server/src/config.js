// Every value here was verified by the project owner on 30 Oct 2026.
export const CHAIN_ID = 4663;
export const RPC_URL = process.env.LULL_RPC_URL ?? 'https://rpc.mainnet.chain.robinhood.com';
export const FEEDS_URL = 'https://reference-data-directory.vercel.app/feeds-robinhood-mainnet.json';
export const ASSETS_URL = 'https://api.robinhood.com/rhj/assets';
export const MORPHO_GQL = 'https://api.morpho.org/graphql';

export const UNIV3_FACTORY = '0x1f7d7550b1b028f7571e69a784071f0205fd2efa';
export const USDG = '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168';
export const USDG_DECIMALS = 6;
export const WETH = '0x0Bd7D308f8E1639FAb988df18a8011f41EacAD73';
export const FEE_TIERS = [100, 500, 3000, 10000];

// Pools holding less USDG than this are treated as empty (they report absurd prices).
export const MIN_POOL_USDG = Number(process.env.LULL_MIN_POOL_USDG ?? 100);
export const FEED_DECIMALS = 8;
