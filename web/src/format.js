const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });

export const fmtPrice = (v) => (v == null ? '—' : usd.format(v));
export function fmtPct(v, digits = 2) {
  if (v == null) return '—';
  const r = Number(v.toFixed(digits)); // sign follows the rounded value, so no "−0.00%"
  return `${r > 0 ? '+' : r < 0 ? '−' : ''}${Math.abs(r).toFixed(digits)}%`;
}
export const fmtCompact = (v) => (v == null ? '—' : compact.format(v));
export const fmtNum = (v, digits = 2) => (v == null ? '—' : v.toLocaleString('en-US', { maximumFractionDigits: digits }));
export const shortAddr = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '');

export function fmtAge(sec) {
  if (sec == null) return '—';
  if (sec < 90) return `${Math.round(sec)}s`;
  if (sec < 5400) return `${Math.round(sec / 60)}m`;
  if (sec < 172800) return `${(sec / 3600).toFixed(1)}h`;
  return `${(sec / 86400).toFixed(1)}d`;
}

export const fmtUtc = (iso) => (iso ? `${new Date(iso).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })} UTC` : '—');
