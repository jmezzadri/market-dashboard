// usePrivateScanSupplement — loads per-user scan rows from Supabase and exposes
// a merge helper that fills in the public artifact's signals map with the
// user's watchlist tickers' technicals / screener / analyst / info / news.
//
// Why
// ---
// The public artifact (`latest_scan_data.json`) intentionally excludes every
// user's watchlist from its signals maps so we don't leak what anyone is
// tracking. But when a signed-in user views MacroTilt, we want their watchlist
// tickers to show six-bar composites just like public-universe tickers do.
// The scanner writes those per-user rows to `public.user_scan_data` on each
// run; this hook reads them back under RLS and merges them client-side.
//
// Shape returned
// --------------
//   {
//     rows      : Array<{ ticker, technicals_json, screener_json, composite_json, scan_time }>
//     byTicker  : Map<ticker -> row>
//     loading   : boolean
//     error     : Error | null
//     mergeInto : (scanData) => scanData   // returns a NEW scanData object with
//                                            // signals.technicals / .screener / .analyst_ratings /
//                                            // .info / .news filled in for each row's ticker
//     isAuthed  : boolean
//   }
//
// Unauthenticated callers get empty rows and a pass-through `mergeInto` — safe
// to always call, never panics. RLS enforces per-user scoping on the DB side.

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { useSession } from "../auth/useSession";

export function usePrivateScanSupplement() {
  const { session, loading: sessionLoading } = useSession();
  const userId = session?.user?.id ?? null;

  const [rows,    setRows]    = useState([]);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);
  const [tick,    setTick]    = useState(0);

  const refetch = useCallback(() => {
    setTick((n) => n + 1);
    return Promise.resolve();
  }, []);

  useEffect(() => {
    if (!userId) {
      setRows([]);
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        // RLS filters to the current user automatically; we never pass user_id.
        const { data, error: qErr } = await supabase
          .from("user_scan_data")
          .select("ticker,technicals_json,screener_json,composite_json,scan_time");
        if (cancelled) return;
        if (qErr) throw qErr;
        setRows(data || []);
        setLoading(false);
      } catch (err) {
        if (cancelled) return;
        // eslint-disable-next-line no-console
        console.error("[usePrivateScanSupplement] fetch failed:", err);
        setError(err);
        setRows([]);
        setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [userId, tick]);

  const byTicker = useMemo(() => {
    const m = new Map();
    for (const r of rows) {
      if (r?.ticker) m.set(String(r.ticker).toUpperCase(), r);
    }
    return m;
  }, [rows]);

  // Returns a NEW scanData object with the supplement layered in. Preserves
  // shape: signals.technicals[T], signals.screener[T], signals.analyst_ratings[T],
  // signals.info[T], signals.news[T]. Public-universe values win if a ticker
  // exists in both (shouldn't happen — reporter.py strips watchlist from
  // public — but we're defensive in case a future edit changes that).
  const mergeInto = useCallback((scanData) => {
    if (!scanData || byTicker.size === 0) return scanData;
    const prev = scanData.signals || {};
    const nextTech     = { ...(prev.technicals      || {}) };
    const nextScreener = { ...(prev.screener        || {}) };
    const nextAnalyst  = { ...(prev.analyst_ratings || {}) };
    const nextInfo     = { ...(prev.info            || {}) };
    const nextNews     = { ...(prev.news            || {}) };

    for (const [T, r] of byTicker) {
      if (!nextTech[T]     && r.technicals_json) nextTech[T]     = r.technicals_json;
      if (!nextScreener[T] && r.screener_json)   nextScreener[T] = r.screener_json;

      const comp = r.composite_json || null;
      if (comp) {
        if (!nextAnalyst[T] && Array.isArray(comp.analyst_ratings) && comp.analyst_ratings.length) {
          nextAnalyst[T] = comp.analyst_ratings;
        }
        if (!nextInfo[T] && comp.info) {
          nextInfo[T] = comp.info;
        }
        if (!nextNews[T] && Array.isArray(comp.news) && comp.news.length) {
          nextNews[T] = comp.news;
        }
      }
    }

    return {
      ...scanData,
      signals: {
        ...prev,
        technicals:      nextTech,
        screener:        nextScreener,
        analyst_ratings: nextAnalyst,
        info:            nextInfo,
        news:            nextNews,
      },
    };
  }, [byTicker]);

  return {
    rows,
    byTicker,
    loading: loading || sessionLoading,
    error,
    mergeInto,
    refetch,
    isAuthed: Boolean(userId) && !loading && !error,
  };
}
