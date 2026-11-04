import { useEffect, useMemo, useRef, useState } from 'react';
import { fmtPrice, fmtPct, fmtWhen } from './format.js';

const G = 64; // right gutter for value labels
const TOP = 24; const BOT = 24;
const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function niceStep(range) {
  const raw = range / 5;
  const p = 10 ** Math.floor(Math.log10(raw));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= raw) return m * p;
  return 10 * p;
}

/**
 * The moment: the weekend's real hourly closing trades (from /api/weekends) against the frozen feed.
 * Points: the pool's standing price at the freeze, each hour's closing trade at the end of its hour,
 * and the last trade at its exact time. Single-trade high/low live in the legs, not here.
 */
export default function WeekendChart({ row, live }) {
  const box = useRef(null);
  const [size, setSize] = useState({ w: 800, h: 320 });
  const [hover, setHover] = useState(null);
  useEffect(() => {
    const el = box.current;
    const ro = new ResizeObserver(() => {
      const svg = el.querySelector('svg');
      setSize({ w: Math.max(300, Math.round(el.clientWidth)), h: Math.round(svg?.getBoundingClientRect().height || 320) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const o = row.onchain;
  const feed = row.fridayClose.price;
  const t0 = Date.parse(row.fridayClose.at) / 1000;
  const lt = o?.lastTrade;
  const t1 = row.reopen ? Date.parse(row.reopen.at) / 1000 : lt ? Date.parse(lt.at) / 1000 : t0 + 3600;

  const pts = useMemo(() => {
    const out = [];
    if (o?.priceAtClose != null) out.push([t0, o.priceAtClose]);
    for (const [h, , , , c] of o?.hourly ?? []) out.push([Math.min(h + 3600, t1), c]);
    if (lt) { while (out.length && out.at(-1)[0] >= Date.parse(lt.at) / 1000) out.pop(); out.push([Date.parse(lt.at) / 1000, lt.price]); }
    return out.filter(([t]) => t >= t0 && t <= t1);
  }, [o, t0, t1, lt]);

  const { w: W, h: H } = size;
  const vals = [feed, ...pts.map((p) => p[1])];
  let lo = Math.min(...vals); let hi = Math.max(...vals);
  const pad = (hi - lo) * 0.12 || feed * 0.002;
  lo -= pad; hi += pad;
  const x = (t) => 4 + (W - G - 4) * ((t - t0) / Math.max(1, t1 - t0));
  const y = (p) => TOP + (H - TOP - BOT) * ((hi - p) / (hi - lo));
  const step = niceStep(hi - lo);
  const ticks = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) ticks.push(v);
  const days = [];
  for (let d = Math.ceil(t0 / 86400) * 86400; d < t1; d += 86400) days.push(d);

  const xy = pts.map(([t, p]) => [x(t), y(p)]);
  let d = xy.length ? `M${xy[0][0]},${xy[0][1]}` : '';
  for (let i = 1; i < xy.length; i++) {
    const [x0, y0] = xy[i - 1]; const [x1, y1] = xy[i]; const m = (x0 + x1) / 2;
    d += ` C${m},${y0} ${m},${y1} ${x1},${y1}`;
  }
  const fy = y(feed);
  const end = xy.at(-1);
  const fill = xy.length > 1 ? `${d} L${end[0]},${fy} L${xy[0][0]},${fy} Z` : '';
  const dec = step < 0.1 ? 2 : step < 1 ? 2 : 0;

  const onMove = (e) => {
    if (!xy.length) return;
    const r = box.current.getBoundingClientRect();
    const px = e.clientX - r.left;
    let i = 0;
    for (let j = 1; j < xy.length; j++) if (Math.abs(xy[j][0] - px) < Math.abs(xy[i][0] - px)) i = j;
    setHover(i);
  };

  const label = `${row.symbol} on-chain price against the frozen feed of ${fmtPrice(feed)}, ${fmtWhen(row.fridayClose.at)} to ${row.reopen ? fmtWhen(row.reopen.at) : 'now'}`;

  return (
    <div className="chart" ref={box} onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} preserveAspectRatio="none">
        {ticks.map((v) => (
          <g key={v}>
            <line x1="0" x2={W - G + 8} y1={y(v)} y2={y(v)} stroke="rgba(237,237,237,.05)" />
            {Math.abs(y(v) - fy) > 14 && <text x={W} y={y(v) + 4} textAnchor="end" fontFamily="Geist Mono" fontSize="11" fill="#85858b">{v.toFixed(dec)}</text>}
          </g>
        ))}
        {days.map((t) => (
          <g key={t}>
            <line x1={x(t)} x2={x(t)} y1="0" y2={H} stroke="rgba(237,237,237,.06)" />
            {x(t1) - x(t) > 40 && <text x={x(t) + 6} y={H - 6} fontFamily="Geist Mono" fontSize="11" fill="#85858b">{DAY[new Date(t * 1000).getUTCDay()]}</text>}
          </g>
        ))}
        {fill && <path d={fill} fill="rgba(237,237,237,.04)" />}
        <line x1="0" x2={W - G + 8} y1={fy} y2={fy} stroke="#a1a1a6" strokeWidth="1" strokeDasharray="4 4" />
        <rect x={W - G + 12} y={fy - 10} width={G - 12} height="20" rx="4" fill="#232325" />
        <text x={W - 4} y={fy + 4} textAnchor="end" fontFamily="Geist Mono" fontSize="11" fill="#ededed">{feed.toFixed(2)}</text>
        {d && <path d={d} fill="none" stroke="#e8a24a" strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />}
        {row.reopen && <line x1={x(t1)} x2={x(t1)} y1="0" y2={H} stroke="rgba(237,237,237,.3)" />}
        {end && <circle cx={end[0]} cy={end[1]} r="4" fill="#e8a24a" />}
        {hover != null && <line x1={xy[hover][0]} x2={xy[hover][0]} y1="0" y2={H} stroke="rgba(237,237,237,.14)" />}
      </svg>
      {hover != null && (
        <div className="chart-tip num" style={{ left: Math.min(xy[hover][0] + 8, W - 190), top: Math.max(xy[hover][1] - 44, 0) }}>
          <div>{fmtPrice(pts[hover][1])} <span className="t">{fmtPct((pts[hover][1] / feed - 1) * 100)} vs feed</span></div>
          <div className="t">{fmtWhen(new Date(pts[hover][0] * 1000).toISOString())}{live && hover === pts.length - 1 ? ', latest' : ''}</div>
        </div>
      )}
      {!pts.length && <p className="hint">{row.onchainNote ?? 'No usable trades in this window'}</p>}
    </div>
  );
}
