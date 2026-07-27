/* useLseIvDaily — daily ATM implied vol + cross-sectional volatility rank
   for scanner names (London Strategic Edge feed, 2026-07-27).

   Source table: public.lse_iv_daily, written once per trading day by the
   lse-live edge function's scan batch (pg_cron 21:50 UTC weekdays; health
   row lse_iv_scan). Reads the latest trade_date only. A name with no row is
   an accepted coverage gap (foreign names / some funds) — the column shows
   an em-dash (Joe 2026-07-27; LESSONS 4.4). */

import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

let _cache = null;
let _inflight = null;
const TTL_MS = 5 * 60 * 1000;

async function fetchIvDaily() {
  const latest = await supabase
    .from('lse_iv_daily')
    .select('trade_date')
    .order('trade_date', { ascending: false })
    .limit(1);
  const d = latest?.data?.[0]?.trade_date;
  if (!d) return { byTicker: {}, tradeDate: null };
  const rows = await supabase
    .from('lse_iv_daily')
    .select('ticker, atm_iv, vol_rank')
    .eq('trade_date', d)
    .limit(1000);
  const byTicker = {};
  for (const r of rows.data || []) {
    byTicker[r.ticker] = {
      atmIv: r.atm_iv != null ? Number(r.atm_iv) : null,
      volRank: r.vol_rank != null ? Number(r.vol_rank) : null,
    };
  }
  return { byTicker, tradeDate: d };
}

export default function useLseIvDaily() {
  const [state, setState] = useState(() => _cache || { byTicker: {}, tradeDate: null });

  useEffect(() => {
    let cancelled = false;
    if (_cache && Date.now() - _cache._at < TTL_MS) return undefined;
    if (!_inflight) {
      _inflight = fetchIvDaily()
        .then((r) => { _cache = { ...r, _at: Date.now() }; _inflight = null; return _cache; })
        .catch(() => { _inflight = null; return { byTicker: {}, tradeDate: null }; });
    }
    _inflight.then((r) => { if (!cancelled) setState(r); });
    return () => { cancelled = true; };
  }, []);

  return state;
}
