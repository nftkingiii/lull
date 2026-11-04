import { useEffect, useMemo, useRef, useState } from 'react';
import { fmtPrice, fmtPct } from './format.js';
import { Pill } from './ui.jsx';

const H = 260;
const M = { top: 16, right: 92, bottom: 26, left: 64 };

/**
 * One stock over one weekend: the deepest pool's hourly close (line) and hourly high-low (band),
 * against the frozen Friday close and the Monday reopen (dashed reference lines, labelled directly).
 * Single series, so no legend: the title names it.
 */
export default function WeekendChart({ symbol, row }) {
  const ref = useRef(null);
  const boxRef = useRef(null);
  const [hover, setHover] = useState(null);
  // Draw at the container's real width so text stays 11px on a phone instead of scaling down.
  const [W, setW] = useState(720);
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(([e]) => setW(Math.max(300, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const o = row.onchain;
  const closeTs = Date.parse(row.fridayClose.at) / 1000;
  const endTs = row.reopen ? Date.parse(row.reopen.at) / 1000 : (o?.hourly?.at(-1)?.[0] ?? closeTs) + 3600;

  const model = useMemo(() => {
    const pts = (o?.hourly ?? []).map(([h, op, hi, lo, cl]) => ({ t: Math.max(h, closeTs), op, hi, lo, cl }));
    const ys = [row.fridayClose.price, ...(row.reopen ? [row.reopen.price] : []), ...pts.flatMap((p) => [p.hi, p.lo])];
    let y0 = Math.min(...ys); let y1 = Math.max(...ys);
    const pad = (y1 - y0) * 0.12 || y0 * 0.01;
    y0 -= pad; y1 += pad;
    const iw = W - M.left - M.right; const ih = H - M.top - M.bottom;
    const x = (t) => M.left + ((t - closeTs) / Math.max(1, endTs - closeTs)) * iw;
    const y = (v) => M.top + (1 - (v - y0) / (y1 - y0)) * ih;
    const ticks = Array.from({ length: 5 }, (_, i) => y0 + ((y1 - y0) * i) / 4);
    // Day ticks at 00:00 UTC inside the window.
    const days = [];
    for (let d = Math.ceil(closeTs / 86400) * 86400; d < endTs; d += 86400) days.push(d);
    return { pts, x, y, ticks, days, iw, ih };
  }, [o, row, closeTs, endTs, W]);

  const { pts, x, y, ticks, days } = model;
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.cl).toFixed(1)}`).join('');
  const band = pts.length > 1
    ? `${pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.hi).toFixed(1)}`).join('')}${[...pts].reverse().map((p) => `L${x(p.t).toFixed(1)},${y(p.lo).toFixed(1)}`).join('')}Z`
    : '';

  // Direct labels sit in the right margin; nudge them apart when the two lines are close.
  const cY = y(row.fridayClose.price);
  const rY = row.reopen ? y(row.reopen.price) : null;
  let closeLabelY = cY; let reopenLabelY = rY;
  if (rY != null && Math.abs(rY - cY) < 14) {
    const mid = (rY + cY) / 2; const up = rY < cY;
    reopenLabelY = mid + (up ? -7 : 7); closeLabelY = mid + (up ? 7 : -7);
  }
  const refLine = (yy, labelY, label) => (
    <g key={label}>
      <line x1={M.left} x2={W - M.right} y1={yy} y2={yy} stroke="var(--ref-line)" strokeWidth="1.25" strokeDasharray="4 4" />
      <text x={W - M.right + 6} y={labelY + 4} fill="var(--text-secondary)" fontSize="11">{label}</text>
    </g>
  );

  const onMove = (e) => {
    if (!pts.length) return;
    const r = ref.current.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    let best = pts[0];
    for (const p of pts) if (Math.abs(x(p.t) - px) < Math.abs(x(best.t) - px)) best = p;
    setHover({ p: best, left: (x(best.t) / W) * r.width, top: (y(best.cl) / H) * r.height });
  };

  const fmtDay = (t) => new Date(t * 1000).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', timeZone: 'UTC' });
  const fmtHour = (t) => new Date(t * 1000).toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });

  return (
    <div className="card chart" ref={boxRef}>
      <h3>{symbol}: deepest pool over the freeze <Pill kind="replay" /></h3>
      <div className="meta">Hourly close (line) and high–low (band), UTC. Dashed lines are the feed’s Friday close and Monday reopen.</div>
      {!pts.length ? (
        <div className="state">{row.onchainNote ?? 'No usable swaps in this window.'}</div>
      ) : (
        <div style={{ position: 'relative' }} onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
          <svg ref={ref} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${symbol} pool price during the weekend of ${row.fridayClose.at.slice(0, 10)}`}>
            <g className="grid">{ticks.map((v) => <line key={v} x1={M.left} x2={W - M.right} y1={y(v)} y2={y(v)} />)}</g>
            <g className="axis">
              {ticks.map((v) => <text key={v} x={M.left - 8} y={y(v) + 4} textAnchor="end">{fmtPrice(v)}</text>)}
              {days.map((d) => <text key={d} x={x(d)} y={H - 6} textAnchor="middle">{fmtDay(d)}</text>)}
            </g>
            <path d={band} fill="var(--series-1-band)" />
            <path d={line} fill="none" stroke="var(--series-1)" strokeWidth="2" strokeLinejoin="round" />
            {refLine(y(row.fridayClose.price), closeLabelY, `Fri close ${fmtPrice(row.fridayClose.price)}`)}
            {row.reopen && refLine(y(row.reopen.price), reopenLabelY, `Reopen ${fmtPrice(row.reopen.price)}`)}
            {hover && <line x1={x(hover.p.t)} x2={x(hover.p.t)} y1={M.top} y2={H - M.bottom} stroke="var(--ref-line)" strokeWidth="1" />}
            {hover && <circle cx={x(hover.p.t)} cy={y(hover.p.cl)} r="4" fill="var(--series-1)" stroke="var(--surface-1)" strokeWidth="2" />}
          </svg>
          {hover && (
            <div className="tooltip" style={{ left: Math.min(hover.left + 12, (ref.current?.getBoundingClientRect().width ?? 600) - 170), top: Math.max(hover.top - 60, 0) }}>
              <div className="meta">{fmtHour(hover.p.t)}</div>
              <div><strong>{fmtPrice(hover.p.cl)}</strong> close · {fmtPct(((hover.p.cl - row.fridayClose.price) / row.fridayClose.price) * 100)} vs Fri</div>
              <div className="meta">high {fmtPrice(hover.p.hi)} · low {fmtPrice(hover.p.lo)}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
