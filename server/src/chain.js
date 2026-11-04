import { createPublicClient, http, defineChain } from 'viem';
import { CHAIN_ID, RPC_URL } from './config.js';

export const robinhoodChain = defineChain({
  id: CHAIN_ID,
  name: 'Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
});

// The public RPC rate-limits by call count, roughly 8-10 calls/s with small bursts
// (measured 4 Nov; a lone JSON-RPC batch of 60 eth_calls already gets 429). Multicall3 is
// deployed, and one aggregate eth_call carrying 100 reads passes. So: multicall-batch reads,
// space out HTTP requests, back off on 429.
export const MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11';
const MIN_GAP_MS = Number(process.env.LULL_RPC_GAP_MS ?? 150);
let nextSlot = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function slot() {
  const at = Math.max(Date.now(), nextSlot);
  nextSlot = at + MIN_GAP_MS;
  if (at > Date.now()) await sleep(at - Date.now());
}

export async function pacedFetch(url, init) {
  for (let attempt = 0; ; attempt++) {
    await slot();
    const res = await fetch(url, init);
    if (res.status !== 429 || attempt >= 6) return res;
    await sleep(1000 * 2 ** Math.min(attempt, 4));
  }
}

export const client = createPublicClient({
  chain: {
    ...robinhoodChain,
    contracts: { multicall3: { address: MULTICALL3 } },
  },
  batch: { multicall: { batchSize: 4096, wait: 30 } },
  transport: http(RPC_URL, { fetchFn: pacedFetch, timeout: 30_000, retryCount: 0 }),
});
