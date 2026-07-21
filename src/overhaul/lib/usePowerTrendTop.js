// usePowerTrendTop — the top-N names on the current Power Trend (Momentum
// scanner) list, for the homepage Trading Scanner tile.
//
// Reads the latest rebalance batch of power_trend_list (monthly, migration
// 081) — same table, same batch-selection logic as the Scanner page's
// MomentumPanel and the ticker header's usePowerTrendRank. No new math:
// rank and roc_3m (already in PERCENT units) pass straight through.
// The CASH sentinel row (rank 0, zero-signal month) is excluded; when the
// list is all-CASH the hook returns an empty array and the tile renders
// its empty state.
//
// Module-level cache — one ≤50-row query per session, shared across renders.
import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';

let _cache = null; // { rows, at }
let _inflight = null;
const TTL_MS = 10 * 60 * 1000;

async function fetchTop() {
  const latest = await supabase
    .from('power_trend_list')
    .select('rebalance_date')
    .order('rebalance_date', { ascending: false })
    .limit(1);
  if (latest.error) throw latest.error;
  const date = latest.data?.[0]?.rebalance_date || null;
  if (!date) return [];
  const res = await supabase
    .from('power_trend_list')
    .select('rank, ticker, name, roc_3m, rebalance_date')
    .eq('rebalance_date', date)
    .order('rank', { ascending: true });
  if (res.error) throw res.error;
  return (res.data || []).filter((r) => r.ticker && r.ticker !== 'CASH');
}

export default function usePowerTrendTop(n = 3) {
  const fresh = _cache && Date.now() - _cache.at < TTL_MS;
  const [rows, setRows] = useState(() => (fresh ? _cache.rows.slice(0, n) : []));
  const [loading, setLoading] = useState(!fresh);

  useEffect(() => {
    if (_cache && Date.now() - _cache.at < TTL_MS) {
      setRows(_cache.rows.slice(0, n));
      setLoading(false);
      return undefined;
    }
    let alive = true;
    if (!_inflight) {
      _inflight = fetchTop()
        .then((all) => { _cache = { rows: all, at: Date.now() }; return all; })
        .catch(() => { _cache = { rows: [], at: Date.now() }; return []; })
        .finally(() => { _inflight = null; });
    }
    _inflight.then((all) => {
      if (!alive) return;
      setRows((all || []).slice(0, n));
      setLoading(false);
    });
    return () => { alive = false; };
  }, [n]);

  return { rows, loading };
}
