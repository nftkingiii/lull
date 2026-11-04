import { useApi } from './api.js';
import { fmtPrice, fmtPct, fmtUtc, fmtCompact } from './format.js';
import { Pill, ErrorState, Loading } from './ui.jsx';
import WeekendChart from './WeekendChart.jsx';

function Indexing({ indexer, method }) {
  const pct = indexer.total ? (indexer.done / indexer.total) * 100 : 0;
  return (
    <div className="card card-pad">
      <strong>Building the weekend history from chain logs…</strong>
      <p className="meta" style={{ margin: '6px 0 0' }}>
        {indexer.error
          ? <span style={{ color: 'var(--critical-text)' }}>Indexer error: {indexer.error}. It retries on its next run.</span>
          : <>Step {indexer.done} of {indexer.total || '…'}: {indexer.step ?? 'starting'}. The first build reads millions of swap logs; later builds only add the newest weekend.</>}
      </p>
      <div className="progress" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${pct}%` }} /></div>
      <p className="meta">{method.anchor} {method.pool}</p>
    </div>
  );
}

const sign = (v) => (v > 0 ? 1 : v < 0 ? -1 : 0);

export default function Replay({ date, symbol, onSelect }) {
  const list = useApi('/api/weekends', { refreshMs: 15_000 });
  const detail = useApi(symbol ? `/api/weekends?symbol=${encodeURIComponent(symbol)}` : null);

  if (!list.data && list.error) return <ErrorState error={list.error} onRetry={list.reload} />;
  if (!list.data) return <Loading />;
  if (!list.data.ready) return <Indexing indexer={list.data.indexer} method={list.data.method} />;

  const weekends = list.data.weekends;
  const wk = weekends.find((w) => w.saturday === date) ?? weekends.find((w) => w.stocks.some((s) => s.status === 'closed')) ?? weekends[0];
  const rows = [...wk.stocks].sort((a, b) => Math.abs(b.gapPct ?? 0) - Math.abs(a.gapPct ?? 0));
  const ongoing = wk.stocks.some((s) => s.status === 'ongoing');

  // Weekend-level read: did the pool's last weekend price point the same way as the reopen gap?
  // Decoupled pools and weekends without swaps say nothing about the stock, so they sit out the stats.
  const usable = rows.filter((r) => !r.decoupled && r.onchain?.swaps > 0);
  const decoupled = rows.filter((r) => r.decoupled).length;
  const comparable = usable.filter((r) => r.gapPct != null && r.onchain.lastPct != null && sign(r.gapPct) !== 0);
  const sameWay = comparable.filter((r) => sign(r.onchain.lastPct) === sign(r.gapPct)).length;
  const inside = usable.filter((r) => r.reopenInsideRange === true).length;
  const withRange = usable.filter((r) => r.reopenInsideRange != null).length;
  const gaps = rows.filter((r) => r.gapPct != null).map((r) => Math.abs(r.gapPct)).sort((a, b) => a - b);
  const medianGap = gaps.length ? gaps[Math.floor(gaps.length / 2)] : null;

  const detailRow = detail.data?.weekends.find((w) => w.saturday === wk.saturday)?.stocks[0];

  return (
    <section>
      <div className="section-head">
        <h2>Weekend replay <Pill kind="replay" /></h2>
        <div className="controls">
          <label htmlFor="wk" className="meta">Weekend of</label>
          <select id="wk" value={wk.saturday} onChange={(e) => onSelect(e.target.value, symbol)}>
            {weekends.map((w) => (
              <option key={w.saturday} value={w.saturday}>
                Sat {new Date(`${w.saturday}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })}
                {w.stocks.some((s) => s.status === 'ongoing') ? ' (ongoing)' : ''}
              </option>
            ))}
          </select>
        </div>
      </div>
      <p className="lede">
        For each weekend since 1 July: the feed’s last price before the freeze, the range the deepest USDG pool traded in while it was frozen, and the price the feed reopened at.
        {ongoing && ' This weekend has not reopened yet, so reopen figures are blank.'}
      </p>

      <div className="stats">
        <div className="card stat">
          <div className="k">Median reopen gap <Pill kind="replay" /></div>
          <div className="v">{medianGap == null ? '—' : `${medianGap.toFixed(2)}%`}</div>
          <div className="s">absolute, Friday close → reopen</div>
        </div>
        <div className="card stat">
          <div className="k">Pool pointed the right way <Pill kind="replay" /></div>
          <div className="v">{comparable.length ? `${sameWay} / ${comparable.length}` : '—'}</div>
          <div className="s">last pool price vs Friday has the gap’s sign</div>
        </div>
        <div className="card stat">
          <div className="k">Reopen inside weekend range <Pill kind="replay" /></div>
          <div className="v">{withRange ? `${inside} / ${withRange}` : '—'}</div>
          <div className="s">hourly-close range{decoupled ? ` · ${decoupled} decoupled pool${decoupled > 1 ? 's' : ''} left out` : ''}</div>
        </div>
      </div>

      {symbol && (
        detail.error ? <ErrorState error={detail.error} onRetry={detail.reload} />
          : !detailRow ? <Loading>Loading {symbol}…</Loading>
            : detailRow.fridayClose ? <WeekendChart symbol={symbol} row={detailRow} />
              : <div className="card state">{detailRow.onchainNote}</div>
      )}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Stock</th>
              <th>Fri close <Pill kind="replay" /></th>
              <th>Weekend range <Pill kind="replay" /></th>
              <th>Extreme prints <Pill kind="replay" /></th>
              <th>Last pool <Pill kind="replay" /></th>
              <th>Reopen <Pill kind="replay" /></th>
              <th>Gap <Pill kind="replay" /></th>
              <th>Last vs reopen <Pill kind="replay" /></th>
              <th>Swaps <Pill kind="replay" /></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const o = r.onchain;
              const has = o && o.rangeLow != null;
              return (
                <tr key={r.symbol} className={`clickable${r.symbol === symbol ? ' selected' : ''}`} onClick={() => onSelect(wk.saturday, r.symbol)}
                  tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') onSelect(wk.saturday, r.symbol); }}>
                  <td className="sym">{r.symbol}</td>
                  <td title={r.fridayClose ? fmtUtc(r.fridayClose.at) : ''}>{r.fridayClose ? fmtPrice(r.fridayClose.price) : '—'}</td>
                  {has ? (
                    <>
                      <td title={`${fmtPrice(o.rangeLow)} – ${fmtPrice(o.rangeHigh)}`}>{fmtPct(o.rangeLowPct, 1)} to {fmtPct(o.rangeHighPct, 1)}</td>
                      <td className={o.extremeLow < o.rangeLow || o.extremeHigh > o.rangeHigh ? '' : 'muted'} title={`${fmtPrice(o.extremeLow)} – ${fmtPrice(o.extremeHigh)}`}>
                        {fmtPct(o.extremeLowPct, 1)} to {fmtPct(o.extremeHighPct, 1)}
                      </td>
                      <td>{fmtPrice(o.last)}{r.decoupled && <span className="pill pill-flag" title="The pool's last price was more than 10% from the reopen: it was not tracking the stock.">decoupled</span>}</td>
                    </>
                  ) : (
                    <td colSpan={3} className="note">{r.onchainNote ?? 'no on-chain data'}</td>
                  )}
                  <td title={r.reopen ? fmtUtc(r.reopen.at) : ''}>{r.reopen ? fmtPrice(r.reopen.price) : '—'}</td>
                  <td>{fmtPct(r.gapPct)}</td>
                  <td>{fmtPct(r.lastVsReopenPct)}</td>
                  <td title={o?.swapsExcludedThin ? `${o.swapsExcludedThin} thin-pool swaps excluded` : ''}>{o ? fmtCompact(o.swaps) : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="meta">
        Built from chain data up to block {list.data.asOfBlock.toLocaleString()} ({fmtUtc(list.data.asOf)}). {list.data.method.anchor} {list.data.method.range} {list.data.method.pool} {list.data.method.thinSwaps} {list.data.method.decoupled}
      </p>
    </section>
  );
}
