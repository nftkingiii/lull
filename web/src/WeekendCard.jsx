import WeekendChart from './WeekendChart.jsx';
import { Call } from './ui.jsx';
import { fmtPrice, fmtPct, fmtWhen, hhmm, dayCode } from './format.js';
import { tone } from './calls.js';

function Leg({ dot, label, when, price, change }) {
  return (
    <div className="leg">
      <span className={`dot${dot ? ` ${dot}` : ''}`} aria-hidden="true" />
      <div><div>{label}</div><div className="s num">{when}</div></div>
      <div className="v num">{price}<div className={`d${change?.cls ? ` ${change.cls}` : ''}`}>{change?.text}</div></div>
    </div>
  );
}

/** One weekend for one stock: status line, the chart, the FRI → MON route, and the journey legs. */
export default function WeekendCard({ row, live }) {
  const o = row.onchain;
  const lt = o?.lastTrade;
  const vs = (t) => (t ? { text: `${fmtPct(t.vsFeedPct)} vs feed`, cls: tone(t.vsFeedPct) === 'flat' ? '' : tone(t.vsFeedPct) } : null);
  const frozenH = Math.round(row.frozenHours);

  return (
    <section className="card" aria-labelledby={`wk-${row.symbol}`}>
      <h2 id={`wk-${row.symbol}`} className="sr">{row.symbol} weekend price path against the frozen feed</h2>
      <div className="status">
        <Call pct={lt?.vsFeedPct} />
        {lt && (
          <span className="res">
            Last trade <span className={`num ${tone(lt.vsFeedPct)}`}>{fmtPct(lt.vsFeedPct)}</span> vs frozen feed,{' '}
            {row.reopen
              ? <>feed reopened <span className="num">{fmtPct(row.reopen.vsFeedPct)}</span></>
              : <>feed expected to reopen <span className="num">{fmtWhen(row.expectedReopen)}</span>{row.reopenOverdue ? ', no round yet' : ''}</>}
          </span>
        )}
        {row.decoupled && <span className="res">Pool decoupled from the stock this weekend</span>}
      </div>

      <WeekendChart row={row} live={live} />

      <div className="route">
        <div className="port"><div className="code">{dayCode(row.fridayClose.at)}</div><div className="t num">{hhmm(row.fridayClose.at)} {row.feedMayUpdateUntil ? 'latest feed update' : 'feed froze'}</div></div>
        <div className="path" aria-hidden="true" />
        <div className="port end">
          <div className="code">{dayCode(row.reopen ? row.reopen.at : row.expectedReopen)}</div>
          <div className="t num">{row.reopen ? `${hhmm(row.reopen.at)} feed reopened` : `${hhmm(row.expectedReopen)} expected reopen`}</div>
        </div>
      </div>

      <div className="legs">
        {row.feedMayUpdateUntil
          ? <Leg dot="ring" label="Latest feed update" when={`${fmtWhen(row.fridayClose.at)}, latest Chainlink round`} price={fmtPrice(row.fridayClose.price)}
              change={{ text: `can still update until ${fmtWhen(row.feedMayUpdateUntil)}` }} />
          : <Leg dot="ring" label="Feed froze" when={`${fmtWhen(row.fridayClose.at)}, last Chainlink update`} price={fmtPrice(row.fridayClose.price)}
              change={{ text: row.reopen ? `frozen ${frozenH} hours` : `frozen ${frozenH} hours so far` }} />}
        {o?.highTrade
          ? <Leg label="Highest trade" when={fmtWhen(o.highTrade.at)} price={fmtPrice(o.highTrade.price)} change={vs(o.highTrade)} />
          : <Leg label="Highest trade" when={row.onchainNote ?? 'No weekend trades'} price="—" />}
        {o?.lowTrade && <Leg label="Lowest trade" when={fmtWhen(o.lowTrade.at)} price={fmtPrice(o.lowTrade.price)} change={vs(o.lowTrade)} />}
        {lt && <Leg dot="acc" label={row.reopen ? 'Last trade before reopen' : 'Latest trade'} when={fmtWhen(lt.at, { seconds: true })} price={fmtPrice(lt.price)} change={vs(lt)} />}
        {row.reopen
          ? <Leg dot="ring" label="Feed reopened" when={fmtWhen(row.reopen.at, { seconds: true })} price={fmtPrice(row.reopen.price)} change={{ text: `${fmtPct(row.reopen.vsFeedPct)} vs Friday` }} />
          : <Leg dot="ring" label="Feed expected to reopen" when={`${fmtWhen(row.expectedReopen)}, Sunday 20:00 New York`} price="—" change={{ text: row.reopenOverdue ? 'no round yet, later on market holidays' : 'first feed round after this' }} />}
      </div>
    </section>
  );
}
