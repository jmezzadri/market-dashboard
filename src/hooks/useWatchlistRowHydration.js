// useWatchlistRowHydration — builds a full results-table row for every
// watchlist ticker the nightly screener has NOT launched.
//
// Why this exists
// ---------------
// The Portfolio Insights watchlist renders the exact same table as the
// Trading Opportunities page. That table sources every cell from
// trading_opps_signals, which only holds rows for names the screener
// launched. A watchlist name the screener did not launch had no row, so
// the table rendered it as a near-empty line — em-dashes across every
// column, just the ticker filled in.
//
// That is wrong: the general market data (price, change, volume, company
// name, sector, market cap, 52-week range, moving averages, realized-vol
// statistics, RSI, percent versus the 200-day line, options-sentiment
// context) exists for every listed name whether or not the screener
// scored it. Only the genuine screener OUTPUT (Score, Signal, Score 1W /
// 1M, Win Rate, Insider Activity, Dark Pool Anchor, Options Vol Shock)
// is unavailable for an unscored name.
//
// This hook hydrates the informational fields for any list of tickers
// straight from the same sources the nightly producer reads, computing
// the price-derived statistics the SAME way trading_opps/run_screener.py
// price_extras() does, and emits the exact field names the shared
// renderCell in TradingOppsPage.jsx expects. The eight screener-output
// fields are intentionally left absent — those genuinely belong to the
// screener.
//
// Sources
// -------
//   prices_eod          close / volume history -> price, change, volume,
//                       relative volume, 52-week range, EMA9 / EMA21 /
//                       SMA50, realized vol / mean / std dev / daily
//                       sigma, sparkline, RSI, percent vs the 200-day SMA.
//   ticker_reference    company name, sector (sic_description), market cap.
//   universe_snapshots  latest 3x-weekday snapshot -> the options-sentiment
//                       context columns (P/C, net premium, IV, IV Rank,
//                       implied 7D / 30D) and the next earnings date, for
//                       every equity at or above $1B market cap.
//
// All four tables are already read from the browser by existing hooks
// (usePricesEodBatch, useMassiveTickerInfo, useUniverseSnapshot,
// useEarningsHistory), so this introduces no new access pattern. None of
// these reads touch a metered vendor — they are plain Supabase queries.
//
// Returns: { byTicker: { [TICKER]: hydratedRow | null }, loading }

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";

// ── Caches (session-lifetime, mirrors the other batch hooks) ───────────────
const _cache = new Map();      // ticker -> hydrated row (or null)
const _inflight = new Map();   // ticker -> Promise
let _latestUnivTs;             // memo of the latest universe_snapshots stamp

// Trailing window of end-of-day bars to pull per ticker. 400 calendar days
// yields roughly 275 trading sessions — enough for an exact 200-day SMA and
// an exact 252-day 52-week range, with ample room for the recursive EMA /
// Wilder-RSI averages to converge (their dependence on history beyond ~120
// sessions is below 1e-8, far under the display precision).
const HISTORY_DAYS = 400;

// Mirrors the producer's constants (trading_opps/run_screener.py and
// backtest_engine.py): 16-point sparkline, 21-session return statistics,
// 200-day SMA, 14-day Wilder RSI.
const SPARK_POINTS = 16;
const STAT_WINDOW = 21;
const SMA_WINDOW = 200;
const RSI_WINDOW = 14;

// ── Small numeric helpers ──────────────────────────────────────────────────
function toNum(v) {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function round(v, n) {
  if (v == null || !Number.isFinite(v)) return null;
  const f = Math.pow(10, n);
  return Math.round(v * f) / f;
}

function mean(arr) {
  if (!arr.length) return null;
  let s = 0;
  for (const x of arr) s += x;
  return s / arr.length;
}

// Sample standard deviation (ddof = 1) — matches pandas Series.std(ddof=1).
function sampleStd(arr) {
  if (arr.length < 2) return null;
  const m = mean(arr);
  let s = 0;
  for (const x of arr) s += (x - m) * (x - m);
  return Math.sqrt(s / (arr.length - 1));
}

// Recursive exponential moving average, adjust=False — matches
// pandas Series.ewm(span, adjust=False).mean(): seed with the first
// observation, then e[i] = alpha*x[i] + (1-alpha)*e[i-1].
function emaLast(arr, span) {
  if (!arr.length) return null;
  const alpha = 2 / (span + 1);
  let e = arr[0];
  for (let i = 1; i < arr.length; i++) e = alpha * arr[i] + (1 - alpha) * e;
  return e;
}

// 14-day Wilder RSI — matches backtest_engine.wilder_rsi(): the gain and
// loss legs are smoothed with ewm(alpha=1/n, adjust=False); an all-gain
// window (zero average loss) reads RSI 100.
function wilderRsiLast(closes, n = RSI_WINDOW) {
  if (closes.length < n + 1) return null;
  const alpha = 1 / n;
  let avgGain = null;
  let avgLoss = null;
  for (let i = 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    const gain = d > 0 ? d : 0;
    const loss = d < 0 ? -d : 0;
    if (avgGain === null) {
      avgGain = gain;
      avgLoss = loss;
    } else {
      avgGain = alpha * gain + (1 - alpha) * avgGain;
      avgLoss = alpha * loss + (1 - alpha) * avgLoss;
    }
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

// ── Price-derived columns ──────────────────────────────────────────────────
// Replicates trading_opps/run_screener.py price_extras() plus the SMA200
// percent and Wilder RSI that the producer reads off backtest_engine's
// indicator panel. `bars` is one ticker's end-of-day rows ascending by
// trade_date: [{ trade_date, close, volume }, ...].
function priceDerived(bars) {
  const closes = [];
  const vols = [];
  for (const b of bars) {
    const c = toNum(b.close);
    if (c == null) continue;          // skip any malformed bar, like the producer
    closes.push(c);
    vols.push(toNum(b.volume));
  }
  const n = closes.length;
  if (n === 0) return { last_trade_ts: null };

  const last = closes[n - 1];
  const prev = n >= 2 ? closes[n - 2] : null;
  const changeUsd = prev != null ? last - prev : null;
  const changePct = prev ? ((last - prev) / prev) * 100 : null;

  const volLast = vols.length ? vols[vols.length - 1] : null;
  const vol90 = vols.slice(-90).filter((v) => v != null);
  const vol90Mean = vol90.length ? mean(vol90) : null;
  const relVol = vol90Mean && vol90Mean > 0 && volLast != null
    ? volLast / vol90Mean
    : null;

  const win52 = closes.slice(-252);
  const low52 = Math.min(...win52);
  const high52 = Math.max(...win52);

  const ema9 = emaLast(closes, 9);
  const ema21 = emaLast(closes, 21);
  const sma50 = n >= 50 ? mean(closes.slice(-50)) : null;

  // Daily returns, last STAT_WINDOW sessions — pandas pct_change().dropna().
  const rets = [];
  for (let i = 1; i < n; i++) {
    if (closes[i - 1]) rets.push(closes[i] / closes[i - 1] - 1);
  }
  const recent = rets.slice(-STAT_WINDOW);
  const meanR = recent.length ? mean(recent) * 100 : null;
  const stdR = recent.length > 1 ? sampleStd(recent) * 100 : null;
  const realizedVol = recent.length > 1
    ? sampleStd(recent) * Math.sqrt(252) * 100
    : null;

  const spark = closes.slice(-SPARK_POINTS).map((x) => round(x, 4));

  // SMA200 percent — the producer's sma200_pct = (price - SMA200) / SMA200.
  const sma200 = n >= SMA_WINDOW ? mean(closes.slice(-SMA_WINDOW)) : null;
  const sma200Pct = sma200 && last ? round(((last - sma200) / sma200) * 100, 2) : null;

  // RSI — the producer stores it rounded to one decimal.
  const rsiRaw = wilderRsiLast(closes);

  // Last trade timestamp — the producer stamps launched rows at the scan
  // date's market close ({date}T20:00:00Z); mirror that with the most
  // recent end-of-day bar's date so the column is populated and honest.
  const lastBarDate = bars.length ? bars[bars.length - 1].trade_date : null;

  return {
    price: round(last, 4),
    change_pct: round(changePct, 3),
    change_usd: round(changeUsd, 4),
    volume: volLast,
    rel_volume: round(relVol, 3),
    week_52_low: round(low52, 4),
    week_52_high: round(high52, 4),
    ema9: round(ema9, 4),
    ema21: round(ema21, 4),
    sma50: round(sma50, 4),
    mean_return: round(meanR, 3),
    std_dev: round(stdR, 3),
    daily_sigma_pct: round(stdR, 3),
    realized_vol: round(realizedVol, 2),
    spark,
    sma200_pct: sma200Pct,
    rsi: round(rsiRaw, 1),
    last_trade_ts: lastBarDate ? `${lastBarDate}T20:00:00Z` : null,
  };
}

// ── Options-sentiment context columns ──────────────────────────────────────
// Drawn from the latest universe_snapshots row. The unit conventions match
// the rest of the site: iv30d / implied_move_perc_* are stored as fractions
// (0.46 = 46%), the premium legs are stored in raw dollars. Net premium is
// the directional flow skew = net call premium minus net put premium, the
// same quantity TickerDetailModal renders as flow skew, expressed in
// millions to match the renderer.
function optionsContext(snap) {
  if (!snap) return {};
  const pc = toNum(snap.put_call_ratio);
  const iv30 = toNum(snap.iv30d);
  const ivRank = toNum(snap.iv_rank);
  const netCall = toNum(snap.net_call_premium);
  const netPut = toNum(snap.net_put_premium);
  const imp7Usd = toNum(snap.implied_move_7);
  const imp7Pct = toNum(snap.implied_move_perc_7);
  const imp30Usd = toNum(snap.implied_move_30);
  const imp30Pct = toNum(snap.implied_move_perc_30);
  return {
    pc_ratio: pc,
    net_premium: netCall != null && netPut != null ? round((netCall - netPut) / 1e6, 3) : null,
    iv: iv30 != null ? round(iv30 * 100, 2) : null,
    iv_rank: ivRank,
    implied_7d_pct: imp7Pct != null ? round(imp7Pct * 100, 2) : null,
    implied_7d_usd: imp7Usd,
    implied_30d_pct: imp30Pct != null ? round(imp30Pct * 100, 2) : null,
    implied_30d_usd: imp30Usd,
  };
}

// ── Batch fetch + assemble ─────────────────────────────────────────────────
async function fetchPricesEod(tickers) {
  const cutoff = new Date(Date.now() - HISTORY_DAYS * 86400000)
    .toISOString()
    .slice(0, 10);
  const byTicker = {};
  for (const t of tickers) byTicker[t] = [];

  const PAGE = 1000;
  for (let c = 0; c < tickers.length; c += 200) {
    const chunk = tickers.slice(c, c + 200);
    let from = 0;
    // PostgREST caps a response at 1000 rows; page until a short page lands.
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { data, error } = await supabase
        .from("prices_eod")
        .select("ticker, trade_date, close, volume")
        .in("ticker", chunk)
        .gte("trade_date", cutoff)
        .order("ticker", { ascending: true })
        .order("trade_date", { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) throw error;
      for (const row of data || []) {
        const t = String(row.ticker || "").toUpperCase();
        if (byTicker[t]) byTicker[t].push(row);
      }
      if (!data || data.length < PAGE) break;
      from += PAGE;
    }
  }
  return byTicker;
}

async function fetchReference(tickers) {
  const out = {};
  for (let c = 0; c < tickers.length; c += 200) {
    const chunk = tickers.slice(c, c + 200);
    const { data, error } = await supabase
      .from("ticker_reference")
      .select("ticker, name, sic_description, market_cap")
      .in("ticker", chunk);
    if (error) throw error;
    for (const row of data || []) {
      out[String(row.ticker || "").toUpperCase()] = row;
    }
  }
  return out;
}

async function fetchUniverseSnapshot(tickers) {
  if (_latestUnivTs === undefined) {
    const { data } = await supabase
      .from("universe_snapshots")
      .select("snapshot_ts")
      .order("snapshot_ts", { ascending: false })
      .limit(1);
    _latestUnivTs = data && data[0] ? data[0].snapshot_ts : null;
  }
  const out = {};
  if (!_latestUnivTs) return out;
  for (let c = 0; c < tickers.length; c += 200) {
    const chunk = tickers.slice(c, c + 200);
    const { data, error } = await supabase
      .from("universe_snapshots")
      .select(
        "ticker, full_name, sector, marketcap, put_call_ratio, iv30d, iv_rank, " +
          "net_call_premium, net_put_premium, implied_move_7, implied_move_perc_7, " +
          "implied_move_30, implied_move_perc_30, next_earnings_date"
      )
      .eq("snapshot_ts", _latestUnivTs)
      .in("ticker", chunk);
    if (error) throw error;
    for (const row of data || []) {
      out[String(row.ticker || "").toUpperCase()] = row;
    }
  }
  return out;
}

async function hydrateBatch(tickers) {
  // Each source is fetched independently — a failure in one (for example
  // universe_snapshots returning nothing for a signed-out viewer, or RLS)
  // degrades only the columns that source feeds, never the whole row.
  const [prices, reference, universe] = await Promise.all([
    fetchPricesEod(tickers).catch(() => ({})),
    fetchReference(tickers).catch(() => ({})),
    fetchUniverseSnapshot(tickers).catch(() => ({})),
  ]);

  const out = {};
  for (const t of tickers) {
    const bars = prices[t] || [];
    const ref = reference[t] || null;
    const snap = universe[t] || null;
    const derived = priceDerived(bars);
    const opts = optionsContext(snap);

    out[t] = {
      ticker: t,
      ...derived,
      ...opts,
      company_name:
        (ref && ref.name) || (snap && snap.full_name) || null,
      sector:
        (snap && snap.sector) || (ref && ref.sic_description) || null,
      market_cap:
        toNum(snap && snap.marketcap) ?? toNum(ref && ref.market_cap),
      earnings_date: (snap && snap.next_earnings_date) || null,
    };
  }
  return out;
}

// ── Hook ───────────────────────────────────────────────────────────────────
export default function useWatchlistRowHydration(tickers) {
  const [tick, setTick] = useState(0);

  const upper = useMemo(
    () =>
      Array.from(
        new Set(
          (tickers || [])
            .map((t) => String(t || "").trim().toUpperCase())
            .filter(Boolean)
        )
      ),
    [tickers]
  );
  const key = upper.join("|");

  useEffect(() => {
    let cancelled = false;
    const missing = upper.filter((t) => !_cache.has(t) && !_inflight.has(t));
    if (missing.length === 0) return;

    const p = hydrateBatch(missing)
      .then((map) => {
        for (const t of missing) {
          _cache.set(t, map[t] ?? null);
          _inflight.delete(t);
        }
        if (!cancelled) setTick((x) => x + 1);
      })
      .catch(() => {
        for (const t of missing) {
          _cache.set(t, null);
          _inflight.delete(t);
        }
        if (!cancelled) setTick((x) => x + 1);
      });
    for (const t of missing) _inflight.set(t, p);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const byTicker = useMemo(() => {
    const out = {};
    for (const t of upper) out[t] = _cache.has(t) ? _cache.get(t) : null;
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, tick]);

  return { byTicker, loading: upper.some((t) => !_cache.has(t)) };
}
