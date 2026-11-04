// First block with timestamp >= ts. Interpolation search (block rate is steady, ~9.75/s since
// July) with a bisection fallback; results are cached on disk because they never change.
import { client } from '../chain.js';
import { load, save } from '../store.js';

const memo = load('blocks-by-ts.json', {});
const tsOf = async (n) => Number((await client.getBlock({ blockNumber: n })).timestamp);

export async function blockAtOrAfter(ts, head) {
  if (memo[ts]) return BigInt(memo[ts]);
  let lo = 1n; let tlo = await tsOf(lo);
  let hi = head.number; let thi = Number(head.timestamp);
  if (ts > thi) throw new Error(`timestamp ${ts} is after the chain head`);
  if (ts <= tlo) return lo;
  // Invariant: ts(lo) < ts <= ts(hi)
  const probe = async (g) => {
    if (g <= lo) g = lo + 1n;
    if (g >= hi) g = hi - 1n;
    if (g <= lo || g >= hi) return;
    const tg = await tsOf(g);
    if (tg < ts) { lo = g; tlo = tg; } else { hi = g; thi = tg; }
    return tg;
  };
  while (hi - lo > 1n) {
    const width = hi - lo;
    const rate = Number(width) / Math.max(1, thi - tlo); // blocks per second in this interval
    const g = lo + BigInt(Math.floor(Number(width) * ((ts - tlo) / Math.max(1, thi - tlo))));
    const tg = await probe(g);
    if (tg === undefined) break;
    // Overshoot on the other side of the target so both ends close in together.
    const margin = BigInt(Math.ceil(Math.abs(ts - tg) * rate * 1.5) + 16);
    await probe(tg < ts ? g + margin : g - margin);
    if ((hi - lo) * 2n > width) await probe((lo + hi) / 2n); // guarantee progress
  }
  memo[ts] = hi.toString();
  save('blocks-by-ts.json', memo);
  return hi;
}
