// useTradingOppsTop — fetch the highest-scoring names from the latest
// nightly Trading Opportunities scan (public.trading_opps_signals).
//
// 2026-06-01 rebuild: previously this hook SELECTed only
// ticker,score,signal,sector and discarded everything else — which forced
// the scanner UI to fabricate sparklines, prices, per-component scores, and
// events. The scan table actually stores real values for every one of those
// (price, change, volume, 52w range, market cap, a real spark series, the
// per-component point fields that sum to the score, the plain-English
// "so_what", and entry/stop/target). We now pull them all so the scanner,
// the expanded drill, and the ticker page read the SAME real row.
//
// Returns {
//   rows,        // enriched scan rows — see mapRow below
//   bandCounts,  // { score5, score4, score3, total }
//   scanDate,    // 'YYYY-MM-DD'
//   loading, error,
// }

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

let _cache = null;
const CACHE_TTL_MS = 5 * 60 * 1000;
let _inflight = null;

// Score band — identical cutoffs to the Trading Opportunities page:
// 5 = score >= 4.5, 4 = 3.5-4.49, 3 = everything that launched.
function scoreBand(s) {
  const n = Number(s);
  if (!Number.isFinite(n)) return 3;
  if (n >= 4.5) return 5;
  if (n >= 3.5) return 4;
  return 3;
}

const num = (v) => (v == null || !Number.isFinite(Number(v)) ? null : Number(v));

// Map a raw scan row into the shape the UI components read. change_pct is
// already stored in percent units (e.g. -0.072 == -0.072%), so it passes
// straight through to `chg`.
function mapRow(r) {
  return {
    ticker: r.ticker,
    name: r.company_name || null,
    sector: r.sector || null,
    signal: r.signal || null,
    score: num(r.score),
    score_1w: num(r.score_1w),
    score_1m: num(r.score_1m),
    band: scoreBand(r.score),

    // price block
    price: num(r.price),
    chg: num(r.change_pct),
    chgUsd: num(r.change_usd),
    chg30: num(r.chg_30d_pct),
    volume: num(r.volume),
    relVolume: num(r.rel_volume),
    week52Low: num(r.week_52_low),
    week52High: num(r.week_52_high),
    marketCap: num(r.market_cap),

    // real sparkline series (close prices) — null if the engine didn't store one
    sparkData: Array.isArray(r.spark) && r.spark.length ? r.spark.map(Number) : null,

    // per-component point fields (these SUM to score) — see scoreWeights.js
    insider_pts: num(r.insider_pts),
    insider_rules: Array.isArray(r.insider_rules) ? r.insider_rules : [],
    insider_age_days: num(r.insider_age_days),
    sma200_pct: num(r.sma200_pct),
    sma200_pts: num(r.sma200_pts),
    rsi: num(r.rsi),
    rsi_pts: num(r.rsi_pts),
    dark_pool_anchor: num(r.dark_pool_anchor),
    dark_pool_pts: num(r.dark_pool_pts),
    options_vol_shock: num(r.options_vol_shock),
    options_pts: num(r.options_pts),

    // positioning context (informational; not part of the score)
    si_float_pct: num(r.si_float_pct),
    si_days_to_cover: num(r.si_days_to_cover),
    si_short_vol_ratio: num(r.si_short_vol_ratio),
    si_cost_to_borrow_pct: num(r.si_cost_to_borrow_pct),
    si_as_of: r.si_as_of || null,
    flow_net_call_prem_usd: num(r.flow_net_call_prem_usd),
    flow_ask_side_share: num(r.flow_ask_side_share),
    flow_sweep_count: num(r.flow_sweep_count),
    flow_unusual_count: num(r.flow_unusual_count),
    flow_as_of: r.flow_as_of || null,

    // context + trade plan
    iv: num(r.iv),
    iv_rank: num(r.iv_rank),
    pc_ratio: num(r.pc_ratio),
    implied_30d_pct: num(r.implied_30d_pct),
    entry: num(r.entry),
    stop: num(r.stop),
    target: num(r.target),
    so_what: r.so_what || null,
    lastTradeTs: r.last_trade_ts || null,
    scoringVersion: r.scoring_version || null,
  };
}

async function fetchAll(limit) {
  // 1. Most recent scan_date.
  const latestRes = await supabase
    .from("trading_opps_signals")
    .select("scan_date")
    .order("scan_date", { ascending: false })
    .limit(1);
  if (latestRes.error) throw latestRes.error;
  const latest = latestRes?.data?.[0]?.scan_date || null;
  if (!latest) {
    return {
      rows: [],
      bandCounts: { score5: 0, score4: 0, score3: 0, total: 0 },
      scanDate: null,
    };
  }

  // 2. Every launched row for that scan_date (~21), with the full column set.
  const scanRes = await supabase
    .from("trading_opps_signals")
    .select("*")
    .eq("scan_date", latest)
    .order("score", { ascending: false, nullsFirst: false });
  if (scanRes.error) throw scanRes.error;

  const all = (scanRes.data || []).filter(
    (r) => r && Number.isFinite(Number(r.score))
  );

  const counts = { score5: 0, score4: 0, score3: 0, total: all.length };
  for (const r of all) {
    const b = scoreBand(r.score);
    if (b === 5) counts.score5++;
    else if (b === 4) counts.score4++;
    else counts.score3++;
  }

  const rows = all.slice(0, limit).map(mapRow);
  return { rows, bandCounts: counts, scanDate: latest };
}

export default function useTradingOppsTop(limit = 6) {
  const [state, setState] = useState({
    rows: _cache?.rows ? _cache.rows.slice(0, limit) : [],
    bandCounts: _cache?.bandCounts || { score5: 0, score4: 0, score3: 0, total: 0 },
    scanDate: _cache?.scanDate || null,
    loading: !_cache,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;

    const now = Date.now();
    if (_cache && now - _cache.ts < CACHE_TTL_MS) {
      setState({
        rows: _cache.rows.slice(0, limit),
        bandCounts: _cache.bandCounts,
        scanDate: _cache.scanDate,
        loading: false,
        error: null,
      });
      return () => { cancelled = true; };
    }

    const p =
      _inflight ||
      (_inflight = fetchAll(Math.max(limit, 100)).finally(() => {
        _inflight = null;
      }));

    p.then(({ rows, bandCounts, scanDate }) => {
      _cache = { rows, bandCounts, scanDate, ts: Date.now() };
      if (cancelled) return;
      setState({
        rows: rows.slice(0, limit),
        bandCounts,
        scanDate,
        loading: false,
        error: null,
      });
    }).catch((err) => {
      if (cancelled) return;
      setState((s) => ({ ...s, loading: false, error: err?.message || String(err) }));
    });

    return () => { cancelled = true; };
  }, [limit]);

  return state;
}
