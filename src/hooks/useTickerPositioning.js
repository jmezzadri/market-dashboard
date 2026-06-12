// useTickerPositioning — short-interest + options-flow context for ONE ticker.
//
// Reads three aggregate feed tables (read exposure granted in migration 065):
//   short_interest        — FINRA bi-monthly settlement rows (source=finra)
//   short_interest_daily  — UW daily short volume / borrow market rows
//   options_flow_daily    — UW flow-alert aggregates, trailing-30d window
//
// Staleness fences match the nightly producer (run_screener.fetch_positioning):
// FINRA 45 calendar days, the two dailies 7 calendar days — an older row is
// treated as missing (returned null), never silently displayed as current.
// These are informational context fields; they never feed the score.

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

const isoDaysAgo = (n) => {
  const d = new Date(Date.now() - n * 86400e3);
  return d.toISOString().slice(0, 10);
};

export default function useTickerPositioning(sym) {
  const [state, setState] = useState({ finra: null, daily: null, flow: null, loading: true });

  useEffect(() => {
    if (!sym) { setState({ finra: null, daily: null, flow: null, loading: false }); return; }
    let dead = false;
    (async () => {
      setState((s) => ({ ...s, loading: true }));
      const [finra, daily, flow] = await Promise.all([
        supabase.from("short_interest")
          .select("as_of_date,short_interest_shares,short_interest_float_pct,days_to_cover,avg_daily_volume")
          .eq("ticker", sym).eq("source", "finra")
          .gte("as_of_date", isoDaysAgo(45))
          .order("as_of_date", { ascending: false }).limit(1),
        supabase.from("short_interest_daily")
          .select("as_of_date,short_volume,total_volume,short_volume_ratio,borrow_shares_available,cost_to_borrow_pct,ftd_quantity")
          .eq("ticker", sym)
          .gte("as_of_date", isoDaysAgo(7))
          .order("as_of_date", { ascending: false }).limit(1),
        supabase.from("options_flow_daily")
          .select("as_of_date,call_premium,put_premium,call_count,put_count,ask_side_premium,bid_side_premium,sweep_count,unusual_count")
          .eq("ticker", sym)
          .gte("as_of_date", isoDaysAgo(7))
          .order("as_of_date", { ascending: false }).limit(1),
      ]);
      if (dead) return;
      setState({
        finra: finra.data?.[0] || null,
        daily: daily.data?.[0] || null,
        flow: flow.data?.[0] || null,
        loading: false,
      });
    })();
    return () => { dead = true; };
  }, [sym]);

  return state;
}
