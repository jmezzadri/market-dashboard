// useTickerEodPrice — authoritative last-close + prev-close + trade_date
// for any ticker, sourced from prices_eod (Polygon Massive EOD).
//
// Why this exists:
//   The TickerDetailModal used to read price from a chain of overlays
//   (signal_intel_v5_daily.diagnostic, universe_snapshots, the public
//   latest_scan_data.json artifact, …). Each of those is on its own
//   refresh cadence, with its own coverage gap, and ordered by its own
//   key. For LUNR on 2026-05-12 the chain picked up an older prices_eod
//   row via the wrong ordering and rendered $24.11 (close from 5/7) when
//   the latest close was $32.42 (5/11). Joe's bug report driving this fix.
//
// What it returns:
//   { last_close, prev_close, trade_date, prev_trade_date, day_pct,
//     loading, source: "prices_eod", error }
//
//   trade_date / prev_trade_date are the actual trading-day labels of the
//   two values — these are what the freshness chip MUST anchor to, not
//   "the pipeline ran today at 4 AM". A user reading "Last close: Mon
//   May 11" knows exactly what the price is from; "today 4:07 AM ET" is
//   misleading whenever the data is a back-fill or a stale row.
//
// Performance:
//   Two prices_eod lookups per modal open, ordered by trade_date DESC
//   LIMIT 1 (and LIMIT 1 OFFSET 1). Indexed on (ticker, trade_date).
//   Under 50 ms in practice.
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

const EMPTY = {
  last_close: null,
  prev_close: null,
  trade_date: null,
  prev_trade_date: null,
  day_pct: null,
  loading: false,
  source: null,
  error: null,
};

export default function useTickerEodPrice(ticker) {
  const [state, setState] = useState(EMPTY);

  useEffect(() => {
    if (!ticker) {
      setState(EMPTY);
      return;
    }
    let cancelled = false;
    setState(s => ({ ...s, loading: true, error: null }));

    const upper = ticker.toUpperCase();
    (async () => {
      try {
        // Pull the latest two rows of prices_eod for this ticker, ordered
        // by trade_date DESC. Two rows = today's close + prior trading
        // day's close, which together give us the day-% change. If the
        // ticker has only one row of history (brand-new listing), prev
        // is null and day_pct stays null — we deliberately don't fall
        // back to anything stale.
        const { data, error } = await supabase
          .from("prices_eod")
          .select("close, trade_date")
          .eq("ticker", upper)
          .order("trade_date", { ascending: false })
          .limit(2);
        if (cancelled) return;
        if (error) {
          setState({ ...EMPTY, error: error.message || String(error) });
          return;
        }
        const rows = Array.isArray(data) ? data : [];
        const cur  = rows[0] || null;
        const prev = rows[1] || null;
        const last_close  = cur  ? Number(cur.close)  : null;
        const prev_close  = prev ? Number(prev.close) : null;
        const day_pct =
          Number.isFinite(last_close) &&
          Number.isFinite(prev_close) &&
          prev_close > 0
            ? ((last_close - prev_close) / prev_close) * 100
            : null;
        setState({
          last_close,
          prev_close,
          trade_date: cur?.trade_date || null,
          prev_trade_date: prev?.trade_date || null,
          day_pct,
          loading: false,
          source: "prices_eod",
          error: null,
        });
      } catch (e) {
        if (!cancelled) {
          setState({ ...EMPTY, error: e?.message || String(e) });
        }
      }
    })();

    return () => { cancelled = true; };
  }, [ticker]);

  return state;
}
