// useV5ScanBatch — batch fetch v5 signal_intel rows + ticker_reference
// joins for a list of tickers. Built 2026-05-11 (Joe directive) so the
// Portfolio Insights position tables + watchlist surface the SAME v5
// columns shown on the Trading Opps page: MT Score, Band, Industry Group,
// Short Interest sub-score, RSI(14), BB Band-Width, RVOL 20d, % vs 50/200
// MA, insider buy count + dollars.
//
// Pattern mirrors useRiskMetricsBatch — module-level cache keyed by
// ticker so the hook can be called from multiple tables without
// duplicate Supabase round-trips.
//
// Returns { byTicker: { [TICKER]: shapedRow }, loading }.
// shapedRow is null when the ticker has no v5 row in the latest scan.

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";

// Module-level cache: ticker -> shaped row or null. Survives between
// component mounts so opening / closing the account-positions modal
// doesn't trigger refetches.
const _cache = new Map();
const _inflight = new Map(); // ticker -> Promise

// SIC code -> rough GICS sector mapping (carried over from
// TradingOppsPage so the Industry Group column reads consistently
// across surfaces). SIC divisions are coarser than GICS so the
// mapping is approximate, but it gives a useful Sector / Industry
// distinction instead of two identical cells.
function sicCodeToSector(sicCode) {
  if (!sicCode) return null;
  const n = parseInt(String(sicCode).trim().slice(0, 4), 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n >= 100 && n <= 999)   return "Agriculture & Forestry";
  if (n >= 1000 && n <= 1499) return "Mining";
  if (n >= 1500 && n <= 1799) return "Construction";
  if (n >= 2000 && n <= 2199) return "Food & Beverage";
  if (n >= 2200 && n <= 2399) return "Textiles & Apparel";
  if (n >= 2400 && n <= 2599) return "Lumber, Wood & Furniture";
  if (n >= 2600 && n <= 2799) return "Paper, Print & Publishing";
  if (n >= 2830 && n <= 2839) return "Health Care";
  if (n >= 2800 && n <= 2899) return "Chemicals";
  if (n >= 2900 && n <= 2999) return "Energy (Refining)";
  if (n >= 3000 && n <= 3299) return "Rubber, Plastics & Stone";
  if (n >= 3300 && n <= 3399) return "Metals & Mining";
  if (n >= 3400 && n <= 3499) return "Industrial Metals";
  if (n >= 3570 && n <= 3579) return "Electronics & Hardware";
  if (n >= 3500 && n <= 3599) return "Industrial Machinery";
  if (n >= 3600 && n <= 3699) return "Electronics & Hardware";
  if (n >= 3700 && n <= 3799) return "Transportation Equipment";
  if (n >= 3840 && n <= 3851) return "Health Care";
  if (n >= 3800 && n <= 3899) return "Industrial Instruments";
  if (n >= 3900 && n <= 3999) return "Misc. Manufacturing";
  if (n >= 4800 && n <= 4899) return "Communications";
  if (n >= 4900 && n <= 4999) return "Utilities";
  if (n >= 4000 && n <= 4799) return "Transportation";
  if (n >= 5000 && n <= 5199) return "Wholesale Trade";
  if (n >= 5200 && n <= 5999) return "Retail";
  if (n >= 6000 && n <= 6199) return "Banking";
  if (n >= 6200 && n <= 6299) return "Capital Markets";
  if (n >= 6300 && n <= 6499) return "Insurance";
  if (n >= 6500 && n <= 6599) return "Real Estate";
  if (n >= 6700 && n <= 6799) return "Holding Companies & Investment";
  if (n >= 8000 && n <= 8099) return "Health Care";
  if (n >= 8200 && n <= 8299) return "Education";
  if (n >= 7370 && n <= 7379) return "Software & IT Services";
  if (n >= 7000 && n <= 7999) return "Consumer & Business Services";
  if (n >= 8100 && n <= 8999) return "Professional Services";
  if (n >= 9100 && n <= 9999) return "Public Administration";
  return null;
}

// Shape a raw v5 row + ticker_reference join into the flat object the
// column renderers expect.
function shapeV5Row(scan, ref) {
  if (!scan) return null;
  const subs   = scan.sub_scores || {};
  const sc     = (scan.diagnostic && scan.diagnostic.scorer_components) || {};
  const techC  = sc.technicals || {};
  const insC   = sc.insider    || {};

  // % vs SMAs — derive from today_close + smas.
  const todayC = Number(techC.today_close);
  const sma50  = Number(techC.sma50);
  const sma200 = Number(techC.sma200);
  const pct50  = (Number.isFinite(todayC) && Number.isFinite(sma50)  && sma50  > 0) ? ((todayC - sma50)  / sma50)  * 100 : null;
  const pct200 = (Number.isFinite(todayC) && Number.isFinite(sma200) && sma200 > 0) ? ((todayC - sma200) / sma200) * 100 : null;

  // Industry Group: ticker_reference.sic_description first; SIC code as
  // fallback so the cell isn't blank.
  const ig =
    (ref && ref.sic_description) ? ref.sic_description :
    (ref && ref.sic_code) ? sicCodeToSector(ref.sic_code) :
    null;

  return {
    mt_score: scan.mt_score != null ? Number(scan.mt_score) : null,
    band: scan.band || null,
    ig,
    sub_insider:        subs.insider        != null ? Number(subs.insider)        : null,
    sub_options:        subs.options        != null ? Number(subs.options)        : null,
    sub_congress:       subs.congress       != null ? Number(subs.congress)       : null,
    sub_technicals:     subs.technicals     != null ? Number(subs.technicals)     : null,
    sub_analyst:        subs.analyst        != null ? Number(subs.analyst)        : null,
    sub_short_interest: subs.short_interest != null ? Number(subs.short_interest) : null,
    rsi_14:   Number.isFinite(Number(techC.rsi14))        ? Number(techC.rsi14)        : null,
    bb_bw:    Number.isFinite(Number(techC.bb_bandwidth)) ? Number(techC.bb_bandwidth) : null,
    rvol_20d: Number.isFinite(Number(techC.rvol_20d))     ? Number(techC.rvol_20d)     : null,
    pct_50ma:  pct50,
    pct_200ma: pct200,
    ins_buys:    insC.buy_count        != null ? Number(insC.buy_count)        : null,
    ins_buy_$:   insC.buy_dollar_total != null ? Number(insC.buy_dollar_total) : null,
    scan_date: scan.scan_date || null,
  };
}

async function fetchBatch(tickers) {
  const upper = tickers.map(t => String(t || "").toUpperCase()).filter(Boolean);
  if (upper.length === 0) return {};

  // Latest scan_date overall (the v5 cron writes a single date per run);
  // pull rows for that date filtered to the requested tickers.
  const { data: latestRows } = await supabase
    .from("signal_intel_v5_daily")
    .select("scan_date")
    .order("scan_date", { ascending: false })
    .limit(1);
  const latestDate = latestRows?.[0]?.scan_date;
  if (!latestDate) return Object.fromEntries(upper.map(t => [t, null]));

  // 2026-05-11: Supabase `in.()` filters cap at ~2000 chars in URL.
  // For ~17 portfolio tickers + watchlist we're well under, but chunk
  // defensively so this hook scales if Joe's watchlist grows.
  const chunkSize = 100;
  const result = {};
  for (let i = 0; i < upper.length; i += chunkSize) {
    const chunk = upper.slice(i, i + chunkSize);
    const { data: scans } = await supabase
      .from("signal_intel_v5_daily")
      .select("scan_date,ticker,mt_score,band,sub_scores,diagnostic,market_cap")
      .eq("scan_date", latestDate)
      .in("ticker", chunk);
    const { data: refs } = await supabase
      .from("ticker_reference")
      .select("ticker,sic_code,sic_description")
      .in("ticker", chunk);
    const refByT = Object.fromEntries((refs || []).map(r => [r.ticker, r]));
    for (const t of chunk) {
      const scan = (scans || []).find(s => s.ticker === t) || null;
      result[t] = scan ? shapeV5Row(scan, refByT[t]) : null;
    }
  }
  return result;
}

export default function useV5ScanBatch(tickers) {
  const [tick, setTick] = useState(0);

  const upper = useMemo(
    () => (tickers || []).map(t => String(t || "").toUpperCase()).filter(Boolean),
    [tickers]
  );

  useEffect(() => {
    let cancelled = false;
    const missing = upper.filter(t => !_cache.has(t) && !_inflight.has(t));
    if (missing.length === 0) return;
    const p = fetchBatch(missing).then(map => {
      for (const t of missing) {
        _cache.set(t, map[t] ?? null);
        _inflight.delete(t);
      }
      if (!cancelled) setTick(x => x + 1);
    }).catch(() => {
      // On error, mark as null in cache so the table renders em-dashes
      // instead of staying in a perpetual loading state.
      for (const t of missing) {
        _cache.set(t, null);
        _inflight.delete(t);
      }
      if (!cancelled) setTick(x => x + 1);
    });
    for (const t of missing) _inflight.set(t, p);
    return () => { cancelled = true; };
  }, [upper]);

  const byTicker = useMemo(() => {
    const out = {};
    for (const t of upper) out[t] = _cache.has(t) ? _cache.get(t) : null;
    return out;
  }, [upper, tick]);

  return { byTicker, loading: upper.some(t => !_cache.has(t)) };
}
