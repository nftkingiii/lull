import { useState, useEffect } from 'react';
import { useApi } from './api.js';
import { fmtPrice, fmtPct, fmtNum, shortAddr, fmtUtc } from './format.js';
import { Pill, ErrorState, Loading, Verdict } from './ui.jsx';

const isAddr = (s) => /^0x[0-9a-fA-F]{40}$/.test(s);

function Position({ p }) {
  if (p.error) {
    return (
      <div className="card card-pad">
        <div className="pos-head"><h3>{p.symbol} collateral</h3><span className="addr">{shortAddr(p.marketId)}</span></div>
        <p className="state error">Oracle read failed: {p.error}</p>
      </div>
    );
  }
  const hasDebt = p.borrowed > 0;
  return (
    <div className="card card-pad">
      <div className="pos-head">
        <h3>{p.symbol} → {p.loanSymbol} <span className="meta">LLTV {(p.lltv * 100).toFixed(1)}%</span></h3>
        <span className="addr" title={p.marketId}>market {shortAddr(p.marketId)}</span>
      </div>

      <div className="kv">
        <div><span className="k">Collateral <Pill kind="live" /></span><span className="v">{fmtNum(p.collateral, 4)} {p.symbol}</span></div>
        <div><span className="k">Borrowed <Pill kind="live" /></span><span className="v">{p.borrowed.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {p.loanSymbol}</span></div>
        <div><span className="k">Health factor <Pill kind="live" /></span><span className="v">{p.healthFactor == null ? 'no debt' : p.healthFactor.toFixed(3)}</span></div>
        <div><span className="k">Liquidation price <Pill kind="live" /></span><span className="v">{fmtPrice(p.liquidationPrice)}</span></div>
        <div><span className="k">Oracle price <Pill kind="live" /></span><span className="v">{fmtPrice(p.oraclePrice)}</span></div>
        <div><span className="k">Move to liquidation <Pill kind="live" /></span><span className="v">{fmtPct(p.distanceToLiquidationPct, 1)}</span></div>
        <div><span className="k">Feed price <Pill kind="live" /></span><span className="v">{p.feed ? fmtPrice(p.feed.price) : '—'}</span></div>
        <div><span className="k">Pool price <Pill kind="live" /></span><span className="v">{p.pool ? fmtPrice(p.pool.price) : '—'}</span></div>
      </div>
      {hasDebt && (
        <p style={{ margin: '4px 0 12px' }}>
          {p.liquidatableNow
            ? <Verdict bad>Liquidatable now at the current oracle price</Verdict>
            : <Verdict>Not liquidatable at the current oracle price</Verdict>}
        </p>
      )}
      <p className="meta" style={{ margin: 0 }}>
        Oracle is {fmtPct(p.oracleVsFeedPct, 3)} from the Chainlink feed{p.feed ? ` (feed updated ${fmtUtc(p.feed.updatedAt)})` : ''}.
        {p.interestAccrued ? ' Debt includes interest accrued to the current block.' : ' Debt is as of the market’s last update (interest rate unavailable).'}
      </p>

      {hasDebt && (
        <div className="scenarios">
          <div className="table-wrap" style={{ marginTop: 12 }}>
            <table>
              <thead>
                <tr><th>What if the next reopen is…</th><th>Price <Pill kind="scenario" /></th><th>Move <Pill kind="scenario" /></th><th>Health <Pill kind="scenario" /></th><th>Outcome <Pill kind="scenario" /></th></tr>
              </thead>
              <tbody>
                {p.scenarios.map((s) => (
                  <tr key={s.name}>
                    <td style={{ whiteSpace: 'normal' }}>{s.name}</td>
                    <td>{fmtPrice(s.price)}</td>
                    <td>{fmtPct(s.movePct, 1)}</td>
                    <td>{s.healthFactor.toFixed(3)}</td>
                    <td><Verdict bad={s.liquidated}>{s.liquidated ? 'Liquidated' : 'Survives'}</Verdict></td>
                  </tr>
                ))}
                {!p.scenarios.length && <tr><td colSpan={5} className="note">No scenario available: this token has no Chainlink feed or usable pool.</td></tr>}
              </tbody>
            </table>
          </div>
          {!p.worstGapAvailable && p.feed && <p className="meta">The worst-gap scenario appears once the Replay history has finished building.</p>}
        </div>
      )}
    </div>
  );
}

export default function Positions({ wallet, onWallet }) {
  const [input, setInput] = useState(wallet ?? '');
  useEffect(() => { setInput(wallet ?? ''); }, [wallet]);
  const valid = isAddr(input.trim());
  const { data, error, loading, reload } = useApi(wallet && isAddr(wallet) ? `/api/positions/${wallet}` : null);

  return (
    <section>
      <div className="section-head"><h2>Morpho stock-collateral positions <Pill kind="live" /></h2></div>
      <p className="lede">
        Paste any wallet address to see its Morpho loans backed by Robinhood stock tokens, where each would be liquidated,
        and whether the next market reopen could tip it over. Nothing is connected or signed.
      </p>
      <form className="controls" onSubmit={(e) => { e.preventDefault(); if (valid) onWallet(input.trim()); }} style={{ marginBottom: 16 }}>
        <input type="text" value={input} onChange={(e) => setInput(e.target.value)} placeholder="0x… wallet address" aria-label="Wallet address" spellCheck={false} autoComplete="off" />
        <button className="btn" type="submit" disabled={!valid}>Check</button>
        {input && !valid && <span className="meta">Enter a 0x address with 40 hex characters.</span>}
      </form>

      {wallet && !isAddr(wallet) && <ErrorState error="That address is not a valid wallet address." />}
      {error && <ErrorState error={error} onRetry={reload} />}
      {loading && <Loading>Scanning every stock-collateral Morpho market for {shortAddr(wallet)}…</Loading>}
      {data && !loading && (
        data.positions.length === 0
          ? <div className="card state">No stock-collateral positions for {shortAddr(data.wallet)} across {data.marketsScanned} Morpho markets (block {data.block?.toLocaleString() ?? '—'}).</div>
          : (
            <div className="positions">
              <p className="meta" style={{ margin: 0 }}>{data.positions.length} position{data.positions.length > 1 ? 's' : ''} across {data.marketsScanned} stock-collateral markets, read at block {data.block.toLocaleString()}.</p>
              {data.positions.map((p) => <Position key={p.marketId} p={p} />)}
            </div>
          )
      )}
    </section>
  );
}
