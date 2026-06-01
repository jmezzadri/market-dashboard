// portfolioRisk.js — trailing, proxy-based risk statistics for the live book.
//
// Pure functions (no React, no network). The page fetches the market feed
// public/risk_proxies.json (≈3y of daily returns for a set of liquid proxy
// instruments + the risk-free rate, refreshed nightly) and passes it here
// with the enriched book rows; we combine the market series with the book's
// CURRENT weights to produce volatility, Sharpe, Sortino, max drawdown,
// value-at-risk and factor betas. Because weights come from the live book,
// the stats always reflect the current positions with no per-user storage.
//
// Funds without clean daily history map to a liquid look-alike, so the output
// is an estimate (the page labels it "proxy-based"). The option enters as its
// delta-equivalent short position in the underlier's proxy — a first-order
// (delta-only) treatment, consistent with the rest of the page.

// holding ticker -> proxy instrument (must exist in risk_proxies.json)
export const RISK_PROXY = {
  JHYUX: 'HYG', NHXINT906: 'EFA', FXAIX: 'SPY', FSKAX: 'VTI',
  GLD: 'GLD', SLV: 'SLV', FBTC: 'BTC-USD', ETHE: 'ETH-USD', PLSE: 'PLSE', RCAT: 'RCAT',
};
// fallback by asset class for any holding not individually mapped
export const AC_PROXY = { 'Fixed Income': 'HYG', Equity: 'SPY', Commodity: 'GLD', Crypto: 'BTC-USD' };

const mean = (a) => a.reduce((s, x) => s + x, 0) / (a.length || 1);
const sampStd = (a) => {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) * (x - m), 0) / (a.length - 1));
};
const sampCov = (a, b) => {
  const n = Math.min(a.length, b.length); if (n < 2) return 0;
  const ma = mean(a), mb = mean(b); let s = 0;
  for (let i = 0; i < n; i++) s += (a[i] - ma) * (b[i] - mb);
  return s / (n - 1);
};

export function proxyFor(row) {
  if (row.cls?.ac === 'Cash') return null;
  if (row.option) return 'QQQ';
  return RISK_PROXY[String(row.ticker).toUpperCase()] || AC_PROXY[row.cls?.ac] || 'SPY';
}

// rows = enriched book.rows; total = NAV; feed = parsed risk_proxies.json
export function computeTrailingRisk(rows, total, feed) {
  if (!feed || !feed.returns || !total) return null;
  const R = feed.returns;
  const N = (R.SPY || Object.values(R)[0] || []).length;
  if (!N) return null;
  const rf = Number(feed.rf_annual) || 0.04;
  const rfDaily = rf / 252;

  const port = new Array(N).fill(0);
  let cashW = 0, coveredW = 0; const proxiesUsed = new Set(); let missing = 0;
  for (const r of rows) {
    if (r.cls?.ac === 'Cash') { cashW += r.value / total; continue; }
    let w, key;
    if (r.option) { key = 'QQQ'; w = (r.option.deltaEquivNotional || 0) / total; }
    else { key = proxyFor(r); w = r.value / total; }
    const s = R[key];
    if (!s) { missing += Math.abs(w); continue; }
    for (let i = 0; i < N; i++) port[i] += w * s[i];
    proxiesUsed.add(key); coveredW += Math.abs(w);
  }
  for (let i = 0; i < N; i++) port[i] += cashW * rfDaily; // cash earns rf, zero variance

  const p = port.slice(1); // drop the seeded first day (return 0)
  if (p.length < 30) return null;
  const annReturn = mean(p) * 252;
  const sd = sampStd(p);
  const vol = sd * Math.sqrt(252);
  const sharpe = vol ? (annReturn - rf) / vol : null;
  const dn = p.filter((x) => x < 0);
  const dsd = sampStd(dn);
  const sortino = dsd ? (annReturn - rf) / (dsd * Math.sqrt(252)) : null;

  // max drawdown over the trailing ~12 months
  const p12 = p.slice(-252);
  let cum = 1, peak = 1, mdd = 0;
  for (const x of p12) { cum *= (1 + x); peak = Math.max(peak, cum); mdd = Math.min(mdd, cum / peak - 1); }

  // 1-day 95% value-at-risk, historical (5th percentile of daily returns)
  const sorted = [...p].sort((a, b) => a - b);
  const var95 = -sorted[Math.max(0, Math.floor(0.05 * sorted.length))];

  const betaTo = (f) => { const fa = R[f] ? R[f].slice(1) : null; if (!fa) return null; const v = sampStd(fa) ** 2; return v ? sampCov(p, fa) / v : null; };

  return {
    annReturn, vol, sharpe, sortino, maxDD: mdd,
    var95, var95Dollar: var95 * total,
    betaHY: betaTo('HYG'), betaRates: betaTo('IEF'), betaMkt: betaTo('SPY'),
    asOf: feed.as_of, windowStart: feed.window_start, windowYears: feed.window_years,
    proxiesUsed: [...proxiesUsed], coverage: coveredW, missingWeight: missing,
  };
}
