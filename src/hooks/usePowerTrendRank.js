// usePowerTrendRank — is this ticker on the current Power Trend (Momentum
// scanner) list, and at what rank?
//
// Reads the latest rebalance batch of power_trend_list (monthly, migration
// 081). Returns { row, loading } where row is the ticker's list entry
// ({ rank, ticker, name, roc_3m, rebalance_date, next_rebalance_date }) or
// null when the name isn't on the current list (or the list is all-CASH).
//
// Used by the Ticker page header to say WHICH scanner surfaced a name that
// has no Insider-scan score (2026-07-20: the score block is scoped to
// Insider-scan names only; everything else shows its source scanner).
//
// Module-level cache: the latest list is one small query (≤50 rows) shared
// across every ticker page opened in a session.
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

let _cache = null;          // { byTicker: Map, at: number }
let _inflight = null;
const TTL_MS = 10 * 60 * 1000;

async function fetchList() {
  const latest = await supabase
    .from("power_trend_list")
    .select("rebalance_date")
    .order("rebalance_date", { ascending: false })
    .limit(1);
  if (latest.error) throw latest.error;
  const date = latest.data?.[0]?.rebalance_date || null;
  const byTicker = new Map();
  if (date) {
    const res = await supabase
      .from("power_trend_list")
      .select("rank, ticker, name, roc_3m, rebalance_date, next_rebalance_date")
      .eq("rebalance_date", date)
      .order("rank", { ascending: true });
    if (res.error) throw res.error;
    for (const r of res.data || []) {
      // CASH sentinel row (rank 0) = zero-signal month, not a holding.
      if (r.ticker && r.ticker !== "CASH") byTicker.set(String(r.ticker).toUpperCase(), r);
    }
  }
  return byTicker;
}

export default function usePowerTrendRank(ticker) {
  const upper = ticker ? String(ticker).toUpperCase() : null;
  const fresh = _cache && Date.now() - _cache.at < TTL_MS;
  const [state, setState] = useState(() => ({
    row: fresh && upper ? (_cache.byTicker.get(upper) || null) : null,
    loading: !fresh,
  }));

  useEffect(() => {
    if (!upper) { setState({ row: null, loading: false }); return undefined; }
    if (_cache && Date.now() - _cache.at < TTL_MS) {
      setState({ row: _cache.byTicker.get(upper) || null, loading: false });
      return undefined;
    }
    let alive = true;
    if (!_inflight) {
      _inflight = fetchList()
        .then((byTicker) => { _cache = { byTicker, at: Date.now() }; return byTicker; })
        .finally(() => { _inflight = null; });
    }
    _inflight
      .then((byTicker) => { if (alive) setState({ row: byTicker.get(upper) || null, loading: false }); })
      .catch(() => { if (alive) setState({ row: null, loading: false }); });
    return () => { alive = false; };
  }, [upper]);

  return state;
}
