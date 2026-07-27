/* labMath.js — pure math for the Portfolio Lab page (/portfolio-lab).
   No React, no network. Every function is exercised by labMath.test.mjs
   with hand-computed expected values (LESSONS 3.4 paper-check rule).

   Conventions:
   - Daily simple returns on ADJUSTED closes: r_t = c_t / c_{t-1} - 1.
   - Annualization: mean/vol x 252 trading days; cov x 252.
   - All optimizer inputs are ANNUAL arithmetic quantities.
   - Horizon scaling: ER_h = (1 + ER_annual)^years - 1; vol_h = vol * sqrt(years).
*/

export const TRADING_DAYS = 252;

export const HORIZONS = {
  '3m': { label: '3 months', years: 0.25 },
  '6m': { label: '6 months', years: 0.5 },
  '1y': { label: '1 year', years: 1 },
  '3y': { label: '3 years', years: 3 },
};

/* ── series utilities ──────────────────────────────────────────────────── */

// seriesMap: { TICKER: [{d:'YYYY-MM-DD', c:Number}, ...] ascending }
// Returns { dates:[...], closes:{TICKER:[...]}} on the intersection of dates.
export function alignSeries(seriesMap) {
  const tickers = Object.keys(seriesMap);
  if (!tickers.length) return { dates: [], closes: {} };
  let common = null;
  for (const t of tickers) {
    const set = new Set(seriesMap[t].map((p) => p.d));
    common = common ? new Set([...common].filter((d) => set.has(d))) : set;
  }
  const dates = [...common].sort();
  const closes = {};
  for (const t of tickers) {
    const byDate = new Map(seriesMap[t].map((p) => [p.d, p.c]));
    closes[t] = dates.map((d) => byDate.get(d));
  }
  return { dates, closes };
}

export function dailyReturns(closes) {
  const out = [];
  for (let i = 1; i < closes.length; i++) out.push(closes[i] / closes[i - 1] - 1);
  return out;
}

export function mean(xs) {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

// Sample covariance (n-1 denominator).
export function cov(xs, ys) {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return 0;
  const mx = mean(xs.slice(0, n));
  const my = mean(ys.slice(0, n));
  let s = 0;
  for (let i = 0; i < n; i++) s += (xs[i] - mx) * (ys[i] - my);
  return s / (n - 1);
}

export function variance(xs) {
  return cov(xs, xs);
}

// Annualized volatility from daily returns.
export function annualVol(dailyRets) {
  return Math.sqrt(variance(dailyRets) * TRADING_DAYS);
}

// Annualized covariance matrix from a returns matrix { T: [r...] }.
export function covMatrix(retsByTicker, order) {
  const n = order.length;
  const S = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = i; j < n; j++) {
      const c = cov(retsByTicker[order[i]], retsByTicker[order[j]]) * TRADING_DAYS;
      S[i][j] = c;
      S[j][i] = c;
    }
  }
  return S;
}

export function corrMatrix(retsByTicker, order) {
  const n = order.length;
  const C = Array.from({ length: n }, () => new Array(n).fill(1));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const vi = variance(retsByTicker[order[i]]);
      const vj = variance(retsByTicker[order[j]]);
      const c = vi > 0 && vj > 0
        ? cov(retsByTicker[order[i]], retsByTicker[order[j]]) / Math.sqrt(vi * vj)
        : 0;
      C[i][j] = c;
      C[j][i] = c;
    }
  }
  return C;
}

// Beta of a stock vs a benchmark from daily returns (annualization cancels).
export function betaVs(stockRets, benchRets) {
  const v = variance(benchRets.slice(0, Math.min(stockRets.length, benchRets.length)));
  if (v <= 0) return null;
  return cov(stockRets, benchRets) / v;
}

/* ── expected-return methods ───────────────────────────────────────────── */

// CAPM annual ER. rf and erp as decimals (0.043, 0.0423).
export function capmAnnualER(beta, rf, erp) {
  if (beta == null || rf == null || erp == null) return null;
  return rf + beta * erp;
}

// Weighted-scenario ER over the chosen horizon (targets are horizon prices).
// scenarios: { bull:{price,prob}, base:{price,prob}, bear:{price,prob} },
// probs in percent (must sum to 100). Returns null when invalid.
export function scenarioHorizonER(scenarios, lastPrice) {
  if (!scenarios || !lastPrice || lastPrice <= 0) return null;
  const keys = ['bull', 'base', 'bear'];
  let probSum = 0;
  let er = 0;
  for (const k of keys) {
    const s = scenarios[k];
    if (!s || !(s.price > 0) || !(s.prob >= 0)) return null;
    probSum += Number(s.prob);
    er += (Number(s.prob) / 100) * (Number(s.price) / lastPrice - 1);
  }
  if (Math.round(probSum) !== 100) return null;
  return er;
}

export function horizonFromAnnual(annualER, years) {
  if (annualER == null) return null;
  return Math.pow(1 + annualER, years) - 1;
}

export function annualFromHorizon(horizonER, years) {
  if (horizonER == null) return null;
  const g = 1 + horizonER;
  if (g <= 0) return -1; // total loss floor
  return Math.pow(g, 1 / years) - 1;
}

/* ── portfolio statistics ──────────────────────────────────────────────── */

export function portfolioER(weights, mu) {
  let s = 0;
  for (let i = 0; i < weights.length; i++) s += weights[i] * mu[i];
  return s;
}

export function portfolioVol(weights, S) {
  let v = 0;
  for (let i = 0; i < weights.length; i++) {
    for (let j = 0; j < weights.length; j++) v += weights[i] * S[i][j] * weights[j];
  }
  return Math.sqrt(Math.max(v, 0));
}

// Percent contribution to portfolio variance per holding; sums to 1.
export function riskContribution(weights, S) {
  const n = weights.length;
  const Sw = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) Sw[i] += S[i][j] * weights[j];
  }
  let pv = 0;
  for (let i = 0; i < n; i++) pv += weights[i] * Sw[i];
  if (pv <= 0) return weights.map(() => 0);
  return weights.map((w, i) => (w * Sw[i]) / pv);
}

// Historical portfolio path: monthly rebalance to target weights.
// closes: {T:[...]} aligned; dates ascending. Returns NAV series starting at 1.
export function portfolioPath(dates, closes, order, weights) {
  const T = dates.length;
  if (!T) return [];
  const nav = new Array(T).fill(1);
  let shares = order.map((t, i) => weights[i] / closes[t][0]);
  let month = dates[0].slice(0, 7);
  for (let k = 1; k < T; k++) {
    let v = 0;
    for (let i = 0; i < order.length; i++) v += shares[i] * closes[order[i]][k];
    nav[k] = v;
    const m = dates[k].slice(0, 7);
    if (m !== month) {
      month = m;
      shares = order.map((t, i) => (weights[i] * v) / closes[t][k]);
    }
  }
  return nav;
}

export function maxDrawdown(nav) {
  let peak = -Infinity;
  let mdd = 0;
  for (const v of nav) {
    if (v > peak) peak = v;
    const dd = v / peak - 1;
    if (dd < mdd) mdd = dd;
  }
  return mdd;
}

/* ── optimizer: long-only mean-variance frontier ───────────────────────── */

// Euclidean projection of v onto the probability simplex (Duchi et al. 2008).
export function projectSimplex(v) {
  const n = v.length;
  const u = [...v].sort((a, b) => b - a);
  let css = 0;
  let rho = -1;
  let theta = 0;
  const csum = [];
  for (let i = 0; i < n; i++) {
    css += u[i];
    csum.push(css);
    if (u[i] - (css - 1) / (i + 1) > 0) rho = i;
  }
  theta = rho >= 0 ? (csum[rho] - 1) / (rho + 1) : (css - 1) / n;
  return v.map((x) => Math.max(x - theta, 0));
}

// Minimize w'Sw + P (w.mu - target)^2 over the simplex by projected gradient.
// P=0 gives the global long-only minimum-variance portfolio.
export function minVarianceForTarget(S, mu, target, P = 0, iters = 800) {
  const n = mu.length;
  let w = new Array(n).fill(1 / n);
  // Lipschitz-ish step from the largest diagonal scale.
  let scale = 0;
  for (let i = 0; i < n; i++) scale = Math.max(scale, S[i][i]);
  const muMax = Math.max(...mu.map(Math.abs), 1e-9);
  const L = 2 * (scale * n + P * muMax * muMax * n);
  const lr = 1 / Math.max(L, 1e-9);
  for (let it = 0; it < iters; it++) {
    const Sw = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) Sw[i] += S[i][j] * w[j];
    }
    let g0 = 0;
    if (P > 0) {
      let m = 0;
      for (let i = 0; i < n; i++) m += w[i] * mu[i];
      g0 = 2 * P * (m - target);
    }
    const g = w.map((_, i) => 2 * Sw[i] + g0 * mu[i]);
    w = projectSimplex(w.map((x, i) => x - lr * g[i]));
  }
  return w;
}

// Long-only efficient frontier: nPoints portfolios spanning [minVolER, maxER].
// Returns [{ret, vol, weights}] sorted by vol, plus named presets.
export function efficientFrontier(S, mu, rf, nPoints = 40) {
  const n = mu.length;
  if (n === 1) {
    const w = [1];
    const pt = { ret: mu[0], vol: Math.sqrt(Math.max(S[0][0], 0)), weights: w };
    return { points: [pt], minVol: pt, maxSharpe: pt, equalWeight: pt };
  }
  const scale = Math.max(...mu.map(Math.abs), 0.01);
  const P = (100 * Math.max(...S.map((r, i) => S[i][i]))) / (scale * scale);

  const wMinVol = minVarianceForTarget(S, mu, 0, 0);
  const retMin = portfolioER(wMinVol, mu);
  const retMax = Math.max(...mu);

  const points = [];
  for (let k = 0; k < nPoints; k++) {
    const target = retMin + ((retMax - retMin) * k) / (nPoints - 1);
    const w = minVarianceForTarget(S, mu, target, P);
    points.push({ ret: portfolioER(w, mu), vol: portfolioVol(w, S), weights: w });
  }
  points.sort((a, b) => a.vol - b.vol);

  const minVol = { ret: retMin, vol: portfolioVol(wMinVol, S), weights: wMinVol };
  let maxSharpe = points[0];
  let best = -Infinity;
  for (const p of points) {
    if (p.vol > 1e-9) {
      const s = (p.ret - rf) / p.vol;
      if (s > best) { best = s; maxSharpe = p; }
    }
  }
  const wEq = new Array(n).fill(1 / n);
  const equalWeight = { ret: portfolioER(wEq, mu), vol: portfolioVol(wEq, S), weights: wEq };
  return { points, minVol, maxSharpe, equalWeight };
}

/* ── SIC code → SPDR sector ETF (approximate mapping for the sector-mix
      benchmark; names with no SIC map to SPY) ─────────────────────────── */
export function sicToSectorEtf(sic) {
  const c = Number(sic);
  if (!Number.isFinite(c) || c <= 0) return 'SPY';
  if (c >= 100 && c <= 999) return 'XLP';        // agriculture
  if (c >= 1000 && c <= 1499) return 'XLE';      // mining, oil & gas extraction
  if (c >= 1500 && c <= 1799) return 'XLI';      // construction
  if (c >= 2000 && c <= 2199) return 'XLP';      // food, beverage, tobacco
  if (c >= 2200 && c <= 2799) return 'XLB';      // textiles, paper, printing
  if (c >= 2830 && c <= 2836) return 'XLV';      // pharma & biologics
  if (c >= 2800 && c <= 2899) return 'XLB';      // chemicals
  if (c >= 2900 && c <= 2999) return 'XLE';      // petroleum refining
  if (c >= 3000 && c <= 3499) return 'XLB';      // rubber, glass, metals
  if (c >= 3570 && c <= 3579) return 'XLK';      // computers
  if (c >= 3600 && c <= 3699) return 'XLK';      // electronics, semis
  if (c >= 3826 && c <= 3851) return 'XLV';      // medical instruments
  if (c >= 3711 && c <= 3716) return 'XLY';      // autos
  if (c >= 3720 && c <= 3799) return 'XLI';      // aerospace, rail, other transport eq
  if (c >= 3500 && c <= 3999) return 'XLI';      // remaining machinery/manufacturing
  if (c >= 4000 && c <= 4799) return 'XLI';      // transportation
  if (c >= 4800 && c <= 4899) return 'XLC';      // communications
  if (c >= 4900 && c <= 4999) return 'XLU';      // utilities
  if (c >= 5000 && c <= 5199) return 'XLI';      // wholesale
  if (c >= 5200 && c <= 5999) return 'XLY';      // retail
  if (c >= 6500 && c <= 6599) return 'XLRE';     // real estate
  if (c >= 6798 && c <= 6798) return 'XLRE';     // REITs
  if (c >= 6000 && c <= 6999) return 'XLF';      // finance & insurance
  if (c >= 7370 && c <= 7379) return 'XLK';      // software & data services
  if (c >= 7800 && c <= 7999) return 'XLC';      // media & entertainment
  if (c >= 8000 && c <= 8099) return 'XLV';      // health services
  if (c >= 7000 && c <= 8999) return 'XLY';      // other consumer/business services
  return 'SPY';
}
