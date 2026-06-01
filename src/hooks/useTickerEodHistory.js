// useTickerEodHistory — full daily OHLCV history for one ticker from
// prices_eod (Polygon Massive / Yahoo same-day backfill). This is the real
// series the Ticker Detail price chart draws — it replaces the synthetic
// random-walk `fakePath` placeholder that shipped on that page.
//
// Returns rows ascending by trade_date so the chart and any moving-average
// overlay read left-to-right in time:
//   { rows: [{ date, close, high, low, open, volume }], lastDate, loading, error }
//
// We pull a generous window (default ~1300 sessions ≈ 5y, the practical cap
// on the Basic data tier) so 50- and 200-day moving averages are accurate
// even at the left edge of a short display window; the page slices to the
// selected timeframe for display while computing SMAs over the full set.

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

const num = (v) => (v == null || !Number.isFinite(Number(v)) ? null : Number(v));

export default function useTickerEodHistory(ticker, maxRows = 1300) {
  const [state, setState] = useState({ rows: [], lastDate: null, loading: !!ticker, error: null });

  useEffect(() => {
    if (!ticker) {
      setState({ rows: [], lastDate: null, loading: false, error: null });
      return;
    }
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));
    const upper = ticker.toUpperCase();

    (async () => {
      try {
        const { data, error } = await supabase
          .from("prices_eod")
          .select("trade_date, open, high, low, close, volume")
          .eq("ticker", upper)
          .order("trade_date", { ascending: false })
          .limit(maxRows);
        if (error) throw new Error(error.message || String(error));
        if (cancelled) return;

        const rows = (Array.isArray(data) ? data : [])
          .map((r) => ({
            date: r.trade_date,
            open: num(r.open),
            high: num(r.high),
            low: num(r.low),
            close: num(r.close),
            volume: num(r.volume),
          }))
          .filter((r) => r.date && r.close != null)
          .reverse(); // ascending by date

        setState({
          rows,
          lastDate: rows.length ? rows[rows.length - 1].date : null,
          loading: false,
          error: null,
        });
      } catch (e) {
        if (!cancelled) setState({ rows: [], lastDate: null, loading: false, error: e?.message || String(e) });
      }
    })();

    return () => { cancelled = true; };
  }, [ticker, maxRows]);

  return state;
}
