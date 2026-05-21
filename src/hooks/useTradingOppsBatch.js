// useTradingOppsBatch — batch-fetch the rebuilt screener's FULL nightly
// result rows (public.trading_opps_signals) for a list of tickers, so the
// Portfolio Insights watchlist can render the exact same results table as
// the Trading Opportunities page. Re-pointed off the retired six-signal
// model as Phase 7 of the screener overhaul.
//
// The rebuilt screener publishes only LAUNCHED names. A watchlist ticker
// the screener did not launch in the latest scan has no row — byTicker[T]
// is null and the table shows that ticker with em-dashes across every
// screener column. That is correct: the screener flags names, it does not
// score the whole universe.
//
// Pattern mirrors the other batch hooks — a module-level cache keyed by
// ticker. Returns { byTicker: { [TICKER]: rawRow | null }, loading }.

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";

const _cache = new Map();      // ticker -> raw row or null
const _inflight = new Map();   // ticker -> Promise
let _latestDate;               // memo of the latest scan_date (one lookup)

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

  // Supabase in.() filters cap at ~2000 URL chars; chunk defensively.
  const out = {};
  const chunkSize = 100;
  for (let i = 0; i < upper.length; i += chunkSize) {
    const chunk = upper.slice(i, i + chunkSize);
    const { data: rows } = await supabase
      .from("trading_opps_signals")
      .select("*")
      .eq("scan_date", latest)
      .in("ticker", chunk);
    for (const t of chunk) {
      out[t] = (rows || []).find((x) => x.ticker === t) || null;
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
