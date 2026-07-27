/* useLabPrices — adjusted daily close history for the Portfolio Lab page.

   Source: the existing on-demand endpoint api/price-history.js (Yahoo chart
   API — free, split/dividend-adjusted closes, history to inception, any US
   ticker). One source for every series on the page (holdings, benchmarks,
   sector ETFs) so every number shares one price basis (LESSONS 2026-06-12b).
   Registered in data_manifest.json as lab.price-history-yahoo (on-demand,
   same governance pattern as news.market-headlines-multisource).

   Module-level cache: each ticker is fetched once per session. */

import { useEffect, useMemo, useState } from 'react';

const cache = new Map(); // TICKER -> Promise<{prices:[{d,c}], last, asOf, error}>

export function fetchLabSeries(ticker) {
  const T = String(ticker || '').toUpperCase();
  if (!T) return Promise.resolve({ prices: [], last: null, asOf: null, error: 'no ticker' });
  if (cache.has(T)) return cache.get(T);
  const p = fetch(`/api/price-history?ticker=${encodeURIComponent(T)}&period=5y`)
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
    .then((j) => {
      const prices = (j.prices || [])
        .map((row) => ({ d: row.d, c: Number(row.adj ?? row.c), raw: Number(row.c) }))
        .filter((row) => row.d && Number.isFinite(row.c) && row.c > 0);
      if (!prices.length) throw new Error('empty series');
      const lastRow = prices[prices.length - 1];
      return { prices, last: lastRow.raw || lastRow.c, asOf: lastRow.d, error: null };
    })
    .catch((e) => {
      cache.delete(T); // allow retry on next mount
      return { prices: [], last: null, asOf: null, error: String(e.message || e) };
    });
  cache.set(T, p);
  return p;
}

/* tickers: array of symbols. Returns
   { series: {T:[{d,c}]}, lastPrice: {T:n}, asOf, loading, failed: {T:reason} } */
export default function useLabPrices(tickers) {
  const key = useMemo(() => [...new Set(tickers.map((t) => String(t).toUpperCase()))].sort().join(','), [tickers]);
  const [state, setState] = useState({ series: {}, lastPrice: {}, asOf: null, loading: false, failed: {} });

  useEffect(() => {
    const list = key ? key.split(',') : [];
    if (!list.length) {
      setState({ series: {}, lastPrice: {}, asOf: null, loading: false, failed: {} });
      return undefined;
    }
    let cancelled = false;
    setState((s) => ({ ...s, loading: true }));
    Promise.all(list.map((t) => fetchLabSeries(t).then((r) => [t, r]))).then((pairs) => {
      if (cancelled) return;
      const series = {};
      const lastPrice = {};
      const failed = {};
      let asOf = null;
      for (const [t, r] of pairs) {
        if (r.error) { failed[t] = r.error; continue; }
        series[t] = r.prices;
        lastPrice[t] = r.last;
        if (!asOf || r.asOf > asOf) asOf = r.asOf;
      }
      setState({ series, lastPrice, asOf, loading: false, failed });
    });
    return () => { cancelled = true; };
  }, [key]);

  return state;
}

/* Risk-free curve from the public indicator history (registered feeds
   ust_2y / ust_10y — chipped site-wide on Macro). Fetched once. */
let rfPromise = null;
export function useRiskFree() {
  const [rf, setRf] = useState({ y2: null, y10: null, asOf: null, loading: true });
  useEffect(() => {
    if (!rfPromise) {
      rfPromise = fetch('/indicator_history.json')
        .then((r) => r.json())
        .then((j) => {
          const last = (k) => {
            const pts = j?.[k]?.points || [];
            return pts.length ? { v: Number(pts[pts.length - 1][1]) / 100, d: pts[pts.length - 1][0] } : null;
          };
          const a = last('ust_2y');
          const b = last('ust_10y');
          return { y2: a?.v ?? null, y10: b?.v ?? null, asOf: a?.d ?? null };
        })
        .catch(() => ({ y2: null, y10: null, asOf: null }));
    }
    let cancelled = false;
    rfPromise.then((v) => { if (!cancelled) setRf({ ...v, loading: false }); });
    return () => { cancelled = true; };
  }, []);
  return rf;
}

/* Horizon-matched risk-free: 2-year Treasury for horizons ≤ 1y; for 3y,
   linear interpolation between the 2y and 10y yields (3y ≈ 2y + 1/8 of the
   2y→10y gap). Documented on the Methodology page. */
export function riskFreeForHorizon(rf, horizonKey) {
  if (rf?.y2 == null) return null;
  if (horizonKey === '3y' && rf.y10 != null) return rf.y2 + (rf.y10 - rf.y2) / 8;
  return rf.y2;
}
