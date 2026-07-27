// useTickerEodHistory — full daily OHLCV history for one ticker from
// prices_eod (Polygon Massive / Yahoo same-day backfill). This is the real
// series the Ticker Detail price chart draws — it replaces the synthetic
// random-walk `fakePath` placeholder that shipped on that page.
//
// Returns rows ascending by trade_date so the chart and any moving-average
// overlay read left-to-right in time:
//   { rows: [{ date, close, high, low, open, volume }], lastDate, loading, error }
//
// We pull everything stored (default cap 8,000 sessions — deep names reach
// the 1996 site floor, Hard Rule 0.5) so the Max view is honest and 50/200-day
// moving averages are accurate even at the left edge; the page slices to the
// selected timeframe for display while computing SMAs over the full set.
//
// Deep-history self-heal (2026-07-27, Joe: "why does HUT stop at Feb 2025?"):
// the bulk universe only carries ~18 months from the capped Polygon backfill.
// When the earliest stored row is younger than ~4.7 years, this hook asks the
// eod-backfill-history function to extend the series (Yahoo, seam-checked,
// older rows only) and refetches — one-time per ticker, no-op once deep.

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

const num = (v) => (v == null || !Number.isFinite(Number(v)) ? null : Number(v));

export default function useTickerEodHistory(ticker, maxRows = 8000) {
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
        // Supabase caps each response at ~1000 rows, so page through with
        // range() until we've pulled everything up to maxRows — otherwise a
        // 6-year history silently truncates to ~4 years on the Max view.
        const PAGE = 1000;
        const fetchAll = async () => {
          let data = [];
          for (let from = 0; from < maxRows; from += PAGE) {
            const to = Math.min(from + PAGE - 1, maxRows - 1);
            const { data: page, error } = await supabase
              .from("prices_eod")
              .select("trade_date, open, high, low, close, volume")
              .eq("ticker", upper)
              .order("trade_date", { ascending: false })
              .range(from, to);
            if (error) throw new Error(error.message || String(error));
            const arr = Array.isArray(page) ? page : [];
            data = data.concat(arr);
            if (arr.length < (to - from + 1)) break;  // last page reached
          }
          return data
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
        };

        let rows = await fetchAll();
        if (cancelled) return;

        // Deep-history self-heal: shallow series → server-side backfill
        // (idempotent, seam-checked, writes only older rows) → refetch.
        // sessionStorage marker keeps repeat visits in one session from
        // re-asking about names that have no deeper history to give.
        try {
          const earliest = rows.length ? rows[0].date : null;
          const DEEP_MS = 4.7 * 365 * 86400000;
          const seenKey = `mt-eod-backfill-${upper}`;
          if (earliest && Date.now() - Date.parse(earliest) < DEEP_MS && !sessionStorage.getItem(seenKey)) {
            sessionStorage.setItem(seenKey, "1");
            const { data: bf } = await supabase.functions.invoke("eod-backfill-history", { body: { ticker: upper } });
            if (!cancelled && bf?.inserted > 0) rows = await fetchAll();
          }
        } catch { /* chart still renders with what we have */ }
        if (cancelled) return;

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
