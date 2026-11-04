// What the last weekend trade "called" for the reopen, and whether it was right.
// Flat: the last trade sat within FLAT_PCT of the frozen feed (the reference shows −0.01% as flat).
// The hit rate keeps the original strict-sign rule so it stays comparable with 286 of 341.
export const FLAT_PCT = 0.05;

export const direction = (pct) => (pct == null ? null : Math.abs(pct) < FLAT_PCT ? 'flat' : pct > 0 ? 'higher' : 'lower');
export const tone = (pct) => (pct == null || Math.abs(pct) < FLAT_PCT ? 'flat' : pct > 0 ? 'up' : 'down');

/** Called correctly when the call matches the reopen's actual sign (reference: AAPL "lower" vs a
 *  −0.01% reopen is a hit; TSLA "flat" vs +0.28% is a miss). A flat call hits only an unchanged reopen. */
export function called(row) {
  const lt = row.onchain?.lastTrade;
  if (!lt || !row.reopen) return null;
  const g = row.reopen.vsFeedPct;
  const actual = g > 0 ? 'higher' : g < 0 ? 'lower' : 'flat';
  return direction(lt.vsFeedPct) === actual;
}

/** Hit rate across all weekends, computed the same way as before: sign(last) vs sign(gap),
 *  weekends with swaps only, decoupled pools left out. */
export function hitRate(weekends) {
  let hits = 0; let total = 0;
  for (const w of weekends) {
    for (const r of w.stocks) {
      if (!r.reopen || r.decoupled || !(r.onchain?.swaps > 0) || !r.gapPct || r.onchain.lastPct == null) continue;
      total++;
      if (Math.sign(r.onchain.lastPct) === Math.sign(r.gapPct)) hits++;
    }
  }
  return { hits, total };
}
