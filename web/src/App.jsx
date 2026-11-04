import { useEffect, useState } from 'react';
import Tonight from './Tonight.jsx';
import Replay from './Replay.jsx';
import Positions from './Positions.jsx';

const TABS = [
  { id: 'tonight', label: 'Tonight' },
  { id: 'replay', label: 'Replay' },
  { id: 'positions', label: 'Positions' },
];

// Route lives in the hash: #tonight, #replay/<date>/<symbol>, #positions/<wallet>
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

  return (
    <div className="shell">
      <header className="masthead">
        <h1 className="brand">Lull<small>Robinhood Chain stocks while US markets sleep</small></h1>
        <span className="readonly">Read-only · no wallet connection · no transactions</span>
      </header>
      <nav className="tabs" role="tablist" aria-label="Views">
        {TABS.map((t) => (
          <button key={t.id} role="tab" className="tab" aria-selected={route.tab === t.id} onClick={() => go(t.id)}>{t.label}</button>
        ))}
      </nav>
      <main>
        {route.tab === 'tonight' && <Tonight />}
        {route.tab === 'replay' && <Replay date={route.rest[0]} symbol={route.rest[1]} onSelect={(d, s) => go(['replay', d, s].filter(Boolean).join('/'))} />}
        {route.tab === 'positions' && <Positions wallet={route.rest[0]} onWallet={(w) => go(`positions/${w}`)} />}
      </main>
    </div>
  );
}
