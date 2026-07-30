// usePowerTrendList — fetch the latest monthly Power Trend Momentum list
// (public.power_trend_list) for the Scanner cockpit tile.
//
// READ-ONLY DISPLAY DATA — no scoring, no engine read. Same table and same
// column set MomentumPanel already reads; this hook exists so the cockpit
// tile can show the top of the list without mounting the full panel.
// Pattern mirrors useDivergenceScan / useTradingOppsTop: latest
// rebalance_date first, then that date's rows; 5-minute in-memory cache
// with an in-flight promise guard so N mounted consumers hit the DB once.
//
// Returns {
//   rows,      // [{ rank, ticker, name, roc_3m, rs_vs_spx, breakout_volx, adv_usd, close }]
//   asOf,      // 'YYYY-MM-DD' rebalance date
//   next,      // 'YYYY-MM-DD' next rebalance date (or null)
//   allCash,   // true when the CASH sentinel row is the whole list
//   loading, error,
// }

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

let _cache = null;
const CACHE_TTL_MS = 5 * 60 * 1000;
let _inflight = null;

async function fetchList() {
  const latest = await supabase
    .from("power_trend_list")
    .select("rebalance_date")
    .order("rebalance_date", { ascending: false })
    .limit(1);
  if (latest.error) throw latest.error;
  const rd = latest?.data?.[0]?.rebalance_date;
  if (!rd) return { rows: [], asOf: null, next: null, allCash: false };

  const list = await supabase
    .from("power_trend_list")
    .select("rank, ticker, name, roc_3m, rs_vs_spx, breakout_volx, adv_usd, close, rebalance_date, next_rebalance_date")
    .eq("rebalance_date", rd)
    .order("rank", { ascending: true });
  if (list.error) throw list.error;

  const all = list.data || [];
  const allCash = all.length > 0 && all.every((r) => r.ticker === "CASH" && Number(r.rank) === 0);
  const rows = allCash ? [] : all.filter((r) => r.ticker !== "CASH");
  return { rows, asOf: rd, next: all[0]?.next_rebalance_date || null, allCash };
}

export default function usePowerTrendList() {
  const [state, setState] = useState({
    rows: _cache?.rows || [],
    asOf: _cache?.asOf || null,
    next: _cache?.next || null,
    allCash: _cache?.allCash || false,
    loading: !_cache,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;

    const now = Date.now();
    if (_cache && now - _cache.ts < CACHE_TTL_MS) {
      setState({ ..._cache, loading: false, error: null });
      return () => { cancelled = true; };
    }

    const p = _inflight || (_inflight = fetchList().finally(() => { _inflight = null; }));

    p.then((data) => {
      _cache = { ...data, ts: Date.now() };
      if (cancelled) return;
      setState({ ...data, loading: false, error: null });
    }).catch((err) => {
      if (cancelled) return;
      setState((s) => ({ ...s, loading: false, error: err?.message || String(err) }));
    });

    return () => { cancelled = true; };
  }, []);

  return state;
}
