import { useEffect, useState } from 'react';
import { ArrowRight, Check, TriangleAlert } from 'lucide-react';
import { useApi } from './api.js';
import { Mode, Tag, ErrorState, Loading } from './ui.jsx';
import { fmtPrice, fmtPct, fmtNum, fmtLltv, shortAddr } from './format.js';

const isAddr = (s) => /^0x[0-9a-fA-F]{40}$/.test(s);
const ICON = { size: 16, strokeWidth: 1.5, 'aria-hidden': true };

function Position({ p, stock }) {
  if (p.error) {
    return <div className="card"><div className="pos-top"><span className="tk">{p.symbol}</span></div><p className="hint">Oracle read failed: {p.error}</p></div>;
  }
  const debt = p.borrowed > 0;
  return (
    <section className="card pos" aria-label={`${p.symbol} position`}>
      <div className="pos-top">
        {stock?.logoUrl ? <img src={stock.logoUrl} alt="" width="24" height="24" style={{ borderRadius: 6, background: '#f2f2f2' }} /> : null}
        <span className="tk">{p.symbol}</span>
        <span className="k">borrowing {p.loanSymbol}, max loan-to-value {fmtLltv(p.lltv)}</span>
        <span style={{ marginLeft: 'auto' }}><Tag>Live</Tag></span>
      </div>
      <div className="figs">
        <div><div className="k">Health</div><div className={`fig ${p.liquidatableNow ? 'down' : ''}`}>{p.healthFactor == null ? 'No debt' : p.healthFactor.toFixed(3)}</div></div>
        <div><div className="k">Liquidation price</div><div className="fig">{fmtPrice(p.liquidationPrice)}</div></div>
        <div><div className="k">Oracle price</div><div className="fig">{fmtPrice(p.oraclePrice)}</div></div>
        <div><div className="k">Borrowed {p.loanSymbol}</div><div className="fig">{fmtNum(p.borrowed)}</div></div>
      </div>
      <p className="hint" style={{ margin: 0 }}>
        {fmtNum(p.collateral, 4)} {p.symbol} collateral. Liquidation is {fmtPct(p.distanceToLiquidationPct, 1)} vs the oracle price, and the oracle is {fmtPct(p.oracleVsFeedPct, 3)} vs the Chainlink feed
      </p>
      {debt && (
        <div className="scen">
          {p.scenarios.map((s) => (
            <div className="scen-row" key={s.name}>
              <div>
                <div>{s.name.replace('Next reopen', 'If the next reopen is').replace('at the current pool price', 'at today’s pool price')
                  .replace(/ \((\d{4})-(\d{2})-(\d{2})\)/, (_, y, mo, da) => `, weekend of ${Number(da)} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(mo) - 1]}`)}</div>
                <div className="hint" style={{ margin: 0 }}><Tag>Scenario</Tag> <span className="num">{fmtPrice(s.price)}, {fmtPct(s.movePct, 2)} vs feed</span></div>
              </div>
              <div className="num">health {s.healthFactor.toFixed(3)}</div>
              <div className={`verdict ${s.liquidated ? 'down' : ''}`}>
                {s.liquidated ? <TriangleAlert {...ICON} /> : <Check {...ICON} />}{s.liquidated ? 'Liquidated' : 'Survives'}
              </div>
            </div>
          ))}
          {!p.scenarios.length && <p className="hint">No reopen scenario: this token has no Chainlink feed or usable pool</p>}
          {!p.worstGapAvailable && p.feed && <p className="hint">The worst-gap scenario appears once the weekend history has been built</p>}
        </div>
      )}
    </section>
  );
}

export default function Positions({ wallet, meta, go }) {
  const [v, setV] = useState(wallet ?? '');
  useEffect(() => { setV(wallet ?? ''); }, [wallet]);
  const ok = isAddr(v.trim());
  const res = useApi(wallet && isAddr(wallet) ? `/api/positions/${wallet}` : null);

  return (
    <>
      <section className="head">
        <div><h1>Loans against stock tokens</h1></div>
        <Mode live>Live{res.data ? `, block ${res.data.block?.toLocaleString() ?? '—'}` : ''}</Mode>
      </section>

      <div className="stack">
        <section className="card" aria-labelledby="wl">
          <div className="k" id="wl">Morpho positions backed by Robinhood stock tokens, with where each liquidates and what the next reopen could do</div>
          <form className="field" onSubmit={(e) => { e.preventDefault(); if (ok) go(`positions/${v.trim()}`); }}>
            <label htmlFor="pw" className="sr">Wallet address</label>
            <input id="pw" value={v} onChange={(e) => setV(e.target.value)} placeholder="Wallet address" autoComplete="off" spellCheck={false} />
            <button className="btn" type="submit">Check<ArrowRight {...ICON} /></button>
          </form>
          <p className="hint">{v && !ok ? 'A wallet address is 0x followed by 40 hex characters' : 'Read-only, no wallet connection or signature'}</p>
        </section>

        {wallet && !isAddr(wallet) && <ErrorState error="That is not a valid wallet address" />}
        {res.error && <ErrorState error={res.error} onRetry={res.reload} />}
        {res.loading && <Loading>Scanning every stock-collateral Morpho market for {shortAddr(wallet)}</Loading>}
        {res.data && !res.loading && (res.data.positions.length === 0
          ? <div className="card state">No stock-collateral positions for {shortAddr(res.data.wallet)} across {res.data.marketsScanned} Morpho markets</div>
          : res.data.positions.map((p) => <Position key={p.marketId} p={p} stock={meta[p.symbol]} />))}
        {res.data && <p className="foot" style={{ marginTop: 0 }}>Read at block {res.data.block?.toLocaleString()} from Morpho Blue. Scenarios move the oracle by the same ratio as the Chainlink feed, which it tracks within about 0.1%</p>}
      </div>
    </>
  );
}
