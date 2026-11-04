import { client } from '../chain.js';
import { aggregatorAbi } from '../abi.js';
import { FEED_DECIMALS } from '../config.js';

const scale = 10 ** FEED_DECIMALS;

// Feed answers already include the corporate-action multiplier; never apply it again.
export async function latestRound(proxy) {
  const [roundId, answer, , updatedAt] = await client.readContract({
    address: proxy, abi: aggregatorAbi, functionName: 'latestRoundData',
  });
  return toRound(roundId, answer, updatedAt);
}

export async function roundAt(proxy, roundId) {
  const [rid, answer, , updatedAt] = await client.readContract({
    address: proxy, abi: aggregatorAbi, functionName: 'getRoundData', args: [roundId],
  });
  return toRound(rid, answer, updatedAt);
}

// roundId = (phase << 64) + n
export const splitRound = (id) => ({ phase: id >> 64n, n: id & ((1n << 64n) - 1n) });
export const joinRound = (phase, n) => (phase << 64n) + n;

function toRound(roundId, answer, updatedAt) {
  return { roundId, price: Number(answer) / scale, updatedAt: Number(updatedAt) };
}
