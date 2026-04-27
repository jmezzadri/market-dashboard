// useRiskMetricsBatch — fetch risk metrics for multiple tickers in parallel,
// deduplicated and cached at module scope. Used by Watchlist / Positions /
// Buy / Near Trigger tables to render the new selectable risk-metric columns
// (#35, P5).
//
// API:
//   const { metrics, loading } = useRiskMetricsBatch(tickers)
//
//   metrics: { [TICKER]: { beta, annVol, maxDD, var10d99 } | null }
//   loading: boolean — true while the FIRST fetch on this set is in flight
//
// Behaviour:
//   • SPY is always fetched (shared across all tickers for beta).
//   • Each ticker's prices fetched once per module load, cached 4h.
//   • If the prop tickers list changes, missing ones are fetched in parallel.
//   • Fully resolved tickers are returned synchronously from cache.

import { useEffect, useState } from "react";
import {
  computeBeta,
  computeAnnualizedVol,
  computeMaxDrawdown,
  computeVaR10d99,
} from "../lib/riskMetrics";

// Module-scope shared cache — survives component remounts, tab switches,
// modal opens. Same TTL as useStockRiskMetrics.
const _priceCache   = new Map();    // ticker → { prices, fetchedAt }
const _metricsCache = new Map();    // ticker → { beta, annVol, maxDD, var10d99 }
const _inflight     = new Map();    // ticker → Promise (deduplicate concurrent calls)
const _CACHE_TTL    = 4 * 3600 * 1000;

async function fetchPricesCached(ticker) {
  const cached = _priceCache.get(ticker);
  if (cached && Date.now() - cached.fetchedAt < _CACHE_TTL) return cached.prices;
  if (_inflight.has(ticker)) return _inflight.get(ticker);
  const p = (async () => {
    try {
      const r = await fetch(`/api/price-history?ticker=${encodeURIComponent(ticker)}&period=2y`);
      if (!r.ok) return [];
      const json = await r.json();
      const prices = json.prices || [];
      _priceCache.set(ticker, { prices, fetchedAt: Date.now() });
      return prices;
    } catch {
      return [];
    } finally {
      _inflight.delete(ticker);
    }
  })();
  _inflight.set(ticker, p);
  return p;
}

async function ensureMetricsForTicker(ticker, spyPrices) {
  if (_metricsCache.has(ticker)) return _metricsCache.get(ticker);
  const stockPrices = await fetchPricesCached(ticker);
  if (!stockPrices.length) {
    _metricsCache.set(ticker, null);
    return null;
  }
  const m = {
    beta:     computeBeta(stockPrices, spyPrices),
    annVol:   computeAnnualizedVol(stockPrices),
    maxDD:    computeMaxDrawdown(stockPrices),
    var10d99: computeVaR10d99(stockPrices),
  };
  _metricsCache.set(ticker, m);
  return m;
}

export function useRiskMetricsBatch(tickers) {
  const [metrics, setMetrics] = useState({});
  const [loading, setLoading] = useState(false);

  // Stabilize the dependency: sorted unique uppercase ticker list as a string.
  const dedup = Array.from(new Set((tickers || []).filter(Boolean).map(t => String(t).toUpperCase()))).sort();
  const tickerKey = dedup.join(",");

  useEffect(() => {
    if (dedup.length === 0) {
      setMetrics({});
      return;
    }

    // Prefill from cache synchronously so tables render anything we already
    // have without flicker.
    const initial = {};
    let allCached = true;
    for (const t of dedup) {
      if (_metricsCache.has(t)) initial[t] = _metricsCache.get(t);
      else allCached = false;
    }
    setMetrics(initial);
    if (allCached) { setLoading(false); return; }

    let cancelled = false;
    setLoading(true);
    (async () => {
      const spyPrices = await fetchPricesCached("SPY");
      const results = await Promise.all(
        dedup.map(async (t) => [t, await ensureMetricsForTicker(t, spyPrices)])
      );
      if (cancelled) return;
      const next = {};
      for (const [t, m] of results) next[t] = m;
      setMetrics(next);
      setLoading(false);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tickerKey]);

  return { metrics, loading };
}

export default useRiskMetricsBatch;
