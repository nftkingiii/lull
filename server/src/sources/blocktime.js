// Exact block timestamps from batched eth_getBlockByNumber. This RPC returns blockTimestamp "0x0"
// on every log, so a swap's time always comes from its block header, never from block arithmetic.
// Batches of 10 stay inside the RPC's ~8-10 calls/s budget (measured 4 Nov); 429s back off.
import { pacedFetch } from '../chain.js';
import { RPC_URL } from '../config.js';
import { load, save } from '../store.js';

const BATCH = 10;
const memo = new Map(Object.entries(load('block-ts.json', {})).map(([k, v]) => [Number(k), v]));
let dirty = false;

async function fetchBatch(blocks) {
  for (let attempt = 0; ; attempt++) {
    const body = blocks.map((b, i) => ({ jsonrpc: '2.0', id: i, method: 'eth_getBlockByNumber', params: [`0x${b.toString(16)}`, false] }));
    const res = await pacedFetch(RPC_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const json = await res.json();
    if (Array.isArray(json) && json.every((r) => r.result)) {
      const out = new Map();
      for (const r of json) out.set(blocks[r.id], Number(BigInt(r.result.timestamp)));
      return out;
    }
    if (attempt >= 6) throw new Error(`eth_getBlockByNumber batch failed: ${JSON.stringify(json).slice(0, 160)}`);
    await new Promise((r) => setTimeout(r, 1000 * 2 ** Math.min(attempt, 4)));
  }
}

/** Map of block number -> unix timestamp, read from block headers (cached on disk). */
export async function blockTimestamps(blocks) {
  const need = [...new Set(blocks.map(Number))].filter((b) => !memo.has(b));
  for (let i = 0; i < need.length; i += BATCH) {
    if (i) await new Promise((r) => setTimeout(r, 1100)); // a batch of 10 costs 10 calls
    for (const [b, ts] of await fetchBatch(need.slice(i, i + BATCH))) memo.set(b, ts);
    dirty = true;
  }
  if (dirty) { save('block-ts.json', Object.fromEntries(memo)); dirty = false; }
  return new Map(blocks.map((b) => [Number(b), memo.get(Number(b))]));
}
