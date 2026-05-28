// useTickerPriceHistory — real daily price history for the ticker page chart.
//
// Sources from the same /api/price-history endpoint that useTickerTechnicalsLive
// already uses (Yahoo daily closes/opens/highs/lows/volumes). Returns the full
// 5-year window once and lets the consumer slice locally to 1M / 3M / 6M / 1Y /
// 5Y / Max. That avoids re-fetching every time the user clicks a timeframe pill.
//
// Returned shape
// --------------
//   {
//     prices  : [{ d: 'YYYY-MM-DD', o, h, l, c, v }, ...]   // ascending by date
//     loading : boolean
//     error   : Error | null
//   }
//
// All values are unsmoothed, raw closes. The chart applies its own visual
// smoothing if needed. Volumes are in raw shares.

import { useEffect, useState } from 'react';

// Module-level cache. Once a ticker has been opened in a session we don't
// re-fetch when the user clicks back to it. Cache is invalidated after 2h so a
// long session picks up today's close.
const _cache = new Map(); // ticker → { prices, fetchedAt }
const TTL_MS = 2 * 60 * 60 * 1000;

async function fetchPriceHistory(ticker, period) {
  const r = await fetch(`/api/price-history?ticker=${encodeURIComponent(ticker)}&period=${period}`);
  if (!r.ok) throw new Error(`price-history ${r.status}`);
  const data = await r.json();
  const prices = Array.isArray(data?.prices) ? data.prices : [];
  return prices.map((p) => ({
    d: String(p.d),
    o: Number(p.o),
    h: Number(p.h),
    l: Number(p.l),
    c: Number(p.c),
    v: Number(p.v || 0),
  }));
}

export default function useTickerPriceHistory(ticker, period = '5y') {
  const [state, setState] = useState({ prices: [], loading: !!ticker, error: null });

  useEffect(() => {
    if (!ticker) {
      setState({ prices: [], loading: false, error: null });
      return;
    }
    const cacheKey = `${ticker.toUpperCase()}:${period}`;
    const cached = _cache.get(cacheKey);
    if (cached && (Date.now() - cached.fetchedAt) < TTL_MS) {
      setState({ prices: cached.prices, loading: false, error: null });
      return;
    }

    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));

    (async () => {
      try {
        const prices = await fetchPriceHistory(ticker, period);
        if (cancelled) return;
        _cache.set(cacheKey, { prices, fetchedAt: Date.now() });
        setState({ prices, loading: false, error: null });
      } catch (err) {
        if (cancelled) return;
        // eslint-disable-next-line no-console
        console.warn('[useTickerPriceHistory] fetch failed:', err);
        setState({ prices: [], loading: false, error: err });
      }
    })();

    return () => { cancelled = true; };
  }, [ticker, period]);

  return state;
}

// ─── Helpers for the chart layer ─────────────────────────────────────

// Slice ascending prices to the last N sessions. `tf` keys map to the
// session counts used elsewhere on the page.
export function sliceForTimeframe(prices, tf) {
  const N = {
    '1M': 21,
    '3M': 63,
    '6M': 126,
    '1Y': 252,
    '5Y': 1260,
    Max: Number.POSITIVE_INFINITY,
  }[tf] || 252;
  if (!prices.length) return [];
  if (N === Number.POSITIVE_INFINITY) return prices;
  return prices.slice(Math.max(0, prices.length - N));
}

// Simple moving average over the .c series of an array of {d,c} rows.
// Returns an array of [date, sma] pairs aligned to the source dates;
// the first (n-1) points are null and excluded.
export function computeSMA(prices, n) {
  if (!prices || prices.length < n) return [];
  const out = [];
  let sum = 0;
  const closes = prices.map((p) => Number(p.c));
  for (let i = 0; i < closes.length; i++) {
    sum += closes[i];
    if (i >= n) sum -= closes[i - n];
    if (i >= n - 1) out.push([prices[i].d, sum / n]);
  }
  return out;
}
