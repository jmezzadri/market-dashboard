// useDivergenceScan — fetch the latest nightly RSI divergence scan
// (public.divergence_scan) for the Trading Scanner's "RSI Divergences"
// section, plus the signed-in user's watchlist tickers for row highlights.
//
// Pattern mirrors useTradingOppsTop: latest scan_date first, then that
// day's rows; 5-minute in-memory cache with an in-flight promise guard so
// N mounted consumers hit the DB once.
//
// Returns {
//   bull, bear,   // row arrays, freshest first (bars_ago asc, rsi_gap desc)
//   scanDate,     // 'YYYY-MM-DD' of the scan's close
//   watchlist,    // Set of tickers on the signed-in user's watchlist
//   loading, error,
// }

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

let _cache = null;
const CACHE_TTL_MS = 5 * 60 * 1000;
let _inflight = null;

const num = (v) => (v == null || !Number.isFinite(Number(v)) ? null : Number(v));

function mapRow(r) {
  return {
    ticker: r.ticker,
    name: r.name || null,
    direction: r.direction,
    px1: num(r.px1),
    rsi1: num(r.rsi1),
    px2: num(r.px2),
    rsi2: num(r.rsi2),
    curClose: num(r.cur_close),
    curRsi: num(r.cur_rsi),
    barsAgo: num(r.bars_ago),
    sepBars: num(r.sep_bars),
    advUsd: num(r.adv_usd),
    rsiGap: num(r.rsi_gap),
    strong: r.strong === true,
  };
}

async function fetchScan() {
  const latest = await supabase
    .from("divergence_scan")
    .select("scan_date")
    .order("scan_date", { ascending: false })
    .limit(1);
  if (latest.error) throw latest.error;
  const scanDate = latest.data?.[0]?.scan_date || null;

  let bull = [];
  let bear = [];
  if (scanDate) {
    const res = await supabase
      .from("divergence_scan")
      .select("*")
      .eq("scan_date", scanDate)
      .order("bars_ago", { ascending: true })
      .order("rsi_gap", { ascending: false });
    if (res.error) throw res.error;
    const rows = (res.data || []).map(mapRow);
    bull = rows.filter((r) => r.direction === "bull");
    bear = rows.filter((r) => r.direction === "bear");
  }

  // Watchlist highlight — RLS scopes rows to the signed-in user; signed-out
  // sessions simply get an empty set. Non-fatal on error.
  let watchlist = new Set();
  try {
    const wl = await supabase.from("watchlist").select("ticker");
    if (!wl.error && Array.isArray(wl.data)) {
      watchlist = new Set(wl.data.map((w) => String(w.ticker || "").toUpperCase()));
    }
  } catch { /* signed-out or watchlist unavailable — no highlights */ }

  return { bull, bear, scanDate, watchlist };
}

export default function useDivergenceScan() {
  const [state, setState] = useState(() =>
    _cache && Date.now() - _cache.at < CACHE_TTL_MS
      ? { ...regularShape(_cache.data), loading: false, error: null }
      : { bull: [], bear: [], scanDate: null, watchlist: new Set(), loading: true, error: null });

  useEffect(() => {
    if (_cache && Date.now() - _cache.at < CACHE_TTL_MS) return undefined;
    let alive = true;
    if (!_inflight) {
      _inflight = fetchScan()
        .then((data) => { _cache = { data, at: Date.now() }; return data; })
        .finally(() => { _inflight = null; });
    }
    _inflight
      .then((data) => { if (alive) setState({ ...regularShape(data), loading: false, error: null }); })
      .catch((e) => { if (alive) setState((s) => ({ ...s, loading: false, error: e })); });
    return () => { alive = false; };
  }, []);

  return state;
}

function regularShape(d) {
  return { bull: d.bull, bear: d.bear, scanDate: d.scanDate, watchlist: d.watchlist };
}
