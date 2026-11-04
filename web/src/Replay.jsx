import { useApi } from './api.js';
import WeekendCard from './WeekendCard.jsx';
import { Ticker, Mode, Tag, ErrorState, Loading, Indexing } from './ui.jsx';
import { fmtPct, dowDayMonth, dayMonth } from './format.js';
import { direction, tone, called } from './calls.js';

function Outcome({ r }) {
  if (r.decoupled) return <span className="miss">Pool decoupled</span>;
  const lt = r.onchain?.lastTrade;
  if (!lt) return <span className="miss">No trades</span>;
  if (!r.reopen) return <span>Called {direction(lt.vsFeedPct)}</span>;
  const hit = called(r);
  return <span className={hit ? '' : 'miss'}>{hit ? 'Called' : 'Missed'} {direction(lt.vsFeedPct)}</span>;
}

export default function Replay({ symbol: wanted, date, meta, go }) {
  const symbol = (wanted || 'AAPL').toUpperCase();
  const detail = useApi(`/api/weekends?symbol=${encodeURIComponent(symbol)}`, { refreshMs: 60_000 });

  if (detail.error && !detail.data) return <><div style={{ height: 24 }} /><ErrorState error={detail.error} onRetry={detail.reload} /></>;
  if (!detail.data) return <><div style={{ height: 24 }} /><Loading /></>;
  if (!detail.data.ready) return <><div style={{ height: 24 }} /><Indexing indexer={detail.data.indexer} /></>;

  const weeks = detail.data.weekends;
  const pick = weeks.find((w) => w.saturday === date) ?? weeks.find((w) => w.stocks[0]?.status === 'closed') ?? weeks[0];
  const row = pick.stocks[0];
  const symbols = Object.keys(meta).sort();

  return (
    <>
      <section className="head">
        <div>
          <Ticker stock={meta[symbol]} symbol={symbol} />
          <h1>{weeks.length} weekends since 1 July</h1>
        </div>
        <Mode>Replay of the weekend of {dayMonth(pick.saturday)}</Mode>
      </section>

      <main className="grid">
        <div className="stack">
          {row?.fridayClose ? <WeekendCard row={row} /> : <div className="card state">{row?.onchainNote ?? 'No feed history for this weekend'}</div>}
        </div>

        <div className="stack">
          <section className="card" aria-labelledby="pk">
            <div className="k" id="pk">Stock</div>
            <div className="field" style={{ marginTop: 12 }}>
              <label htmlFor="sym" className="sr">Stock</label>
              <select id="sym" className="select" style={{ flex: 1 }} value={symbol} onChange={(e) => go(`replay/${e.target.value}/${pick.saturday}`)}>
                {(symbols.length ? symbols : [symbol]).map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <p className="hint">Pick a weekend in the table to replay it</p>
          </section>
        </div>
      </main>

      <section className="card" style={{ marginTop: 24 }} aria-labelledby="wks">
        <div className="card-head"><div className="k" id="wks">Every weekend for {symbol}</div><Tag>Replay</Tag></div>
        <div className="wk-head" aria-hidden="true">
          <span>Weekend</span><span>Stock</span><span>Last trade vs feed</span><span>Reopened vs Friday</span><span>Call</span>
        </div>
        <div className="rows" style={{ marginTop: 0 }}>
          {weeks.map((w) => {
            const r = w.stocks[0];
            const lt = r?.onchain?.lastTrade;
            return (
              <button key={w.saturday} type="button" className="row wk-row" aria-pressed={w.saturday === pick.saturday} onClick={() => go(`replay/${symbol}/${w.saturday}`)}>
                <span className="num">{dowDayMonth(w.saturday)}</span>
                <span className="tk">{symbol}</span>
                <span className={`num ${lt && !r.decoupled ? tone(lt.vsFeedPct) : 'miss'}`}>{lt ? fmtPct(lt.vsFeedPct) : '—'}</span>
                <span className="num">{r?.reopen ? fmtPct(r.reopen.vsFeedPct) : '—'}</span>
                <span>{r?.fridayClose ? <Outcome r={r} /> : <span className="miss">No feed yet</span>}</span>
              </button>
            );
          })}
        </div>
        <p className="hint">A pool is marked decoupled when its last trade sat more than 10% from where the feed reopened; those weekends are left out of the hit rate</p>
      </section>
    </>
  );
}
