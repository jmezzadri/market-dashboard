// useTickerEvents — overlays the 3x-weekday ticker-event stream onto scanData.
//
// Why
// ---
// `public.ticker_events` is populated 3x/weekday by
// trading-scanner/scanner/ticker_events.py from four Unusual Whales firehoses,
// filtered by source PURPOSE (see scanner module docstring):
//
//     news     → tracked set (positions ∪ watchlist) — personal awareness
//     insider  → market-wide — discovery: small-cap insider buys
//     congress → market-wide — discovery: political info-edge
//     darkpool → $1B+ universe — volume-bounded discovery
//
// This hook reads the last `daysBack` days of events, groups them by ticker
// and by source, and exposes a `mergeInto` closure that overlays them onto
// scanData.signals.events[ticker] — so every ticker-keyed UI surface
// (WatchlistTable, PositionsTable, TickerDetailModal, Scanner ticker rows)
// can read `scanData.signals.events[T].insider` etc. without a second
// round-trip.
//
// Merge order (set in App.jsx / Scanner.jsx — extend after the universe merge)
// ----------------------------------------------------------------------------
//     rawScanData
//       → mergeUniverseSnapshot      (3x/day price overlay)
//         → mergePrivateScan         (1x/day per-user technicals + news)
//           → mergeTickerEvents      (3x/day event stream — THIS HOOK)
//             → scanData
//
// The ticker_events payloads are additive — they don't overwrite any existing
// fields. We write to a NEW `events` subtree under scanData.signals, so
// every existing consumer keeps working unchanged.
//
// Auth / RLS
// ----------
// ticker_events.RLS is `authenticated` read. Signed-out users get zero rows
// and mergeInto becomes a pass-through.
//
// Data scope
// ----------
// Fetches ALL rows in the last `daysBack` days — not filtered per-user. This
// is intentional: insider / congress are market-wide discovery feeds and the
// future /scanner/discovery page needs the full firehose in memory. The bulk
// payload is small (~1-3MB for 30 days) and loaded once per session.
//
// Shape returned
// --------------
//     {
//       rows:          Array<EventRow>                              // raw, newest first
//       byTicker:      Map<ticker, EventsByTicker>                  // grouped per ticker
//       bySource:      { news, insider, congress, darkpool }        // grouped per source
//       latestEventTs: ISO string | null                            // max(event_ts) — for freshness chip
//       daysBack:      number                                        // echo of the arg
//       loading, error,
//       mergeInto:     (scanData) => scanData                       // pass-through when empty
//       refetch:       () => Promise<void>
//       isAuthed:      boolean
//     }
//
// EventRow = { ticker, source, event_ts, ingested_ts, payload }
// EventsByTicker = { news: EventRow[], insider: EventRow[], congress: EventRow[], darkpool: EventRow[] }

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { useSession } from "../auth/useSession";

const SELECT_COLUMNS = [
  "ticker",
  "source",
  "event_ts",
  "ingested_ts",
  "payload",
].join(",");

const SOURCES = ["news", "insider", "congress", "darkpool"];

// Default lookback. Matches the 30-day retention prune on ticker_events, and
// is wider than the widest per-source ingestion window (congress 45d is
// already truncated by retention). If a caller wants 7d or 90d, pass it in.
const DEFAULT_DAYS_BACK = 30;

// Page size for PostgREST pagination. Supabase caps at 1000 rows/request by
// default; we paginate up to ~10k (safety ceiling well above the 30d firehose).
const PAGE = 1000;
const MAX_PAGES = 10;

function emptyBySource() {
  return { news: [], insider: [], congress: [], darkpool: [] };
}

export function useTickerEvents({ daysBack = DEFAULT_DAYS_BACK } = {}) {
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
        // event_ts cutoff — computed once per fetch, in UTC. The column is
        // timestamptz so PostgREST handles the TZ comparison server-side.
        const cutoffIso = new Date(Date.now() - daysBack * 86400_000).toISOString();

        let all = [];
        for (let p = 0; p < MAX_PAGES; p++) {
          const from = p * PAGE;
          const { data, error: qErr } = await supabase
            .from("ticker_events")
            .select(SELECT_COLUMNS)
            .gte("event_ts", cutoffIso)
            .order("event_ts", { ascending: false })
            .range(from, from + PAGE - 1);
          if (cancelled) return;
          if (qErr) throw qErr;
          if (!data || data.length === 0) break;
          all = all.concat(data);
          if (data.length < PAGE) break;
        }

        setRows(all);
        setLoading(false);
      } catch (err) {
        if (cancelled) return;
        // eslint-disable-next-line no-console
        console.warn("[useTickerEvents] fetch failed:", err);
        setError(err);
        setRows([]);
        setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [userId, daysBack, tick]);

  // byTicker — Map<tickerUpper, {news, insider, congress, darkpool}>, each
  // array in event_ts-desc order (inherited from the server-side order).
  const byTicker = useMemo(() => {
    const m = new Map();
    for (const r of rows) {
      if (!r?.ticker || !r?.source) continue;
      const T = String(r.ticker).toUpperCase();
      let bucket = m.get(T);
      if (!bucket) {
        bucket = emptyBySource();
        m.set(T, bucket);
      }
      const arr = bucket[r.source];
      if (arr) arr.push(r);
    }
    return m;
  }, [rows]);

  // bySource — flat arrays per source, also event_ts-desc. Primary consumer:
  // the future discovery scanner page (task #23 follow-on) which wants
  // "most recent insider buys market-wide" independent of any ticker set.
  const bySource = useMemo(() => {
    const out = emptyBySource();
    for (const r of rows) {
      if (!r?.source) continue;
      const arr = out[r.source];
      if (arr) arr.push(r);
    }
    return out;
  }, [rows]);

  // latestEventTs — max(event_ts). Since `rows` is server-side desc-ordered,
  // this is just rows[0].event_ts. Kept in useMemo to avoid re-computing on
  // unrelated re-renders.
  const latestEventTs = useMemo(() => {
    if (!rows.length) return null;
    return rows[0]?.event_ts ?? null;
  }, [rows]);

  const mergeInto = useCallback((scanData) => {
    if (!scanData || byTicker.size === 0) return scanData;
    const prev = scanData.signals || {};
    const nextEvents = { ...(prev.events || {}) };

    for (const [T, bucket] of byTicker) {
      nextEvents[T] = bucket;
    }

    return {
      ...scanData,
      signals: {
        ...prev,
        events: nextEvents,
      },
      // Freshness timestamp — parallel to `universe_snapshot_ts` so a
      // DataFreshness chip can read a single field regardless of source.
      ticker_events_ts: latestEventTs,
    };
  }, [byTicker, latestEventTs]);

  return {
    rows,
    byTicker,
    bySource,
    latestEventTs,
    daysBack,
    loading: loading || sessionLoading,
    error,
    mergeInto,
    refetch,
    isAuthed: Boolean(userId) && !loading && !error,
  };
}
