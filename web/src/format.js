const MINUS = '−';
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const LONG_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n) => String(n).padStart(2, '0');

export const fmtPrice = (v) => (v == null ? '—' : `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

export function fmtPct(v, digits = 2) {
  if (v == null) return '—';
  const r = Number(v.toFixed(digits)); // sign follows the rounded value, so never "−0.00%"
  return `${r > 0 ? '+' : r < 0 ? MINUS : ''}${Math.abs(r).toFixed(digits)}%`;
}

export function fmtUsdCompact(v) {
  if (v == null) return '—';
  if (v >= 1e6) return `$${(v / 1e6).toFixed(2)}m`;
  if (v >= 1e3) return `$${Math.round(v / 1e3)}k`;
  return `$${Math.round(v)}`;
}

export const fmtNum = (v, digits = 2) => (v == null ? '—' : v.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits }));
export const fmtLltv = (v) => (v == null ? '—' : `${Number((v * 100).toFixed(1))}%`);
export const shortAddr = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '');

/** "Fri 14:39 UTC", rounded to the minute; with seconds: "Mon 00:00:35 UTC". */
export function fmtWhen(iso, { seconds = false, utc = true } = {}) {
  if (!iso) return '—';
  let d = new Date(iso);
  // Nearest minute, half down: 15:26:59 -> 15:27 and 23:42:30 -> 23:42, as in the design spec.
  if (!seconds) d = new Date(Math.ceil(d.getTime() / 60000 - 0.5) * 60000);
  const t = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}${seconds ? `:${pad(d.getUTCSeconds())}` : ''}`;
  return `${DAYS[d.getUTCDay()]} ${t}${utc ? ' UTC' : ''}`;
}

export const hhmm = (iso) => { const d = new Date(iso); return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`; };
export const dayCode = (iso) => DAYS[new Date(iso).getUTCDay()].toUpperCase();
export const longDay = (iso) => LONG_DAYS[new Date(iso).getUTCDay()];
export const dayMonth = (ymd) => { const d = new Date(`${ymd}T00:00:00Z`); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`; };
export const dowDayMonth = (ymd) => { const d = new Date(`${ymd}T00:00:00Z`); return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`; };
