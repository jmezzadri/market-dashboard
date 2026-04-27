// riskMetrics — stock-level + portfolio-level risk math.
//
// Methodology (locked with Joe 2026-04-27):
//   • VaR: 10-day 99% historical simulation, 2-year lookback. Returns
//     decimal loss magnitude (positive number = the loss). Display in
//     both % and $.
//   • Beta: vs SPY, 2-year weekly returns, OLS slope.
//   • Annualized vol: 2-year daily std-dev × sqrt(252).
//   • Max drawdown: 2-year window, peak-to-trough on daily close (adjusted).
//   • Sharpe: (annualized return - RFR) / annualized vol. RFR = 3M T-bill spot
//     (currently ~5.0% via FRED DGS3MO; passed in as a constant for now,
//     can be wired to a live FRED feed later).
//
// All inputs are arrays of `{d:"YYYY-MM-DD", c:Number}` from /api/price-history.
// Adjusted close (d.adj) is preferred where available — it accounts for splits
// and dividends for accurate return computation.

// ── Helpers ───────────────────────────────────────────────────────────────

// Convert price array into log returns (more stable for compounding math).
// Use simple returns for VaR / drawdown reporting since users expect %.
function pctReturns(prices) {
  const c = prices.map(p => p.adj ?? p.c);
  const r = [];
  for (let i = 1; i < c.length; i++) {
    if (c[i-1] && c[i]) r.push(c[i] / c[i-1] - 1);
  }
  return r;
}

// Sample a daily series at weekly frequency (Friday close, or the last close
// available in each ISO week). Returns the same shape as the input.
function weeklySample(prices) {
  if (!prices || prices.length === 0) return [];
  const out = [];
  let lastWeek = null;
  let weekRow = null;
  for (const p of prices) {
    const dt = new Date(p.d + "T00:00:00Z");
    // Year + week number (rough — uses Math.floor of UTC days / 7)
    const wk = `${dt.getUTCFullYear()}-${Math.floor((dt - new Date(dt.getUTCFullYear(), 0, 1)) / (7 * 86400 * 1000))}`;
    if (lastWeek && wk !== lastWeek && weekRow) out.push(weekRow);
    lastWeek = wk;
    weekRow = p;
  }
  if (weekRow) out.push(weekRow);
  return out;
}

// Mean of an array of numbers (NaN if empty).
function mean(arr) {
  if (!arr || arr.length === 0) return NaN;
  let s = 0;
  for (const v of arr) s += v;
  return s / arr.length;
}

// Standard deviation (sample, n-1 denominator).
function stdev(arr) {
  if (!arr || arr.length < 2) return NaN;
  const m = mean(arr);
  let s = 0;
  for (const v of arr) { const d = v - m; s += d * d; }
  return Math.sqrt(s / (arr.length - 1));
}

// Slice a prices array to the last N years.
function tail2y(prices, years = 2) {
  if (!prices || prices.length === 0) return [];
  const lastDate = new Date(prices[prices.length - 1].d + "T00:00:00Z");
  const cutoff = new Date(lastDate.getTime() - years * 365 * 86400 * 1000);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  return prices.filter(p => p.d >= cutoffStr);
}

// ── Beta vs SPY (2Y weekly OLS) ─────────────────────────────────────────────
// β = Cov(r_stock, r_spy) / Var(r_spy)
// Using weekly to reduce microstructure noise; 2Y window for stability.
export function computeBeta(stockPrices, spyPrices) {
  const s = weeklySample(tail2y(stockPrices, 2));
  const m = weeklySample(tail2y(spyPrices,   2));
  // Align dates — inner join on d
  const mIdx = Object.fromEntries(m.map((p, i) => [p.d, i]));
  const aligned = [];
  for (const p of s) {
    const j = mIdx[p.d];
    if (j != null) aligned.push({ s: p, m: m[j] });
  }
  if (aligned.length < 26) return null; // need at least ~6 months of weekly data
  const sR = []; const mR = [];
  for (let i = 1; i < aligned.length; i++) {
    const sCur = aligned[i].s.adj ?? aligned[i].s.c;
    const sPrv = aligned[i-1].s.adj ?? aligned[i-1].s.c;
    const mCur = aligned[i].m.adj ?? aligned[i].m.c;
    const mPrv = aligned[i-1].m.adj ?? aligned[i-1].m.c;
    if (sPrv && sCur && mPrv && mCur) {
      sR.push(sCur / sPrv - 1);
      mR.push(mCur / mPrv - 1);
    }
  }
  if (sR.length < 26) return null;
  const sM = mean(sR), mM = mean(mR);
  let cov = 0, varM = 0;
  for (let i = 0; i < sR.length; i++) {
    cov  += (sR[i] - sM) * (mR[i] - mM);
    varM += (mR[i] - mM) * (mR[i] - mM);
  }
  if (varM === 0) return null;
  return cov / varM;
}

// ── Annualized volatility (2Y daily) ────────────────────────────────────────
export function computeAnnualizedVol(prices) {
  const r = pctReturns(tail2y(prices, 2));
  if (r.length < 60) return null;
  const sd = stdev(r);
  if (!Number.isFinite(sd)) return null;
  return sd * Math.sqrt(252);
}

// ── Max drawdown (2Y) ──────────────────────────────────────────────────────
// Returns a positive number representing the largest peak-to-trough decline
// as a fraction of the peak. e.g., 0.255 = 25.5% max drawdown.
export function computeMaxDrawdown(prices) {
  const w = tail2y(prices, 2);
  if (w.length < 30) return null;
  let peak = -Infinity;
  let maxDD = 0;
  for (const p of w) {
    const v = p.adj ?? p.c;
    if (v == null) continue;
    if (v > peak) peak = v;
    const dd = peak > 0 ? (peak - v) / peak : 0;
    if (dd > maxDD) maxDD = dd;
  }
  return maxDD;
}

// ── 10-day 99% historical VaR ──────────────────────────────────────────────
// Method: roll 10-day overlapping returns over the 2Y daily series, sort
// ascending, take the 1st percentile (worst 1%). Returned as a positive
// decimal magnitude of loss (e.g., 0.124 = 12.4% loss).
export function computeVaR10d99(prices) {
  const c = tail2y(prices, 2).map(p => p.adj ?? p.c).filter(v => v != null);
  if (c.length < 60) return null;
  const tenDay = [];
  for (let i = 10; i < c.length; i++) {
    if (c[i-10]) tenDay.push(c[i] / c[i-10] - 1);
  }
  if (tenDay.length < 50) return null;
  const sorted = [...tenDay].sort((a, b) => a - b);
  // 1st percentile (worst 1%)
  const idx = Math.max(0, Math.floor(sorted.length * 0.01));
  const p1 = sorted[idx];
  // Return positive magnitude. If somehow positive (rare in 1st %ile), clamp 0.
  return p1 < 0 ? -p1 : 0;
}

// ── Portfolio Sharpe ratio ─────────────────────────────────────────────────
// Annualized excess return / annualized vol. Both computed from a
// portfolio_history aggregate series (one row per as_of with NAV + flows).
//
// Inputs:
//   aggregate — Array<{as_of, nav, contributions, withdrawals}>, sorted asc
//   rfrAnnual — risk-free rate, annualized decimal (e.g., 0.05 for 5% T-bill)
//
// Method:
//   1. Compute period returns (Modified Dietz) between each adjacent date.
//   2. Annualize: assume the gap between date i and i+1 is in days; annualized
//      vol = stdev × sqrt(periods_per_year).
//   3. Cumulative TWR over the full window → annualized total return via
//      (1 + cumR) ^ (252 / total_trading_days) - 1
//   4. Sharpe = (annualR - rfrAnnual) / annualVol
export function computePortfolioSharpe(aggregate, rfrAnnual = 0.05) {
  if (!aggregate || aggregate.length < 12) return null;
  const returns = [];
  for (let i = 1; i < aggregate.length; i++) {
    const prev = aggregate[i-1], cur = aggregate[i];
    const netFlow = (Number(cur.contributions) || 0) - (Number(cur.withdrawals) || 0);
    const denom = prev.nav + netFlow;
    if (denom <= 0) continue;
    returns.push((cur.nav - prev.nav - netFlow) / denom);
  }
  if (returns.length < 12) return null;
  // Period count → annualization factor. Roughly: returns are monthly for
  // Joe's seeded data; cron will add daily later. Detect by mean gap.
  const firstD = new Date(aggregate[0].as_of + "T00:00:00Z");
  const lastD  = new Date(aggregate[aggregate.length-1].as_of + "T00:00:00Z");
  const totalDays = (lastD - firstD) / 86400000;
  const periodsPerYear = totalDays > 0 ? (returns.length / (totalDays / 365.25)) : 12;
  // Cumulative TWR
  let cum = 1.0;
  for (const r of returns) cum *= (1 + r);
  const annualR = totalDays > 0 ? Math.pow(cum, 365.25 / totalDays) - 1 : null;
  const sd = stdev(returns);
  const annualVol = sd * Math.sqrt(periodsPerYear);
  if (!Number.isFinite(annualR) || !Number.isFinite(annualVol) || annualVol === 0) return null;
  return {
    sharpe:    (annualR - rfrAnnual) / annualVol,
    annualR,
    annualVol,
    rfrAnnual,
    periods:   returns.length,
    spanDays:  Math.round(totalDays),
  };
}
