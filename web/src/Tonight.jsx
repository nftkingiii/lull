import { useApi } from './api.js';
import { fmtPrice, fmtPct, fmtAge, fmtCompact, shortAddr } from './format.js';
import { Pill, ErrorState, Loading, DriftBar } from './ui.jsx';

export default function Tonight() {
  const { data, error, loading, reload } = useApi('/api/now', { refreshMs: 30_000 });
  if (!data && error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <Loading>Reading 33 feeds and their pools on-chain…</Loading>;

  const priced = data.stocks.filter((s) => s.driftPct != null);
  const unpriced = data.stocks.filter((s) => s.driftPct == null);
  const maxAbs = Math.max(0.5, ...priced.map((s) => Math.abs(s.driftPct)));
  const ages = data.stocks.filter((s) => s.feedAgeSec != null).map((s) => s.feedAgeSec).sort((a, b) => a - b);
  const medianAge = ages[Math.floor(ages.length / 2)];
  const biggest = priced[0];
  const asOf = new Date(data.at * 1000);

  return (
    <section>
      <div className="section-head">
        <h2>Pool price vs Chainlink feed <Pill kind="live" /></h2>
        <span className="meta">
          {loading ? 'Refreshing…' : `Read ${asOf.toLocaleTimeString()} · refreshes every 30s`}
          {error && <> · <span style={{ color: 'var(--critical-text)' }}>last refresh failed: {error}</span></>}
        </span>
      </div>
      <p className="lede">
        While US markets are closed the Chainlink equity feeds stop updating, but the tokens keep trading in Uniswap pools.
        Drift is how far the deepest USDG pool sits from the last feed price.
      </p>

      <div className="stats">
        <div className="card stat">
          <div className="k">Median feed age <Pill kind="live" /></div>
          <div className="v">{fmtAge(medianAge)}</div>
          <div className="s">{data.feedCount} equity feeds</div>
        </div>
        <div className="card stat">
          <div className="k">Largest drift <Pill kind="live" /></div>
          <div className="v">{biggest ? fmtPct(biggest.driftPct) : '—'}</div>
          <div className="s">{biggest ? biggest.symbol : 'no priced pools'}</div>
        </div>
        <div className="card stat">
          <div className="k">Priced from a pool <Pill kind="live" /></div>
          <div className="v">{priced.length} / {data.stocks.length}</div>
          <div className="s">{unpriced.length} without a usable USDG pool</div>
        </div>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Stock</th>
              <th>Drift <Pill kind="live" /></th>
              <th>Pool price <Pill kind="live" /></th>
              <th>Feed price <Pill kind="live" /></th>
              <th>Feed age <Pill kind="live" /></th>
              <th>Pool USDG <Pill kind="live" /></th>
              <th>Pool</th>
            </tr>
          </thead>
          <tbody>
            {priced.map((s) => (
              <tr key={s.symbol}>
                <td className="sym">{s.symbol}</td>
                <td><span className="drift"><DriftBar value={s.driftPct} max={maxAbs} />{fmtPct(s.driftPct)}</span></td>
                <td>{fmtPrice(s.poolPrice)}</td>
                <td>{fmtPrice(s.feedPrice)}</td>
                <td>{fmtAge(s.feedAgeSec)}</td>
                <td>{fmtCompact(s.pool.usdgHeld)}</td>
                <td className="addr" title={s.pool.address}>{shortAddr(s.pool.address)} · {s.pool.fee / 10000}%</td>
              </tr>
            ))}
            {unpriced.map((s) => (
              <tr key={s.symbol}>
                <td className="sym">{s.symbol}</td>
                <td className="muted">—</td>
                <td className="muted">—</td>
                <td>{s.error ? '—' : fmtPrice(s.feedPrice)}</td>
                <td>{s.error ? '—' : fmtAge(s.feedAgeSec)}</td>
                <td colSpan={2} className="note">{s.error ? `Read failed: ${s.error}` : s.noPoolReason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data.unmatchedFeeds.length > 0 && <p className="meta">Feeds with no matching token: {data.unmatchedFeeds.join(', ')}</p>}
    </section>
  );
}
