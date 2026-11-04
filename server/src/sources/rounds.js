// Full Chainlink round history per feed, read once via multicall and cached on disk.
import { client } from '../chain.js';
import { aggregatorAbi } from '../abi.js';
import { FEED_DECIMALS, HISTORY_START } from '../config.js';
import { splitRound, joinRound } from './feeds.js';
import { load, save } from '../store.js';

const CHUNK = 250;
const scale = 10 ** FEED_DECIMALS;

async function readRounds(proxy, phase, fromN, toN) {
  const ns = [];
  for (let n = fromN; n <= toN; n++) ns.push(n);
  const results = await client.multicall({
    contracts: ns.map((n) => ({ address: proxy, abi: aggregatorAbi, functionName: 'getRoundData', args: [joinRound(phase, n)] })),
    allowFailure: true,
  });
  return results.map((r, i) => (r.status === 'success' && r.result[3] > 0n
    ? { n: Number(ns[i]), phase: Number(phase), price: Number(r.result[1]) / scale, ts: Number(r.result[3]) }
    : null));
}

/** Walk a whole phase from round 1 until a round is missing (for phases that are no longer current). */
async function walkClosedPhase(proxy, phase) {
  const out = [];
  for (let n = 1n; ; n += BigInt(CHUNK)) {
    const got = await readRounds(proxy, phase, n, n + BigInt(CHUNK) - 1n);
    const ok = got.filter(Boolean);
    out.push(...ok);
    if (ok.length < got.length) return out;
  }
}

/** All rounds for a feed back to HISTORY_START, oldest first. Incremental across calls. */
export async function roundHistory(proxy) {
  const key = `rounds-${proxy.toLowerCase()}.json`;
  const cached = load(key, { rounds: [] });
  const [latestId] = await client.readContract({ address: proxy, abi: aggregatorAbi, functionName: 'latestRoundData' });
  const { phase, n: latestN } = splitRound(latestId);

  let rounds = cached.rounds;
  const have = rounds.filter((r) => r.phase === Number(phase));
  const startN = have.length ? BigInt(have.at(-1).n) + 1n : 1n;
  for (let n = startN; n <= latestN; n += BigInt(CHUNK)) {
    const end = n + BigInt(CHUNK) - 1n < latestN ? n + BigInt(CHUNK) - 1n : latestN;
    rounds.push(...(await readRounds(proxy, phase, n, end)).filter(Boolean));
  }
  // If the current phase began after HISTORY_START, earlier phases hold the rest.
  let p = phase - 1n;
  while (p >= 1n && rounds[0]?.ts > HISTORY_START && !rounds.some((r) => r.phase === Number(p))) {
    rounds = [...(await walkClosedPhase(proxy, p)), ...rounds];
    p -= 1n;
  }
  rounds.sort((a, b) => a.ts - b.ts || a.phase - b.phase || a.n - b.n);
  save(key, { rounds });
  return rounds;
}
