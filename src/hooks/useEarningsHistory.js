// useEarningsHistory — last-4-quarters EPS beats/misses for one ticker.
//
// Reads from public.earnings_history (refreshed weekly by the
// EARNINGS-HISTORY-WEEKLY workflow). Returns the rows ordered chronologically
// (oldest → newest) so the modal can render the strip left-to-right.
//
// Bug #1134 item 5. Pipeline owner: trading-scanner/run_earnings_history.py.
//
// Returns: { quarters, loading, error }
//   quarters[i] = { date, estimate, actual, surprisePct, beat }

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

export function useEarningsHistory(ticker) {
  const [quarters, setQuarters] = useState([]);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState(null);

  useEffect(() => {
    if (!ticker) { setQuarters([]); return; }
    let cancelled = false;
    setLoading(true); setError(null);
    (async () => {
      try {
        const { data, error: e } = await supabase
          .from("earnings_history")
          .select("report_date, eps_estimate, eps_actual, surprise_pct, beat")
          .eq("ticker", ticker)
          .order("report_date", { ascending: true })
          .limit(4);
        if (cancelled) return;
        if (e) throw e;
        const rows = (data || []).map(r => ({
          date:        r.report_date,
          estimate:    r.eps_estimate,
          actual:      r.eps_actual,
          surprisePct: r.surprise_pct,
          beat:        r.beat,
        }));
        setQuarters(rows);
      } catch (e) {
        if (!cancelled) setError(e.message || String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [ticker]);

  return { quarters, loading, error };
}
