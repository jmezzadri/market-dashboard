// useScanScoreHistory — per-name score history for the Trading Scanner.
//
// The nightly scan table (public.trading_opps_signals) keeps one row per name
// per scan day, going back several weeks. This hook pulls the trailing window
// for every name and derives — from the REAL stored scores, never fabricated:
//
//   byTicker[TICKER] = {
//     series:     [{ d:'YYYY-MM-DD', s:Number }, ...]  // the name's own list-days, oldest→newest
//     today:      Number        // score on the latest scan day
//     delta:      Number|null   // today − score on the prior scan day (null if it wasn't on the list then = "new")
//     daysOnList: Number        // consecutive scan days on the list ending today
//     peak:       Number        // highest score across the window
//   }
//   movers:    [{ ticker, today, prior, delta }]   // names whose score changed vs the prior scan day, biggest move first
//   latestDate, priorDate
//
// The pre-stored score_1w / score_1m columns are sparsely populated, so we
// reconstruct the path from the daily rows instead — the source of truth.

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

let _cache = null;
const CACHE_TTL_MS = 5 * 60 * 1000;
let _inflight = null;

// How many of the name's own list-days to keep for the mini score chart.
const SERIES_CAP = 12;
// Calendar window to pull (≈ 30 days ⇒ ~20 trading days of scans).
const WINDOW_DAYS = 30;

const num = (v) => (v == null || !Number.isFinite(Number(v)) ? null : Number(v));

async function fetchHistory() {
  // 1. Latest scan day.
  const latestRes = await supabase
    .from("trading_opps_signals")
    .select("scan_date")
    .order("scan_date", { ascending: false })
    .limit(1);
  if (latestRes.error) throw latestRes.error;
  const latestDate = latestRes?.data?.[0]?.scan_date || null;
  if (!latestDate) {
    return { byTicker: {}, movers: [], latestDate: null, priorDate: null };
  }

  // 2. Trailing window of (ticker, scan_date, score).
  const since = new Date(latestDate);
  since.setDate(since.getDate() - WINDOW_DAYS);
  const sinceIso = since.toISOString().slice(0, 10);

  const histRes = await supabase
    .from("trading_opps_signals")
    .select("ticker,scan_date,score")
    .gte("scan_date", sinceIso)
    .order("scan_date", { ascending: true });
  if (histRes.error) throw histRes.error;

  const rows = (histRes.data || []).filter(
    (r) => r && r.ticker && r.scan_date && Number.isFinite(Number(r.score))
  );

  // Distinct scan days present in the window, oldest→newest.
  const dateSet = Array.from(new Set(rows.map((r) => r.scan_date))).sort();
  const priorDate = dateSet.length >= 2 ? dateSet[dateSet.length - 2] : null;

  // Group scores by ticker → { date: score }.
  const byDateScore = new Map(); // ticker -> Map(date->score)
  for (const r of rows) {
    let m = byDateScore.get(r.ticker);
    if (!m) { m = new Map(); byDateScore.set(r.ticker, m); }
    m.set(r.scan_date, Number(r.score));
  }

  const byTicker = {};
  const movers = [];

  for (const [ticker, m] of byDateScore.entries()) {
    if (!m.has(latestDate)) continue; // only names on the latest list
    const today = m.get(latestDate);

    // The name's own list-days within the window (oldest→newest), capped.
    const series = dateSet
      .filter((d) => m.has(d))
      .map((d) => ({ d, s: m.get(d) }))
      .slice(-SERIES_CAP);

    // Day-over-day delta vs the prior scan day (null = wasn't on the list = new).
    const priorScore = priorDate != null && m.has(priorDate) ? m.get(priorDate) : null;
    const delta = priorScore == null ? null : Number((today - priorScore).toFixed(2));

    // Consecutive scan days on the list ending today (calendar is the scan days
    // themselves, so this skips weekends/holidays automatically).
    let daysOnList = 0;
    for (let i = dateSet.length - 1; i >= 0; i--) {
      if (m.has(dateSet[i])) daysOnList += 1;
      else break;
    }

    const peak = series.reduce((mx, p) => Math.max(mx, p.s), today);

    byTicker[ticker] = { series, today, delta, daysOnList, peak };

    if (delta != null && delta !== 0) {
      movers.push({ ticker, today, prior: priorScore, delta });
    }
  }

  // Biggest absolute move first; gainers and losers interleave by magnitude.
  movers.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  return { byTicker, movers, latestDate, priorDate };
}

export default function useScanScoreHistory() {
  const [state, setState] = useState({
    byTicker: _cache?.byTicker || {},
    movers: _cache?.movers || [],
    latestDate: _cache?.latestDate || null,
    priorDate: _cache?.priorDate || null,
    loading: !_cache,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;

    const now = Date.now();
    if (_cache && now - _cache.ts < CACHE_TTL_MS) {
      setState({ ...(_cache), loading: false, error: null });
      return () => { cancelled = true; };
    }

    const p = _inflight || (_inflight = fetchHistory().finally(() => { _inflight = null; }));

    p.then((res) => {
      _cache = { ...res, ts: Date.now() };
      if (cancelled) return;
      setState({ ...res, loading: false, error: null });
    }).catch((err) => {
      if (cancelled) return;
      setState((s) => ({ ...s, loading: false, error: err?.message || String(err) }));
    });

    return () => { cancelled = true; };
  }, []);

  return state;
}
