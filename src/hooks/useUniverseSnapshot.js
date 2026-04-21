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
// every equity ≥ $1B mcap. This hook reads the latest snapshot, returns an
// overlay that merges its fields into scanData.signals.screener and .info so
// every surface that reads from scanData — Watchlist, Positions, Ticker Detail,
// Scanner tabs — automatically picks up the fresher values.
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
//     rows       : Array<row>               // raw universe rows at latest ts
//     byTicker   : Map<ticker, row>
//     snapshotTs : ISO string | null        // time of latest snapshot
//     loading    : boolean
//     error      : Error | null
//     mergeInto  : (scanData) => scanData   // pass-through when byTicker empty
//     refetch    : () => Promise<void>
//   }

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { useSession } from "../auth/useSession";

// Fields we SELECT from universe_snapshots. Kept narrow on purpose — we don't
// need the full 70-column row shape for the overlay. If a new field becomes
// load-bearing for the UI, add it here AND to SCREENER_OVERLAY_FIELDS below.
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
  // implied moves (next expiry + 7/30 tenors)
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

// Fields overlaid onto scanData.signals.screener[T]. Everything in SELECT_COLUMNS
// that the existing components read from `sc.*` lives here.
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

// Fields overlaid onto scanData.signals.info[T]. Narrower than screener —
// components that read info first for these specific fields (PositionsTable's
// nextEarnings, WatchlistTable's marketcap fallback) need them there.
const INFO_OVERLAY_FIELDS = [
  "marketcap", "sector", "full_name", "issue_type",
  "next_earnings_date", "next_dividend_date",
];

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
    // Unauthenticated — no fetch. RLS would return 0 rows anyway; skipping the
    // round-trip keeps the initial render clean for signed-out visitors.
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
        // 1) Find the latest snapshot_ts. Using `order desc limit 1` against
        //    the (snapshot_ts desc) index is a single index lookup — cheap.
        const latestRes = await supabase
          .from("universe_snapshots")
          .select("snapshot_ts")
          .order("snapshot_ts", { ascending: false })
          .limit(1);
        if (cancelled) return;
        if (latestRes.error) throw latestRes.error;
        const latestTs = latestRes.data?.[0]?.snapshot_ts || null;
        if (!latestTs) {
          // Table empty — treat as no-op (shouldn't happen in prod; could in
          // local dev before the first run).
          setRows([]);
          setSnapshotTs(null);
          setLoading(false);
          return;
        }

        // 2) Pull every row at that snapshot_ts. ~1,700 rows × ~35 columns;
        //    payload is well under 1 MB compressed. Supabase's default 1000-row
        //    PostgREST cap requires an explicit `range` — we paginate to be
        //    safe.
        const PAGE = 1000;
        let all = [];
        for (let from = 0; from < 10000; from += PAGE) {
          const { data, error: qErr } = await supabase
            .from("universe_snapshots")
            .select(SELECT_COLUMNS)
            .eq("snapshot_ts", latestTs)
            .range(from, from + PAGE - 1);
          if (cancelled) return;
          if (qErr) throw qErr;
          if (!data || data.length === 0) break;
          all = all.concat(data);
          if (data.length < PAGE) break;
        }

        setRows(all);
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
      // Screener overlay — universe values win field-by-field where non-null.
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

      // Info overlay — narrower set of fields.
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
      // Expose the universe snapshot timestamp to downstream UI that wants to
      // render a "Prices: 3x/day · Updated HH:MM ET" indicator. Orthogonal to
      // scanData.date_label (which is the public artifact's build time).
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
