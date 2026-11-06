// The server's idea of "now". In production this is the wall clock and the chain head.
// For rehearsing a weekend on real past data, a test clock can pin "now" to an instant: the chain
// head then becomes the last block at or before it, so every read (feed rounds, swaps, block
// headers) is what the chain showed at that moment. The test clock is off unless
// LULL_TEST_CLOCK=1, and it can never turn on when NODE_ENV=production.
import { client } from './chain.js';
import { blockAtOrAfter } from './sources/blocks.js';

export const TEST_CLOCK = process.env.LULL_TEST_CLOCK === '1' && process.env.NODE_ENV !== 'production';
let fixed = null;

export function setTestNow(iso) {
  if (!TEST_CLOCK) throw Object.assign(new Error('test clock is disabled'), { status: 404 });
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) throw Object.assign(new Error('bad time'), { status: 400 });
  fixed = Math.floor(t / 1000);
}
if (TEST_CLOCK && process.env.LULL_TEST_NOW) setTestNow(process.env.LULL_TEST_NOW);
if (TEST_CLOCK) console.warn('lull: TEST CLOCK ENABLED, not for production');

export const nowSec = () => fixed ?? Math.floor(Date.now() / 1000);
/** ISO of the pinned instant, or null when running on the real clock. */
export const testNow = () => (fixed == null ? null : new Date(fixed * 1000).toISOString());

/** The chain head as of now: the real head, or the last block at or before the test instant. */
export async function headBlock() {
  const head = await client.getBlock();
  if (fixed == null) return head;
  if (fixed >= Number(head.timestamp)) return head;
  const first = await blockAtOrAfter(fixed + 1, head);
  return client.getBlock({ blockNumber: first - 1n });
}
