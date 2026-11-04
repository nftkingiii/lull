// Swap history for one pool over a block range, from eth_getLogs, streamed page by page.
// RPC limits (measured 4 Nov): single-value filters may span 10M blocks; multi-value only 100k;
// a query matching more than 10,000 logs is rejected (not truncated), and busy filters can
// time out server-side; both are split in half and retried. The busiest pools see ~10k swaps/hour,
// so callers get pages in block order and must not hold them all.
import { parseAbiItem, toEventSelector, decodeEventLog } from 'viem';
import { client } from '../chain.js';

const swapEvent = parseAbiItem('event Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)');
const SWAP = toEventSelector(swapEvent);
const MAX_SPAN = 10_000_000n;
const hex = (n) => `0x${n.toString(16)}`;
const DEBUG = process.env.LULL_DEBUG === '1';

/** Visit logs in [from, to] in block order, splitting ranges the RPC refuses. */
async function visitLogs(filter, from, to, onPage) {
  const t0 = Date.now();
  let logs;
  try {
    logs = await client.request({ method: 'eth_getLogs', params: [{ ...filter, fromBlock: hex(from), toBlock: hex(to) }] });
  } catch (e) {
    const msg = `${e.details ?? ''} ${e.message ?? ''}`;
    if (DEBUG) console.log('getLogs FAIL', filter.address.slice(0, 8), `${to - from + 1n} blocks`, `${Date.now() - t0}ms`, (e.details ?? e.shortMessage ?? '').slice(0, 80));
    if (/exceeds limit|timed out/i.test(msg) && to > from) {
      const mid = (from + to) / 2n;
      await visitLogs(filter, from, mid, onPage);
      await visitLogs(filter, mid + 1n, to, onPage);
      return;
    }
    throw e;
  }
  if (DEBUG) console.log('getLogs', filter.address.slice(0, 8), `${to - from + 1n} blocks`, `${logs.length} logs`, `${Date.now() - t0}ms`);
  onPage(logs);
}

const decode = (l) => {
  const { args } = decodeEventLog({ abi: [swapEvent], data: l.data, topics: l.topics });
  // No timestamp here: this RPC returns blockTimestamp "0x0" on every log (checked 4 Nov).
  return { b: Number(l.blockNumber), a0: args.amount0, a1: args.amount1, sp: args.sqrtPriceX96, liq: args.liquidity };
};

/** Call onSwap for every swap in [from, to], oldest first, without buffering the range. */
export async function scanSwaps(pool, from, to, onSwap) {
  for (let s = from; s <= to; s += MAX_SPAN) {
    const e = s + MAX_SPAN - 1n < to ? s + MAX_SPAN - 1n : to;
    await visitLogs({ address: pool, topics: [SWAP] }, s, e, (logs) => { for (const l of logs) onSwap(decode(l)); });
  }
}

/** The last swap at or before `block`, searching back in widening steps (bounded by `floorBlock`). */
export async function lastSwapAtOrBefore(pool, block, floorBlock) {
  for (let span = 20_000n; ; span *= 8n) {
    const from = block - span + 1n > floorBlock ? block - span + 1n : floorBlock;
    let last = null;
    await scanSwaps(pool, from, block, (s) => { last = s; });
    if (last) return last;
    if (from === floorBlock) return null;
  }
}
