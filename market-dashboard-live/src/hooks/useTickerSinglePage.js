// useTickerSinglePage — focused, single-ticker data fetchers for the ticker
// detail page. Replaces the firehose hooks (useUniverseSnapshot fetching all
// 2,500 tickers; useTickerEvents fetching 30 days × all tickers) that the
// page previously used.
//
// Why this exists
// ---------------
// The ticker page renders ONE ticker. Pulling the full universe + the full
// event firehose on every page load wastes ~30 round-trips and several
// seconds. These two hooks scope the queries server-side.
//
// Shape returned matches the relevant fields of the original hooks so the
// component can read `snap.close`, `events.byTicker.get(sym).insider`, etc.
// without restructuring.

import { useEffect, useState, useMemo } from "react";
import { supabase } from "../lib/supabase";
import { useSession } from "../auth/useSession";

const UNIVERSE_COLUMNS = [
  "ticker", "snapshot_ts", "as_of_date",
  "full_name", "sector", "issue_type",
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
].join(",");

// useTickerLatestSnapshot — single-ticker, single-row latest snapshot.
// Returns { row, loading, error } where row matches the universe_snapshots
// schema (or null when no recent row exists / unauthenticated).
export function useTickerLatestSnapshot(ticker) {
  const { session, loading: sessionLoading } = useSession();
  const userId = session?.user?.id ?? null;
  const [state, setState] = useState({ row: null, loading: Boolean(ticker), error: null });

  useEffect(() => {
    if (!ticker || !userId) {
      setState({ row: null, loading: sessionLoading, error: null });
      return;
    }
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));

    (async () => {
      try {
        const { data, error } = await supabase
          .from("universe_snapshots")
          .select(UNIVERSE_COLUMNS)
          .eq("ticker", ticker.toUpperCase())
          .order("snapshot_ts", { ascending: false })
          .limit(1);
        if (cancelled) return;
        if (error) throw error;
        const row = Array.isArray(data) && data[0] ? data[0] : null;
        setState({ row, loading: false, error: null });
      } catch (err) {
        if (cancelled) return;
        // eslint-disable-next-line no-console
        console.warn("[useTickerLatestSnapshot] fetch failed:", err);
        setState({ row: null, loading: false, error: err });
      }
    })();

    return () => { cancelled = true; };
  }, [ticker, userId, sessionLoading]);

  // byTicker shape parity — lets the ticker page swap this in for the firehose
  // hook with one line of read code: `universe.byTicker.get(sym)`.
  const byTicker = useMemo(() => {
    const m = new Map();
    if (state.row?.ticker) m.set(String(state.row.ticker).toUpperCase(), state.row);
    return m;
  }, [state.row]);

  return { ...state, byTicker, snapshotTs: state.row?.snapshot_ts || null };
}

// useTickerEventsScoped — events for a single ticker over `daysBack`.
// Returns { byTicker, latestEventTs, loading, error } — same shape used by the
// page's events consumer.
const EVENT_COLUMNS = ["ticker", "source", "event_ts", "ingested_ts", "payload"].join(",");

function emptyBuckets() {
  return { news: [], insider: [], congress: [], darkpool: [] };
}

export function useTickerEventsScoped(ticker, { daysBack = 90 } = {}) {
  const { session, loading: sessionLoading } = useSession();
  const userId = session?.user?.id ?? null;
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(Boolean(ticker));
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!ticker || !userId) {
      setRows([]);
      setLoading(sessionLoading);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const cutoffIso = new Date(Date.now() - daysBack * 86400_000).toISOString();
        const { data, error: qErr } = await supabase
          .from("ticker_events")
          .select(EVENT_COLUMNS)
          .eq("ticker", ticker.toUpperCase())
          .gte("event_ts", cutoffIso)
          .order("event_ts", { ascending: false })
          .limit(500);
        if (cancelled) return;
        if (qErr) throw qErr;
        setRows(Array.isArray(data) ? data : []);
        setLoading(false);
      } catch (err) {
        if (cancelled) return;
        // eslint-disable-next-line no-console
        console.warn("[useTickerEventsScoped] fetch failed:", err);
        setError(err);
        setRows([]);
        setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [ticker, userId, daysBack, sessionLoading]);

  const byTicker = useMemo(() => {
    const m = new Map();
    if (!ticker) return m;
    const bucket = emptyBuckets();
    for (const r of rows) {
      if (!r?.source) continue;
      const arr = bucket[r.source];
      if (arr) arr.push(r);
    }
    m.set(ticker.toUpperCase(), bucket);
    return m;
  }, [rows, ticker]);

  const latestEventTs = useMemo(() => rows[0]?.event_ts || null, [rows]);

  return { byTicker, latestEventTs, loading, error, rows };
}
