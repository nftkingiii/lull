import { useEffect, useState } from 'react';
import { Moon } from 'lucide-react';
import Tonight from './Tonight.jsx';
import Replay from './Replay.jsx';
import Positions from './Positions.jsx';
import { useApi } from './api.js';

const TABS = [
  { id: 'tonight', label: 'Tonight' },
  { id: 'replay', label: 'Replay' },
  { id: 'positions', label: 'Positions' },
];

// Route lives in the hash: #tonight/AAPL, #replay/AAPL/2026-10-24, #positions/0x…
function parseHash() {
  const [tab, ...rest] = window.location.hash.replace(/^#\/?/, '').split('/');
  return { tab: TABS.some((t) => t.id === tab) ? tab : 'tonight', rest };
}

export default function App() {
  const [route, setRoute] = useState(parseHash);
  useEffect(() => {
    const on = () => setRoute(parseHash());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  const go = (path) => { window.location.hash = path; };
  const stocks = useApi('/api/stocks');
  const meta = Object.fromEntries((stocks.data?.stocks ?? []).map((s) => [s.symbol, s]));

  return (
    <div className="wrap">
      <header className="bar">
        <div className="brand"><Moon size={18} strokeWidth={1.5} aria-hidden="true" /><span>Lull</span></div>
        <nav className="seg" role="tablist" aria-label="Sections">
          {TABS.map((t) => (
            <button key={t.id} role="tab" aria-selected={route.tab === t.id} onClick={() => go(t.id)}>{t.label}</button>
          ))}
        </nav>
      </header>
      {route.tab === 'tonight' && <Tonight symbol={route.rest[0]} meta={meta} metaError={stocks.error} go={go} />}
      {route.tab === 'replay' && <Replay symbol={route.rest[0]} date={route.rest[1]} meta={meta} go={go} />}
      {route.tab === 'positions' && <Positions wallet={route.rest[0]} meta={meta} go={go} />}
    </div>
  );
}
