// Shared bits. Pill marks where a number comes from: every number in the app sits under one.
export function Pill({ kind }) {
  return <span className={`pill pill-${kind}`}>{kind}</span>;
}

export function ErrorState({ error, onRetry }) {
  return (
    <div className="card state error" role="alert">
      <strong>Couldn’t load this data.</strong> {error}
      {onRetry && <> <button className="btn btn-quiet" onClick={onRetry}>Retry</button></>}
      <div className="meta">Nothing is shown in its place: Lull never substitutes demo data.</div>
    </div>
  );
}

export function Loading({ children = 'Loading…' }) {
  return <div className="card state" aria-busy="true">{children}</div>;
}

/** Diverging bar centred on zero: blue for up, red for down. The number beside it carries the value. */
export function DriftBar({ value, max }) {
  if (value == null || !max) return <span className="drift-bar" aria-hidden="true" />;
  const w = Math.min(Math.abs(value) / max, 1) * 50;
  const style = value >= 0
    ? { left: '50%', width: `${w}%`, background: 'var(--div-pos)' }
    : { right: '50%', width: `${w}%`, background: 'var(--div-neg)' };
  return <span className="drift-bar" aria-hidden="true"><span style={style} /></span>;
}

export function Verdict({ bad, children }) {
  return (
    <span className={`verdict ${bad ? 'bad' : 'ok'}`}>
      {bad ? (
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M7 1 13 12H1z" fill="var(--status-critical)" /><path d="M7 5v3.5M7 10v.5" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" /></svg>
      ) : (
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><circle cx="7" cy="7" r="6" fill="var(--status-good)" /><path d="m4.2 7.2 1.9 1.9 3.7-3.9" stroke="#fff" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
      )}
      {children}
    </span>
  );
}
