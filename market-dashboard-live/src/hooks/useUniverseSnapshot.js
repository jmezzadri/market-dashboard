// useUniverseSnapshot — overlays the 3x-weekday universe snapshot onto scanData.
//
// Why
// ---
// The public `latest_scan_data.json` artifact refreshes 1x/day at 15:30 ET.
// Between scans, screener prices (close, prev_close, marketcap, IV rank, options
// flow, etc.) go stale — which is especially painful on the Watchlist table,
// Positions PnL Day column, and the per-ticker detail modal.
//
// `public.universe_snapshots` is a separate table populated 3x/weekday (10:00 /
// 13:00 / 15:45 ET) from the same UW /api/screener/stocks endpoint, covering
// every equity ≥ $1B mcap. This hook reads the freshest available row PER
// TICKER and returns an overlay that merges those fields into scanData so every
// surface that reads from scanData — Watchlist, Positions, Ticker Detail,
// Scanner tabs — automatically picks up the fresher values.
//
// Latest-per-ticker (2026-05-27 fix)
// ----------------------------------
// Earlier versions of this hook found the most recent `snapshot_ts` and then
// SELECTED only rows at that exact timestamp. The UW screener has flickering
// universe membership — a small/illiquid ticker that was in the noon batch can
// drop out of the 3:45 batch, then re-appear in the next morning. Reading only
// the most recent batch left those tickers blank on every UI surface even
// though their last good snapshot was just a few hours old.
//
// We now pull the last ~48 hours of snapshots (every batch over that window)
// and dedupe client-side keeping the most recent row per ticker. ~6 batches
// × ~2,500 rows ≈ 15K rows, well within the PostgREST payload limits we already
// paginate around. Any ticker that hasn't snapshotted in 48 hours falls out —
// that's intentional (genuinely stale data shouldn't silently render).
//
// Merge order (set in App.jsx / Scanner.jsx)
// ------------------------------------------
//   rawScanData           (public JSON, 1x/day)
//     → mergeUniverseSnapshot   (3x/day, universe-wide, fresh prices/flow)
//       → mergePrivateScan      (1x/day, per-user watchlist, technicals/news/analyst)
//         → scanData            (rendered)
//
// Field-level overlay: only non-null universe values overwrite existing fields.
// That way the public artifact / user_scan_data keep supplying fields the
// universe snapshot doesn't cover (technicals_json, analyst_ratings, news, tags,
// dividend_yield, has_dividend), while universe values win for the overlapping
// price / options / IV / calendar fields they share.
//
// Auth / RLS
// ----------
// universe_snapshots.RLS is `authenticated` read. For signed-out users the
// query returns zero rows and mergeInto becomes a pass-through — identical to
// today's behavior. Signed-in users get 3x/day prices on every price-reading
// surface without per-component code changes.
//
// Shape returned
// --------------
//   {
//     rows       : Array<row>               // dedupe-latest rows
//     byTicker   : Map<ticker, row>         // dedupe-latest per ticker
//     snapshotTs : ISO string | null        // time of the most recent batch
//     loading    : boolean
//     error      : Error | null
//     mergeInto  : (scanData) => scanData   // pass-through when byTicker empty
//     refetch    : () => Promise<void>
//   }

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { useSession } from "../auth/useSession";

// Fields we SELECT from universe_snapshots.
const SELECT_COLUMNS = [
  "ticker",
  "snapshot_ts",
  "as_of_date",
  // identity & classification
  "full_name", "sector", "issue_type",
  // price / volume (stock)
  "close", "prev_close", "perc_change", "high", "low",
  "stock_volume", "avg30_volume", "relative_volume",
  "week_52_high", "week_52_low",
  // IV / volatility
  "iv30d", "iv_rank", "realized_volatility",
  // implied moves
  "implied_move", "implied_move_perc",
  "implied_move_7", "implied_move_perc_7",
  "implied_move_30", "implied_move_perc_30",
  // marketcap
  "marketcap",
  // options volume / OI
  "call_volume", "put_volume", "put_call_ratio",
  "call_open_interest", "put_open_interest", "total_open_interest",
  // options premium ($ flow)
  "call_premium", "put_premium",
  "net_call_premium", "net_put_premium",
  "bullish_premium", "bearish_premium",
  // calendar
  "next_earnings_date", "er_time", "next_dividend_date",
].join(",");

const SCREENER_OVERLAY_FIELDS = [
  "full_name", "sector",
  "close", "prev_close", "perc_change", "high", "low",
  "stock_volume", "avg30_volume", "relative_volume",
  "week_52_high", "week_52_low",
  "iv30d", "iv_rank", "realized_volatility",
  "implied_move", "implied_move_perc",
  "implied_move_7", "implied_move_perc_7",
  "implied_move_30", "implied_move_perc_30",
  "marketcap",
  "call_volume", "put_volume", "put_call_ratio",
  "call_open_interest", "put_open_interest", "total_open_interest",
  "call_premium", "put_premium",
  "net_call_premium", "net_put_premium",
  "bullish_premium", "bearish_premium",
  "next_earnings_date", "er_time", "next_dividend_date",
];

const INFO_OVERLAY_FIELDS = [
  "marketcap", "sector", "full_name", "issue_type",
  "next_earnings_date", "next_dividend_date",
];

// How far back to look for the dedupe-latest window. 48h covers a Friday-close
// → Monday-morning gap plus the normal 3x/day batch cadence.
const LOOKBACK_HOURS = 48;

export function useUniverseSnapshot() {
  const { session, loading: sessionLoading } = useSession();
  const userId = session?.user?.id ?? null;

  const [rows,       setRows]       = useState([]);
  const [snapshotTs, setSnapshotTs] = useState(null);
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState(null);
  const [tick,       setTick]       = useState(0);

  const refetch = useCallback(() => {
    setTick((n) => n + 1);
    return Promise.resolve();
  }, []);

  useEffect(() => {
    if (!userId) {
      setRows([]);
      setSnapshotTs(null);
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        // Pull every snapshot within the lookback window, newest first. Paginate
        // around PostgREST's 1000-row cap. We dedupe client-side: the first
        // time we see a ticker in newest-first order is its freshest row.
        const sinceIso = new Date(Date.now() - LOOKBACK_HOURS * 3600 * 1000).toISOString();
        const PAGE = 1000;
        const seen = new Set();
        const latestPerTicker = [];
        let latestTs = null;

        for (let from = 0; from < 50000; from += PAGE) {
          const { data, error: qErr } = await supabase
            .from("universe_snapshots")
            .select(SELECT_COLUMNS)
            .gte("snapshot_ts", sinceIso)
            .order("snapshot_ts", { ascending: false })
            .range(from, from + PAGE - 1);
          if (cancelled) return;
          if (qErr) throw qErr;
          if (!data || data.length === 0) break;

          for (const r of data) {
            if (!r?.ticker) continue;
            const T = String(r.ticker).toUpperCase();
            if (seen.has(T)) continue; // newest-first → first sighting wins
            seen.add(T);
            latestPerTicker.push(r);
            if (!latestTs || (r.snapshot_ts && r.snapshot_ts > latestTs)) {
              latestTs = r.snapshot_ts;
            }
          }

          if (data.length < PAGE) break;
        }

        setRows(latestPerTicker);
        setSnapshotTs(latestTs);
        setLoading(false);
      } catch (err) {
        if (cancelled) return;
        // eslint-disable-next-line no-console
        console.warn("[useUniverseSnapshot] fetch failed:", err);
        setError(err);
        setRows([]);
        setSnapshotTs(null);
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

  const mergeInto = useCallback((scanData) => {
    if (!scanData || byTicker.size === 0) return scanData;
    const prev = scanData.signals || {};
    const nextScreener = { ...(prev.screener || {}) };
    const nextInfo     = { ...(prev.info     || {}) };

    for (const [T, row] of byTicker) {
      const existingSc = nextScreener[T] || {};
      const overlayedSc = { ...existingSc };
      let scChanged = false;
      for (const k of SCREENER_OVERLAY_FIELDS) {
        const v = row[k];
        if (v !== null && v !== undefined) {
          overlayedSc[k] = v;
          scChanged = true;
        }
      }
      if (scChanged) nextScreener[T] = overlayedSc;

      const existingInf = nextInfo[T] || {};
      const overlayedInf = { ...existingInf };
      let infChanged = false;
      for (const k of INFO_OVERLAY_FIELDS) {
        const v = row[k];
        if (v !== null && v !== undefined) {
          overlayedInf[k] = v;
          infChanged = true;
        }
      }
      if (infChanged) nextInfo[T] = overlayedInf;
    }

    return {
      ...scanData,
      signals: {
        ...prev,
        screener: nextScreener,
        info:     nextInfo,
      },
      universe_snapshot_ts: snapshotTs,
    };
  }, [byTicker, snapshotTs]);

  return {
    rows,
    byTicker,
    snapshotTs,
    loading: loading || sessionLoading,
    error,
    mergeInto,
    refetch,
    isAuthed: Boolean(userId) && !loading && !error,
  };
}
