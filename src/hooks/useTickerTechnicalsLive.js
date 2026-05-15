// useTickerTechnicalsLive — daily technicals computed on the fly from
// the same Yahoo daily-history endpoint the chart uses, NOT from the
// cached scanner snapshot in scanData.signals.technicals.
//
// Why this exists:
//   The cached scan snapshot is refreshed by the Python scanner, which
//   filters ETFs out of its universe — so names like GLD, SLV, XLE,
//   etc., have technicals frozen from whenever they last entered the
//   scan (sometimes 2+ weeks old). The drawer's chart already pulls
//   from /api/price-history (Yahoo daily) and is always current.
//   This hook reuses the same source so the indicators match the chart
//   exactly, with no per-ticker pipeline coverage gap.
//
// What it computes (all from daily closes/volumes):
//   - week_change  (close[0] / close[5]   - 1)
//   - month_change (close[0] / close[21]  - 1)
//   - ytd_change   (close[0] / close[ytd_start] - 1)
//   - pct_vs_50ma  (close[0] / SMA50  - 1)
//   - pct_vs_200ma (close[0] / SMA200 - 1)
//   - above_50ma, above_200ma
//   - rsi_14       (Wilder smoothing, classic Welles Wilder Jr formula)
//   - macd_cross   (EMA12 / EMA26 cross direction in last 3 sessions:
//                   'bullish', 'bearish', or 'neutral')
//   - vol_surge    (today's volume / 30d avg volume)
//   - spy_relative_month / spy_relative_ytd (ticker − SPY)
//
// SPY history is fetched once per session and cached at module scope —
// every ticker the user opens reuses the same SPY series.
//
// All percentage values are returned as FRACTIONS (0.02 = 2%) to match
// the storage shape of scanData.signals.technicals.* — the display
// code in TickerDetailModal multiplies by 100 for render.

import { useEffect, useState } from "react";

// ─── Module-level SPY cache. One fetch per page load, shared across
//     every drawer open. Refreshes only when the cache age exceeds
//     2 hours so a long session picks up today's close. ──────────────
let _spyCache = null;            // { closes: number[], dates: string[], fetchedAt: number }
let _spyFetchInFlight = null;    // Promise<...> while a fetch is pending

async function fetchPriceHistory(ticker, period = "1y") {
  const r = await fetch(`/api/price-history?ticker=${encodeURIComponent(ticker)}&period=${period}`);
  if (!r.ok) throw new Error(`price-history ${r.status}`);
  const data = await r.json();
  // Returns prices array ordered ASCENDING by date. Reverse for desc.
  const prices = Array.isArray(data?.prices) ? data.prices : [];
  return prices;
}

async function getSpyHistory() {
  const now = Date.now();
  if (_spyCache && (now - _spyCache.fetchedAt) < 2 * 60 * 60 * 1000) {
    return _spyCache;
  }
  if (_spyFetchInFlight) return _spyFetchInFlight;
  _spyFetchInFlight = (async () => {
    try {
      const prices = await fetchPriceHistory("SPY", "1y");
      const fresh = {
        closes:  prices.map((p) => Number(p.c)),
        volumes: prices.map((p) => Number(p.v || 0)),
        dates:   prices.map((p) => p.d),
        fetchedAt: Date.now(),
      };
      _spyCache = fresh;
      return fresh;
    } finally {
      _spyFetchInFlight = null;
    }
  })();
  return _spyFetchInFlight;
}

// ─── Math primitives ────────────────────────────────────────────────
// All accept arrays ordered DESCENDING (idx 0 = most recent close).

function sma(arr, n) {
  if (!arr || arr.length < n) return null;
  let s = 0;
  for (let i = 0; i < n; i++) s += arr[i];
  return s / n;
}

function ema(arr, n) {
  // Standard EMA, seeded with the SMA of the first n points (oldest first).
  if (!arr || arr.length < n) return null;
  // Reverse to chronological for the recursion, then EMA forward.
  const asc = arr.slice().reverse();
  const k = 2 / (n + 1);
  let e = asc.slice(0, n).reduce((a, b) => a + b, 0) / n;
  for (let i = n; i < asc.length; i++) e = asc[i] * k + e * (1 - k);
  return e;
}

function rsi14(closesDesc) {
  // Wilder RSI computed with proper running smoothing over the full
  // available series — same algorithm the chart's RSI sub-pane uses.
  // The previous single-window calculation (last 15 closes only) gave
  // a different answer than the chart by ±1-2 points because it
  // discarded the smoothing context the chart inherits from earlier
  // history.
  if (!closesDesc || closesDesc.length < 15) return null;
  const period = 14;
  // Convert to chronological order for forward Wilder recursion.
  const asc = closesDesc.slice().reverse();
  let gain = 0, loss = 0;
  for (let i = 1; i <= period; i++) {
    const ch = asc[i] - asc[i - 1];
    if (ch >= 0) gain += ch; else loss -= ch;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  for (let i = period + 1; i < asc.length; i++) {
    const ch = asc[i] - asc[i - 1];
    const g = ch >= 0 ? ch : 0;
    const l = ch < 0 ? -ch : 0;
    avgGain = (avgGain * (period - 1) + g) / period;
    avgLoss = (avgLoss * (period - 1) + l) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

function macdCross(closesDesc) {
  // EMA12 / EMA26 difference -- compare today's value to a few sessions
  // ago. A positive diff that was negative 3 sessions ago = bullish
  // cross; the reverse = bearish; otherwise neutral.
  if (!closesDesc || closesDesc.length < 35) return null;
  const todayDiff = (ema(closesDesc.slice(0, 35), 12) || 0) - (ema(closesDesc.slice(0, 35), 26) || 0);
  const ago3Diff  = (ema(closesDesc.slice(3, 38), 12) || 0) - (ema(closesDesc.slice(3, 38), 26) || 0);
  if (todayDiff > 0 && ago3Diff <= 0) return "bullish";
  if (todayDiff < 0 && ago3Diff >= 0) return "bearish";
  return todayDiff > 0 ? "bullish" : todayDiff < 0 ? "bearish" : "neutral";
}

// Index in a desc-ordered date array of the last trade date in the
// previous calendar year, used to anchor YTD. Falls back to the oldest
// available row if we don't have history back to year-start.
function ytdAnchorIdx(datesDesc) {
  if (!datesDesc || datesDesc.length === 0) return null;
  const todayYear = new Date().getUTCFullYear();
  for (let i = 0; i < datesDesc.length; i++) {
    const y = parseInt((datesDesc[i] || "").slice(0, 4), 10);
    if (y < todayYear) return i; // first row from previous year = YTD anchor
  }
  return datesDesc.length - 1; // entire history is from current year
}

const EMPTY = {
  week_change: null,
  month_change: null,
  ytd_change: null,
  pct_vs_50ma: null,
  pct_vs_200ma: null,
  above_50ma: null,
  above_200ma: null,
  rsi_14: null,
  macd_cross: null,
  vol_surge: null,
  spy_relative_month: null,
  spy_relative_ytd: null,
  source: null,
  loading: false,
  error: null,
};

export default function useTickerTechnicalsLive(ticker) {
  const [state, setState] = useState(EMPTY);

  useEffect(() => {
    if (!ticker) { setState(EMPTY); return; }
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));

    (async () => {
      try {
        const [tPricesAsc, spy] = await Promise.all([
          fetchPriceHistory(ticker, "1y"),
          getSpyHistory(),
        ]);
        if (cancelled) return;

        if (!tPricesAsc.length) {
          setState({ ...EMPTY, error: "no price history" });
          return;
        }

        // Descending for math (idx 0 = most recent).
        const tCloses  = tPricesAsc.map((p) => Number(p.c)).reverse();
        const tVolumes = tPricesAsc.map((p) => Number(p.v || 0)).reverse();
        const tDates   = tPricesAsc.map((p) => p.d).reverse();

        const last = tCloses[0];

        // ─── Returns ──────────────────────────────────────────────
        // 5 trading days ago / 21 trading days ago / YTD anchor.
        const c5  = tCloses[5];
        const c21 = tCloses[21];
        const ytdI = ytdAnchorIdx(tDates);
        const cYtd = ytdI != null ? tCloses[ytdI] : null;

        const week_change  = c5  ? (last / c5  - 1) : null;
        const month_change = c21 ? (last / c21 - 1) : null;
        const ytd_change   = cYtd ? (last / cYtd - 1) : null;

        // ─── SPY-relative (ticker return − SPY return over same window) ─
        const sCloses = spy.closes || [];
        const sDates  = spy.dates  || [];
        const sLast = sCloses[0];
        const s21   = sCloses[21];
        const sYtdI = ytdAnchorIdx(sDates);
        const sYtdC = sYtdI != null ? sCloses[sYtdI] : null;
        const spyMonth = (sLast && s21)   ? (sLast / s21   - 1) : null;
        const spyYtd   = (sLast && sYtdC) ? (sLast / sYtdC - 1) : null;
        const spy_relative_month = (month_change != null && spyMonth != null) ? (month_change - spyMonth) : null;
        const spy_relative_ytd   = (ytd_change   != null && spyYtd   != null) ? (ytd_change   - spyYtd)   : null;

        // ─── Moving averages ─────────────────────────────────────
        const sma50  = sma(tCloses, 50);
        const sma200 = sma(tCloses, 200);
        const pct_vs_50ma  = sma50  ? (last / sma50  - 1) : null;
        const pct_vs_200ma = sma200 ? (last / sma200 - 1) : null;
        const above_50ma   = sma50  != null ? last > sma50  : null;
        const above_200ma  = sma200 != null ? last > sma200 : null;

        // ─── Momentum ────────────────────────────────────────────
        const rsi_14    = rsi14(tCloses);
        const macd_cross = macdCross(tCloses);

        // ─── Volume surge: today vs 30-day avg ───────────────────
        const v30 = tVolumes.slice(1, 31);
        const avg30 = v30.length ? v30.reduce((a, b) => a + b, 0) / v30.length : null;
        const vol_surge = avg30 && tVolumes[0] ? tVolumes[0] / avg30 : null;

        setState({
          week_change, month_change, ytd_change,
          pct_vs_50ma, pct_vs_200ma,
          above_50ma, above_200ma,
          rsi_14, macd_cross, vol_surge,
          spy_relative_month, spy_relative_ytd,
          source: "yahoo-live",
          loading: false,
          error: null,
        });
      } catch (e) {
        if (!cancelled) setState({ ...EMPTY, error: e?.message || String(e) });
      }
    })();

    return () => { cancelled = true; };
  }, [ticker]);

  return state;
}
