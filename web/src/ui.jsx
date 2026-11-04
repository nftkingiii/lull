import { useState } from 'react';
import { ArrowDown, ArrowUp, Minus, CircleAlert } from 'lucide-react';
import { direction } from './calls.js';

const ICON = { size: 16, strokeWidth: 1.5, 'aria-hidden': true };

/** Provenance label, sentence case: Live, Replay or Scenario. */
export const Tag = ({ children }) => <span className="tag">{children}</span>;

/** Robinhood logo (from api.robinhood.com logoUrl) + symbol + description. No drawn logos. */
export function Ticker({ stock, symbol }) {
  const [broken, setBroken] = useState(false);
  return (
    <div className="ticker">
      {stock?.logoUrl && !broken
        ? <img src={stock.logoUrl} alt="" width="32" height="32" onError={() => setBroken(true)} />
        : <span className="tk" style={{ width: 48 }} aria-hidden="true">{symbol}</span>}
      <span><b>{symbol}</b> {stock ? `${stock.name} ${stock.kind} on Robinhood Chain` : 'on Robinhood Chain'}</span>
    </div>
  );
}

export function Mode({ live, children }) {
  return <div className={`mode${live ? ' live' : ''}`}><i aria-hidden="true" />{children}</div>;
}

export function Call({ pct, miss }) {
  const dir = direction(pct);
  if (!dir) return <span className="call miss">No weekend trades</span>;
  const Icon = dir === 'higher' ? ArrowUp : dir === 'lower' ? ArrowDown : Minus;
  const cls = miss ? 'miss' : dir === 'higher' ? 'up' : dir === 'lower' ? 'down' : 'flat';
  return <span className={`call ${cls}`}><Icon {...ICON} />Called {dir}</span>;
}

export function ErrorState({ error, onRetry }) {
  return (
    <div className="card state err" role="alert">
      <CircleAlert {...ICON} size={18} />
      <div>
        <div>Couldn’t read this data</div>
        <div className="hint">{error}. Nothing is shown in its place.</div>
        {onRetry && <button className="link" style={{ marginTop: 8 }} onClick={onRetry}>Try again</button>}
      </div>
    </div>
  );
}

export const Loading = ({ children = 'Reading chain data' }) => <div className="card state" aria-busy="true">{children}</div>;

export function Indexing({ indexer }) {
  const pct = indexer.total ? (indexer.done / indexer.total) * 100 : 0;
  return (
    <div className="card" aria-busy="true">
      <div className="k">Building the weekend history from chain logs</div>
      <p className="hint">
        {indexer.error ? `Indexer error: ${indexer.error}. It retries on its next run` : `Step ${indexer.done} of ${indexer.total || '…'}, ${indexer.step ?? 'starting'}`}
      </p>
      <div className="progress" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${pct}%` }} /></div>
    </div>
  );
}
