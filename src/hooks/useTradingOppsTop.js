// useTradingOppsTop — fetch the highest-scoring names from the latest
// nightly Trading Opportunities scan (public.trading_opps_signals) so the
// Home page Equity Scanner tile reads the SAME engine that powers the
// Trading Opportunities page. Re-pointed off the retired six-signal model
// (useV5TopScans) on 2026-05-21 as Phase 6 of the screener overhaul, so
// the Home tile and the Trading Opportunities page can never disagree.
//
// The rebuilt screener publishes a long-only launched list — one row per
// launched name for each scan_date — so there are no sell-side counts.
//
// Returns {
//   rows,        // [{ ticker, score, signal, sector, band }] — top N by score
//   bandCounts,  // { score5, score4, score3, total }
//   scanDate,    // 'YYYY-MM-DD'
//   loading, error,
// }

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

let _cache = null;
const CACHE_TTL_MS = 5 * 60 * 1000;
let _inflight = null;

// Score band — identical cutoffs to the Trading Opportunities page
// (scoreBand in TradingOppsPage.jsx): 5 = score >= 4.5, 4 = 3.5-4.49,
// 3 = everything that launched (the launch threshold is 3).
function scoreBand(s) {
  const n = Number(s);
  if (!Number.isFinite(n)) return 3;
  if (n >= 4.5) return 5;
  if (n >= 3.5) return 4;
  return 3;
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

  // 2. Every launched row for that scan_date. The screener publishes one
  //    row per launched name (~100), comfortably inside the default row
  //    cap, so a single query covers both the top-N list and the band
  //    counts.
  const scanRes = await supabase
    .from("trading_opps_signals")
    .select("ticker,score,signal,sector")
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

  const rows = all.slice(0, limit).map((r) => ({
    ticker: r.ticker,
    score: Number(r.score),
    signal: r.signal || null,
    sector: r.sector || null,
    band: scoreBand(r.score),
  }));

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
      (_inflight = fetchAll(Math.max(limit, 12)).finally(() => {
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
