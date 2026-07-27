/* useLseIv — ATM implied-volatility term structure for the Portfolio Lab's
   Implied vol method (Phase 3, 2026-07-27, LSE options feed).

   Source: lse-live edge function, mode "iv" — per-expiry ATM implied vol for
   one underlying, server-cached 30 min in market hours (6 h closed). The
   client also caches per session: the lab is an interactive tool, and IV
   moving a few basis points mid-session doesn't change an expected-range
   read. Uncovered names return an empty term — the row shows an em-dash
   and the method falls back to CAPM (spec §3.3; LESSONS 4.4: never a
   fabricated value).

   Governance: manifest element options.lse-atm-iv-ondemand; health row
   lse_atm_iv; chip elementId "options-lse_atm_iv-ondemand". */

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';

const cache = new Map(); // TICKER -> Promise<{term, underlyingPrice, error}>

export function fetchIvTerm(ticker) {
  const T = String(ticker || '').trim().toUpperCase();
  if (!T) return Promise.resolve({ term: [], underlyingPrice: null, error: 'no ticker' });
  if (cache.has(T)) return cache.get(T);
  const p = supabase.functions.invoke('lse-live', { body: { mode: 'iv', symbol: T } })
    .then(({ data, error }) => {
      if (error || !data || data.error) throw new Error(error?.message || data?.error || 'no data');
      return {
        term: (data.term || []).filter((t) => Number(t.dte) > 0 && Number(t.iv) > 0),
        underlyingPrice: data.underlyingPrice ?? null,
        fetchedAt: data.fetchedAt || null,
        error: null,
      };
    })
    .catch((e) => {
      cache.delete(T); // allow retry on next mount
      return { term: [], underlyingPrice: null, fetchedAt: null, error: String(e.message || e) };
    });
  cache.set(T, p);
  return p;
}

/* tickers: symbols that currently use the Implied vol method. Returns
   { byTicker: {T: {term, error}}, loading } — fetches lazily per ticker. */
export default function useLseIv(tickers) {
  const key = useMemo(
    () => [...new Set((tickers || []).map((t) => String(t).toUpperCase()))].sort().join(','),
    [tickers],
  );
  const [state, setState] = useState({ byTicker: {}, loading: false });

  useEffect(() => {
    const list = key ? key.split(',') : [];
    if (!list.length) { setState({ byTicker: {}, loading: false }); return undefined; }
    let cancelled = false;
    setState((s) => ({ ...s, loading: true }));
    Promise.all(list.map((t) => fetchIvTerm(t).then((r) => [t, r]))).then((pairs) => {
      if (cancelled) return;
      setState({ byTicker: Object.fromEntries(pairs), loading: false });
    });
    return () => { cancelled = true; };
  }, [key]);

  return state;
}
