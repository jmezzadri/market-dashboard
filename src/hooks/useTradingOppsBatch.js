// useTradingOppsBatch — batch fetch the rebuilt screener's nightly results
// (public.trading_opps_signals) for a list of tickers, so the Portfolio
// Insights watchlist surfaces the SAME screener columns the Trading
// Opportunities page shows. Re-pointed off useV5ScanBatch (the retired
// six-signal model) on 2026-05-21 as Phase 7 of the screener overhaul.
//
// The rebuilt screener publishes only LAUNCHED names. A watchlist ticker
// that did not launch in the latest scan has no row — byTicker[T] is null
// and every screener column renders an em-dash for it. That is correct
// and honest: the screener flags names, it does not score the whole
// universe the way the old model did.
//
// Pattern mirrors useV5ScanBatch — a module-level cache keyed by ticker so
// the hook can be called from multiple tables without duplicate round
// trips. Returns { byTicker: { [TICKER]: shapedRow | null }, loading }.

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";

// Module-level cache: ticker -> shaped row or null. Survives between
// component mounts so opening / closing a panel doesn't refetch.
const _cache = new Map();
const _inflight = new Map();   // ticker -> Promise
let _latestDate;               // memo of the latest scan_date (one lookup)

// Shape a raw trading_opps_signals row into the flat object the watchlist
// column renderers expect. Only the screener-scoring fields are carried —
// price / market cap / sector already come from other watchlist sources.
function shapeRow(row) {
  if (!row) return null;
  return {
    signal:           row.signal || null,
    score:            row.score != null ? Number(row.score) : null,
    score_1w:         row.score_1w != null ? Number(row.score_1w) : null,
    score_1m:         row.score_1m != null ? Number(row.score_1m) : null,
    win_rate:         row.win_rate != null ? Number(row.win_rate) : null,
    insider_rules:    Array.isArray(row.insider_rules) ? row.insider_rules : [],
    insider_age_days: row.insider_age_days != null ? Number(row.insider_age_days) : null,
    insider_pts:      row.insider_pts != null ? Number(row.insider_pts) : null,
    sma200_pct:       row.sma200_pct != null ? Number(row.sma200_pct) : null,
    rsi:              row.rsi != null ? Number(row.rsi) : null,
    scan_date:        row.scan_date || null,
  };
}

async function latestScanDate() {
  if (_latestDate !== undefined) return _latestDate;
  const { data } = await supabase
    .from("trading_opps_signals")
    .select("scan_date")
    .order("scan_date", { ascending: false })
    .limit(1);
  _latestDate = data && data[0] ? data[0].scan_date : null;
  return _latestDate;
}

async function fetchBatch(tickers) {
  const upper = tickers.map((t) => String(t || "").toUpperCase()).filter(Boolean);
  if (upper.length === 0) return {};

  const latest = await latestScanDate();
  if (!latest) return Object.fromEntries(upper.map((t) => [t, null]));

  // Supabase in.() filters cap at ~2000 URL chars; chunk defensively so
  // the hook scales if the watchlist grows.
  const out = {};
  const chunkSize = 100;
  for (let i = 0; i < upper.length; i += chunkSize) {
    const chunk = upper.slice(i, i + chunkSize);
    const { data: rows } = await supabase
      .from("trading_opps_signals")
      .select(
        "scan_date,ticker,signal,score,score_1w,score_1m,win_rate," +
        "insider_rules,insider_age_days,insider_pts,sma200_pct,rsi"
      )
      .eq("scan_date", latest)
      .in("ticker", chunk);
    for (const t of chunk) {
      const row = (rows || []).find((x) => x.ticker === t) || null;
      out[t] = row ? shapeRow(row) : null;   // null = ticker did not launch
    }
  }
  return out;
}

export default function useTradingOppsBatch(tickers) {
  const [tick, setTick] = useState(0);

  const upper = useMemo(
    () => (tickers || []).map((t) => String(t || "").toUpperCase()).filter(Boolean),
    [tickers]
  );

  useEffect(() => {
    let cancelled = false;
    const missing = upper.filter((t) => !_cache.has(t) && !_inflight.has(t));
    if (missing.length === 0) return;
    const p = fetchBatch(missing)
      .then((map) => {
        for (const t of missing) { _cache.set(t, map[t] ?? null); _inflight.delete(t); }
        if (!cancelled) setTick((x) => x + 1);
      })
      .catch(() => {
        // On error, cache null so the table renders em-dashes rather than
        // staying in a perpetual loading state.
        for (const t of missing) { _cache.set(t, null); _inflight.delete(t); }
        if (!cancelled) setTick((x) => x + 1);
      });
    for (const t of missing) _inflight.set(t, p);
    return () => { cancelled = true; };
  }, [upper]);

  const byTicker = useMemo(() => {
    const out = {};
    for (const t of upper) out[t] = _cache.has(t) ? _cache.get(t) : null;
    return out;
  }, [upper, tick]);

  return { byTicker, loading: upper.some((t) => !_cache.has(t)) };
}
