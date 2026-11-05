import { useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { useApi } from './api.js';
import WeekendCard from './WeekendCard.jsx';
import { Ticker, Mode, Tag, ErrorState, Loading, Indexing } from './ui.jsx';
import { fmtPct, fmtUsdCompact, fmtLltv, longDay, hhmm, dayMonth, sinceShort } from './format.js';
import { direction, tone, called, hitRate } from './calls.js';

const isAddr = (s) => /^0x[0-9a-fA-F]{40}$/.test(s);
const SHOW = 8;

/** The weekend Tonight is about: the one still frozen if there is one, otherwise the latest. */
export function currentWeekend(weekends) {
  return weekends.find((w) => w.stocks.some((s) => s.status === 'ongoing')) ?? weekends[0];
}

function WalletCheck({ go }) {
  const [v, setV] = useState('');
  const [tried, setTried] = useState(false);
  const ok = isAddr(v.trim());
  return (
    <>
      <form className="field" onSubmit={(e) => { e.preventDefault(); setTried(true); if (ok) go(`positions/${v.trim()}`); }}>
        <label htmlFor="w" className="sr">Wallet address</label>
        <input id="w" value={v} onChange={(e) => setV(e.target.value)} placeholder="Wallet address" autoComplete="off" spellCheck={false} />
        <button className="btn" type="submit">Check<ArrowRight size={16} strokeWidth={1.5} aria-hidden="true" /></button>
      </form>
      <p className="hint">{tried && !ok ? 'A wallet address is 0x followed by 40 hex characters' : 'Read-only, no wallet connection or signature'}</p>
    </>
  );
}

function OtherStocks({ week, meta, symbol, go, live }) {
  const [all, setAll] = useState(false);
  const rows = week.stocks
    .filter((r) => r.onchain?.lastTrade && (live || r.reopen))
    .sort((a, b) => (meta[b.symbol]?.morpho.borrowed ?? 0) - (meta[a.symbol]?.morpho.borrowed ?? 0));
  const shown = all ? rows : rows.slice(0, SHOW);
  return (
    <section className="card" aria-labelledby="ot">
      <div className="card-head"><div className="k" id="ot">Same weekend, other stocks</div><Tag>{live ? 'Live' : 'Replay'}</Tag></div>
      <div className="rows">
        {shown.map((r) => {
          const lt = r.onchain.lastTrade;
          const miss = r.decoupled || called(r) === false;
          return (
            <button key={r.symbol} type="button" className="row" aria-pressed={r.symbol === symbol} onClick={() => go(`tonight/${r.symbol}`)}>
              <span className="tk">{r.symbol}</span>
              <div>
                <div className={miss ? 'miss' : ''}>{r.decoupled ? 'Pool decoupled' : `Called ${direction(lt.vsFeedPct)}`}</div>
                <div className="s num">last trade {fmtPct(lt.vsFeedPct)}</div>
              </div>
              {r.reopen
                ? <div className={`v num ${tone(r.reopen.vsFeedPct) === 'flat' ? '' : tone(r.reopen.vsFeedPct)}`}>{fmtPct(r.reopen.vsFeedPct)}<div className="s">reopened</div></div>
                : <div className="v"><div className="s">not reopened</div></div>}
            </button>
          );
        })}
      </div>
      {rows.length > SHOW && <button className="link" style={{ marginTop: 8 }} onClick={() => setAll(!all)}>{all ? 'Show fewer' : `Show all ${rows.length}`}</button>}
    </section>
  );
}

export default function Tonight({ symbol: wanted, meta, metaError, go }) {
  const symbol = (wanted || 'AAPL').toUpperCase();
  const list = useApi('/api/weekends', { refreshMs: 60_000 });
  const detail = useApi(`/api/weekends?symbol=${encodeURIComponent(symbol)}`, { refreshMs: 60_000 });

  if (list.error && !list.data) return <><div style={{ height: 24 }} /><ErrorState error={list.error} onRetry={list.reload} /></>;
  if (!list.data) return <><div style={{ height: 24 }} /><Loading /></>;
  if (!list.data.ready) return <><div style={{ height: 24 }} /><Indexing indexer={list.data.indexer} /></>;

  const week = currentWeekend(list.data.weekends);
  const live = week.stocks.some((s) => s.status === 'ongoing');
  const row = detail.data?.weekends.find((w) => w.saturday === week.saturday)?.stocks[0];
  const { hits, total } = hitRate(list.data.weekends);
  const m = meta[symbol];

  let headline = 'Reading the weekend';
  if (row?.reopen) headline = `Reopened ${longDay(row.reopen.at)} at ${hhmm(row.reopen.at)} UTC`;
  else if (row?.fridayClose) headline = `Frozen since ${longDay(row.fridayClose.at)} ${hhmm(row.fridayClose.at)} UTC`;

  return (
    <>
      <section className="head">
        <div>
          <Ticker stock={m} symbol={symbol} />
          <h1>{headline}</h1>
        </div>
        {live ? <Mode live>Live, as of {hhmm(list.data.asOf)} UTC</Mode> : <Mode>Replay of the weekend of {dayMonth(week.saturday)}</Mode>}
      </section>

      <main className="grid">
        <div className="stack">
          {detail.error ? <ErrorState error={detail.error} onRetry={detail.reload} />
            : !row ? <Loading>Reading {symbol}</Loading>
              : row.fridayClose ? <WeekendCard row={row} live={live} />
                : <div className="card state">{row.onchainNote ?? `No feed history for ${symbol} this weekend`}</div>}
        </div>

        <div className="stack">
          <section className="card" aria-labelledby="ex">
            <div className="card-head"><div className="k" id="ex">Borrowed against {symbol} on Morpho</div><Tag>Live</Tag></div>
            {metaError && !m ? <p className="hint">Couldn’t read Morpho: {metaError}</p> : (
              <div className="pair">
                <div><div className="k">Borrowed</div><div className="fig">{m ? fmtUsdCompact(m.morpho.borrowed) : '—'}</div></div>
                <div><div className="k">Max loan-to-value</div><div className="fig">{m ? fmtLltv(m.morpho.lltv) : '—'}</div></div>
              </div>
            )}
            <WalletCheck go={go} />
          </section>

          <OtherStocks week={week} meta={meta} symbol={symbol} go={go} live={live} />

          <section className="card" aria-labelledby="hr">
            <div className="card-head"><div className="k" id="hr">Weekends where the last trade called the direction</div><Tag>Replay</Tag></div>
            <div className="fig">{hits} of {total}</div>
            <div className="meter" aria-hidden="true"><i style={{ width: `${total ? (hits / total) * 100 : 0}%` }} /></div>
            <p className="hint">{list.data.stockCount} stocks since {sinceShort(list.data.historyStart)}, decoupled pools left out</p>
          </section>
        </div>
      </main>

      <p className="foot">
        Feed values are Chainlink rounds and trades are Uniswap v3 swaps in the deepest USDG pool, all read on Robinhood Chain; trade times come from block headers.
        Borrowed amounts are read live from Morpho Blue. The chart shows hourly closing trades; the highest and lowest single trades are listed separately.
      </p>
    </>
  );
}
