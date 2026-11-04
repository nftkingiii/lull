import { createPublicClient, http, defineChain } from 'viem';
import { CHAIN_ID, RPC_URL } from './config.js';

export const robinhoodChain = defineChain({
  id: CHAIN_ID,
  name: 'Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
});

// JSON-RPC batching instead of multicall: Multicall3 on 4663 is not verified.
export const client = createPublicClient({
  chain: robinhoodChain,
  transport: http(RPC_URL, { batch: { batchSize: 50 }, timeout: 20_000, retryCount: 2 }),
});
