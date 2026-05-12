// useV5TopScans — fetch the top-N highest-mt_score rows from the latest
// v5 scan (signal_intel_v5_daily), joined to ticker_state_current for the
// sector, AND return per-band counts for the scan_date so the Home tile
// can show a Strong Buy / Buy Watch / Sell Watch / Strong Sell summary
// strip above the ticker list.
//
// Returns {
//   rows,                  // [{ ticker, mt_score, band, sector }] — top N, mt_score>=0
//   bandCounts,            // { strong_buy, watch_buy, neutral, watch_sell, strong_sell }
//   scanDate,              // 'YYYY-MM-DD'
//   loading, error,
// }

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

let _cache = null;
const CACHE_TTL_MS = 5 * 60 * 1000;
let _inflight = null;

async function countBand(scan_date, bandLabel) {
  const r = await supabase
    .from("signal_intel_v5_daily")
    .select("ticker", { count: "exact", head: true })
    .eq("scan_date", scan_date)
    .eq("band", bandLabel);
  return Number.isFinite(Number(r?.count)) ? Number(r.count) : 0;
}

async function fetchAll(limit) {
  const latestRes = await supabase
    .from("signal_intel_v5_daily")
    .select("scan_date")
    .order("scan_date", { ascending: false })
    .limit(1);
  const latest = latestRes?.data?.[0]?.scan_date || null;
  if (!latest) {
    return {
      rows: [],
      bandCounts: { strong_buy: 0, watch_buy: 0, neutral: 0, watch_sell: 0, strong_sell: 0 },
      scanDate: null,
    };
  }

  // Top-N rows (mt_score>=0, descending).
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

  // Sector join — only for the top-N we'll display.
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

  // Band counts in parallel — five head-count queries, cheap because they
  // don't return any row bodies. DB band strings are "Strong Buy",
  // "Watch Buy", "Neutral", "Watch Sell", "Strong Sell".
  const [strongBuy, watchBuy, neutral, watchSell, strongSell] = await Promise.all([
    countBand(latest, "Strong Buy"),
    countBand(latest, "Watch Buy"),
    countBand(latest, "Neutral"),
    countBand(latest, "Watch Sell"),
    countBand(latest, "Strong Sell"),
  ]);

  return {
    rows,
    bandCounts: {
      strong_buy: strongBuy,
      watch_buy: watchBuy,
      neutral: neutral,
      watch_sell: watchSell,
      strong_sell: strongSell,
    },
    scanDate: latest,
  };
}

export default function useV5TopScans(limit = 6) {
  const [state, setState] = useState({
    rows: _cache?.rows || [],
    bandCounts: _cache?.bandCounts || { strong_buy: 0, watch_buy: 0, neutral: 0, watch_sell: 0, strong_sell: 0 },
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
        bandCounts: _cache.bandCounts,
        scanDate: _cache.scanDate,
        loading: false,
        error: null,
      });
      return () => { cancelled = true; };
    }

    const p = _inflight || (_inflight = fetchAll(Math.max(limit, 8)).finally(() => {
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
    }).catch(err => {
      if (cancelled) return;
      setState(s => ({ ...s, loading: false, error: err?.message || String(err) }));
    });

    return () => { cancelled = true; };
  }, [limit]);

  return state;
}
