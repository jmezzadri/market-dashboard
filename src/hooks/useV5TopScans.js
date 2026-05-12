// useV5TopScans — fetch the top-N highest-mt_score rows from the latest
// v5 scan (signal_intel_v5_daily), joined to ticker_state_current for the
// sector. Built 2026-05-12 so the Home page Equity Scanner tile reads
// from the same scoring engine that powers the Trading Opps page —
// replacing the legacy OVR-based rebucketBuy/rebucketNear top-6 that was
// showing names like "Buy CODI" / "Near NVDA" from the old scanner.
//
// Pattern mirrors useV5ScanBatch but is "top of book" rather than
// "enrich a known list of tickers".
//
// Returns { rows, scanDate, loading, error }.
// rows: [{ ticker, mt_score, band, sector }] — already filtered to
// mt_score >= 0 (the tile only surfaces neutral or better names).

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

let _cache = null;
const CACHE_TTL_MS = 5 * 60 * 1000;
let _inflight = null;

async function fetchTop(limit) {
  const latestRes = await supabase
    .from("signal_intel_v5_daily")
    .select("scan_date")
    .order("scan_date", { ascending: false })
    .limit(1);
  const latest = latestRes?.data?.[0]?.scan_date || null;
  if (!latest) return { rows: [], scanDate: null };

  const fetchN = Math.max(limit * 2, 20);
  const scanRes = await supabase
    .from("signal_intel_v5_daily")
    .select("ticker,mt_score,band")
    .eq("scan_date", latest)
    .gte("mt_score", 0)
    .order("mt_score", { ascending: false, nullsFirst: false })
    .limit(fetchN);
  if (scanRes.error) throw scanRes.error;
  const scanRows = (scanRes.data || [])
    .filter(r => r && Number.isFinite(Number(r.mt_score)))
    .slice(0, limit);

  const tickers = scanRows.map(r => r.ticker);
  const sectorByTicker = new Map();
  if (tickers.length) {
    const refRes = await supabase
      .from("ticker_state_current")
      .select("ticker,gics_sector")
      .in("ticker", tickers);
    (refRes?.data || []).forEach(row => {
      sectorByTicker.set(row.ticker, row.gics_sector || null);
    });
  }

  const rows = scanRows.map(r => ({
    ticker: r.ticker,
    mt_score: Number(r.mt_score),
    band: r.band || null,
    sector: sectorByTicker.get(r.ticker) || null,
  }));

  return { rows, scanDate: latest };
}

export default function useV5TopScans(limit = 6) {
  const [state, setState] = useState({
    rows: (_cache?.rows) || [],
    scanDate: _cache?.scanDate || null,
    loading: !_cache,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;

    const now = Date.now();
    if (_cache && (now - _cache.ts) < CACHE_TTL_MS) {
      setState({
        rows: _cache.rows.slice(0, limit),
        scanDate: _cache.scanDate,
        loading: false,
        error: null,
      });
      return () => { cancelled = true; };
    }

    const p = _inflight || (_inflight = fetchTop(Math.max(limit, 8)).finally(() => {
      _inflight = null;
    }));

    p.then(({ rows, scanDate }) => {
      _cache = { rows, scanDate, ts: Date.now() };
      if (cancelled) return;
      setState({
        rows: rows.slice(0, limit),
        scanDate,
        loading: false,
        error: null,
      });
    }).catch(err => {
      if (cancelled) return;
      setState(s => ({ ...s, loading: false, error: err?.message || String(err) }));
    });

    return () => { cancelled = true; };
  }, [limit]);

  return state;
}
