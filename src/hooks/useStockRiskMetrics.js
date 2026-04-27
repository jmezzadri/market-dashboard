// useStockRiskMetrics — fetches 2Y daily prices for ticker + SPY and computes
// Beta, Annualized Vol, Max Drawdown, and 10-day 99% historical VaR.
//
// Cached in module scope by ticker so revisiting a stock modal doesn't refetch.
// SPY history is shared across all tickers — single fetch per session.

import { useEffect, useState } from "react";
import {
  computeBeta,
  computeAnnualizedVol,
  computeMaxDrawdown,
  computeVaR10d99,
} from "../lib/riskMetrics";

const _priceCache = new Map();   // ticker → { prices, fetchedAt }
const _CACHE_TTL  = 4 * 3600 * 1000;  // 4h — daily prices don't change intraday for closed sessions

async function fetchPrices(ticker, period = "2y") {
  const key = `${ticker}:${period}`;
  const cached = _priceCache.get(key);
  if (cached && Date.now() - cached.fetchedAt < _CACHE_TTL) return cached.prices;
  const r = await fetch(`/api/price-history?ticker=${encodeURIComponent(ticker)}&period=${period}`);
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error(e.error || `HTTP ${r.status}`);
  }
  const json = await r.json();
  _priceCache.set(key, { prices: json.prices || [], fetchedAt: Date.now() });
  return json.prices || [];
}

export function useStockRiskMetrics(ticker) {
  const [metrics, setMetrics] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState(null);

  useEffect(() => {
    if (!ticker) { setMetrics(null); return; }
    let cancelled = false;
    setLoading(true); setError(null);
    Promise.all([
      fetchPrices(ticker, "2y"),
      fetchPrices("SPY",  "2y"),
    ]).then(([stockPrices, spyPrices]) => {
      if (cancelled) return;
      try {
        const m = {
          beta:     computeBeta(stockPrices, spyPrices),
          annVol:   computeAnnualizedVol(stockPrices),
          maxDD:    computeMaxDrawdown(stockPrices),
          var10d99: computeVaR10d99(stockPrices),
          // Source note for the methodology footnote
          sourceWindow: stockPrices.length > 0
            ? `${stockPrices[0].d} → ${stockPrices[stockPrices.length-1].d}`
            : null,
        };
        setMetrics(m);
      } catch (e) {
        setError(e.message || "compute failed");
      }
      setLoading(false);
    }).catch(e => {
      if (cancelled) return;
      setError(e.message || "fetch failed");
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [ticker]);

  return { metrics, loading, error };
}

export default useStockRiskMetrics;
