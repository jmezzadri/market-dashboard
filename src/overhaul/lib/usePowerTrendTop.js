// usePowerTrendTop — the top-N names on the current Power Trend (Momentum
// scanner) list, for the homepage Trading Scanner tile.
//
// Reads the latest rebalance batch of power_trend_list (monthly, migration
// 081) — same table, same batch-selection logic as the ticker header's
// usePowerTrendRank. No new math: rank, roc_3m (already in PERCENT units)
// and breakout_volx (breakout-day volume as a multiple of the 20-day
// average) pass straight through.
//
// 2026-08-11: the Scanner page's Power Trend Momentum panel was deleted with
// the Conviction Events rebuild, so this hook and usePowerTrendRank are the
// list's only two site surfaces. The monthly producer keeps running.
// ret_since is display enrichment: the latest prices_eod close vs the
// selection-day close stored on the list row itself, in percent — "how is
// this pick doing since it was picked" (Joe, 2026-07-21: a live 10-day
// return next to selection-day breakout stats read as contradictory).
// If either close is missing the field is null and the tile renders an
// em-dash (LESSON 4.4) — never a fabricated value.
// The CASH sentinel row (rank 0, zero-signal month) is excluded; when the
// list is all-CASH the hook returns an empty array and the tile renders
// its empty state.
//
// Module-level cache — one small query set per session, shared across renders.
import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';

let _cache = null; // { rows, at }
let _inflight = null;
const TTL_MS = 10 * 60 * 1000;
const ENRICH_N = 5; // compute ret_since for at most this many names

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
    .select('rank, ticker, name, roc_3m, breakout_volx, close, rebalance_date')
    .eq('rebalance_date', date)
    .order('rank', { ascending: true });
  if (res.error) throw res.error;
  const rows = (res.data || []).filter((r) => r.ticker && r.ticker !== 'CASH');

  // Display enrichment: latest close per shown name from prices_eod.
  // Failure blanks the column, never the list. ~5 tickers × ~8 bars ≈ 40
  // rows — far below the PostgREST 1,000-row cap (LESSON 4.18).
  const head = rows.slice(0, ENRICH_N);
  if (head.length) {
    try {
      const since = new Date(Date.now() - 10 * 86400e3).toISOString().slice(0, 10);
      const bars = await supabase
        .from('prices_eod')
        .select('ticker, trade_date, close')
        .in('ticker', head.map((r) => r.ticker))
        .gte('trade_date', since)
        .order('trade_date', { ascending: false });
      if (!bars.error) {
        const lastClose = {};
        (bars.data || []).forEach((b) => {
          if (lastClose[b.ticker] == null) lastClose[b.ticker] = Number(b.close);
        });
        rows.forEach((r) => {
          const last = lastClose[r.ticker];
          const sel = Number(r.close);
          r.ret_since = Number.isFinite(last) && Number.isFinite(sel) && sel > 0
            ? ((last / sel) - 1) * 100 : null;
        });
      }
    } catch { /* ret_since stays undefined → em-dash */ }
  }
  return rows;
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
