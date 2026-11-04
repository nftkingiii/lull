import { useEffect, useState, useCallback } from 'react';

// Errors are shown as errors. There is no fallback or demo data anywhere in this app.
export async function getJson(path) {
  const res = await fetch(path);
  let body = null;
  try { body = await res.json(); } catch { /* non-JSON error page */ }
  if (!res.ok) throw new Error(body?.error ?? `${path} answered ${res.status}`);
  return body;
}

export function useApi(path, { refreshMs } = {}) {
  const [state, setState] = useState({ data: null, error: null, loading: Boolean(path) });
  const load = useCallback(async () => {
    if (!path) return;
    setState((s) => ({ ...s, loading: true }));
    try { setState({ data: await getJson(path), error: null, loading: false }); }
    catch (e) { setState((s) => ({ data: s.data, error: e.message, loading: false })); }
  }, [path]);
  useEffect(() => {
    setState({ data: null, error: null, loading: Boolean(path) });
    load();
    if (!refreshMs) return undefined;
    const t = setInterval(load, refreshMs);
    return () => clearInterval(t);
  }, [load, refreshMs, path]);
  return { ...state, reload: load };
}
