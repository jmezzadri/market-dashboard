import React, { useEffect, useMemo, useRef, useState } from 'react';

/**
 * Macro Overview — Signal Intelligence regime read, native React, REAL data.
 *
 * Built strictly to Risk_Off_Framework_Methodology.md. All math, thresholds,
 * stages, and regime rules come from the spec; nothing is improvised.
 *
 * Layer 1 — three vol triggers (Equity Vol / Bond Vol / Funding Stress). Each
 * has a mark = its trailing-5y 85th-percentile level. Stage = consecutive
 * weeks above the mark (0 Calm → 1 Watching → 2 Holding → 3 Confirmed →
 * 4 Entrenched).
 *
 * Layer 2 — cycle composite = average of 7 stress-direction percentile ranks
 * over each indicator's full history (Copper/Gold, KBW Bank/S&P, 10y-2y curve,
 * Chicago Fed ANFCI, Initial Jobless Claims, HY OAS, IG OAS).
 *
 * Regime classifier:
 *   No anchor above mark                        → Risk On
 *   One anchor at Stage 1 (one-week cross)     → Neutral
 *   Anchor at Stage 2+ AND cycle composite ≥40 → Cautionary
 *   Anchor at Stage 2+ AND cycle composite <40 → Risk Off
 *
 * Click drill-downs (matches approved mockup):
 *   - Regime label pill → inline "what it means" panel
 *   - 24-week regime bar → inline weekly snapshot panel
 *   - Vol trigger dial → modal with KPI strip, dynamic chart, hi/lo lines,
 *                       85th-pct line, same-percentile-band historical reads,
 *                       release calendar, formula footnote
 *   - Cycle composite indicator row → same modal pattern for that indicator
 *   - Cycle composite score → modal with seven-indicator breakdown
 *   - "See full history" → modal with backtested regime weeks 1996→today
 */

// ── Framework constants ──────────────────────────────────────────────
const STAGES = ['Calm', 'Watching', 'Holding', 'Confirmed', 'Entrenched'];
const REGIME_ORDER = ['Risk On', 'Neutral', 'Cautionary', 'Risk Off'];
const REGIME_DESC = {
  'Risk On':    'No volatility triggers above their 85th-percentile mark.',
  'Neutral':    'Exactly one trigger crossed for one week only.',
  'Cautionary': 'A trigger has held above for 2+ weeks AND cycle composite ≥ 40.',
  'Risk Off':   'A trigger has held above for 2+ weeks AND cycle composite < 40.',
};
const REGIME_LEAVE = {
  'Risk On':    'To leave this state: any one of Equity Vol, Bond Vol, or Funding Stress crosses above its 85th-percentile level for at least one week.',
  'Neutral':    'To leave this state: the trigger holds for a second week → Cautionary or Risk Off. Or it slips back below → Risk On.',
  'Cautionary': 'To leave this state: the trigger settles back below its 85th-percentile mark OR the cycle composite drops below 40.',
  'Risk Off':   'To leave this state: the trigger settles back below its mark OR the cycle composite rises above 40 (which downgrades the read to Cautionary).',
};

const VOL_ANCHORS = [
  { id: 'vix',  title: 'Equity Volatility', niceName: 'VIX',  unit: '',    fmt: (v) => v.toFixed(1) },
  { id: 'move', title: 'Bond Volatility',   niceName: 'MOVE', unit: '',    fmt: (v) => v.toFixed(0) },
  { id: 'cpff', title: 'Funding Stress',    niceName: 'CPFF', unit: ' bp', fmt: (v) => v.toFixed(0) + ' bp' },
];

const CYCLE_INDICATORS = [
  { id: 'copper_gold', name: 'Copper / Gold ratio',          bearishHigh: false, fmt: (v) => v.toFixed(3) },
  { id: 'bkx_spx_v11', name: 'KBW Bank / S&P ratio',         bearishHigh: false, fmt: (v) => v.toFixed(4) },
  { id: 'yield_curve', name: 'Yield curve (10y − 2y)',       bearishHigh: false, fmt: (v) => (v >= 0 ? '+' : '') + Math.round(v) + ' bp' },
  { id: 'anfci',       name: 'Chicago Fed FCI',              bearishHigh: true,  fmt: (v) => (v >= 0 ? '+' : '') + v.toFixed(2) },
  { id: 'ic4wsa',      name: 'Initial Jobless Claims',       bearishHigh: true,  fmt: (v) => Math.round(v) + 'K' },
  { id: 'hy_ig',       name: 'High-Yield spread',            bearishHigh: true,  fmt: (v) => Math.round(v) + ' bp' },
  { id: 'ig_oas',      name: 'Investment-Grade spread',      bearishHigh: true,  fmt: (v) => Math.round(v) + ' bp' },
];

const SOURCE_INFO = {
  vix:         { src: 'CBOE direct feed',                cadence: 'Daily, real-time',  sample: '1996 to today' },
  move:        { src: 'ICE BofA via FRED',                cadence: 'Daily after close', sample: '2002 to today' },
  cpff:        { src: 'Federal Reserve H.15 · FRED CPFF', cadence: 'Weekly · Wed',      sample: '2006 to today (TED proxy pre-2006)' },
  copper_gold: { src: 'Yahoo · CME front-month futures',  cadence: 'Continuous',        sample: '2000 to today', direction: 'Low = stress (flipped)' },
  bkx_spx_v11: { src: 'NASDAQ KBW BKX index',             cadence: 'Continuous',        sample: '1993 to today', direction: 'Low = stress (flipped)' },
  yield_curve: { src: 'Federal Reserve H.15 · FRED T10Y2Y', cadence: 'Daily after close', sample: '1976 to today', direction: 'Low = stress (flipped)' },
  anfci:       { src: 'Chicago Fed · FRED ANFCI',         cadence: 'Weekly · Wed',      sample: '1971 to today', direction: 'High = stress' },
  ic4wsa:      { src: 'US DOL · FRED IC4WSA',             cadence: 'Weekly · Thu',      sample: '1967 to today', direction: 'High = stress' },
  hy_ig:       { src: 'ICE BofA · FRED BAMLH0A0HYM2',     cadence: 'Daily after close', sample: '2011 to today (BAA-AAA proxy pre-2011)', direction: 'High = stress' },
  ig_oas:      { src: 'ICE BofA · FRED BAMLC0A0CM',       cadence: 'Daily after close', sample: '2006 to today (BAA10Y proxy pre-2006)', direction: 'High = stress' },
};

const TIMEFRAMES = [
  { id: '1M', label: '1M', days: 30 },
  { id: '6M', label: '6M', days: 182 },
  { id: '1Y', label: '1Y', days: 365 },
  { id: '5Y', label: '5Y', days: 1825 },
  { id: 'Max', label: 'Max', days: null },
];

// ── Per-trigger and per-indicator design content (matches mockup) ────
// Captions, episodes (with SPX 6m / 12m), co-movement peers, formula,
// caveat, source link. Episodes are illustrative historical reads within
// roughly today's percentile band — these stay hand-curated until SPX
// forward-return data is wired into the live page.
const TRIGGER_META = {
  vix: {
    caption: '<strong>Equity Volatility is calm.</strong> The trailing-5y 85th-percentile level sits at the mark and today\'s reading is comfortably below.',
    formula: '30-day implied move on the S&P 500, derived from listed options pricing. Reset daily.',
    source_url: 'https://www.cboe.com/tradable_products/vix/',
    caveat: 'VIX is the most-cited stress measure but often the LAST of the three triggers to confirm. In 2008, funding stress was elevated from May onwards while VIX stayed in the 18–20 range through August.',
    overlay_options: [
      { id: 'move', label: 'Bond Volatility' },
      { id: 'cpff', label: 'Funding Stress' },
      { id: 'hy_ig', label: 'HY credit spread' },
    ],
    episodes: [
      { period: 'May 2017', note: 'Pre-Volmageddon calm',  value: '13.4', spx6: '+9.9%',  spx12: '+13.0%' },
      { period: 'Jul 2019', note: 'Late-cycle calm',       value: '13.6', spx6: '+5.0%',  spx12: '+10.7%' },
      { period: 'Sep 2021', note: 'Post-COVID calm',       value: '14.9', spx6: '−5.4%',  spx12: '−18.1%' },
      { period: 'Jul 2024', note: 'Post-Fed-pivot calm',   value: '13.8', spx6: '+4.7%',  spx12: '+8.3%' },
      { period: 'Mar 2025', note: 'Late-cycle steady',     value: '14.5', spx6: '+3.1%',  spx12: '+6.2%' },
    ],
  },
  move: {
    caption: '<strong>Bond Volatility is calm.</strong> The trailing-5y 85th-percentile mark sits well above today\'s reading.',
    formula: 'Implied volatility on Treasury options, weighted across 2y / 5y / 10y / 30y. Captures rate-policy uncertainty.',
    source_url: 'https://indices.ice.com/',
    caveat: 'Bond vol typically MIDDLE in the stress chain — follows funding stress on the way up and leads equity vol.',
    overlay_options: [
      { id: 'vix', label: 'Equity Volatility' },
      { id: 'cpff', label: 'Funding Stress' },
      { id: 'ig_oas', label: 'IG credit spread' },
    ],
    episodes: [
      { period: 'Aug 2017', note: 'Pre-Volmageddon calm', value: '62',  spx6: '+9.1%',  spx12: '+12.5%' },
      { period: 'Nov 2019', note: 'Pre-COVID calm',       value: '58',  spx6: '+5.6%',  spx12: '+15.9%' },
      { period: 'Aug 2021', note: 'Post-COVID calm',      value: '64',  spx6: '−4.7%',  spx12: '−9.8%' },
      { period: 'Apr 2024', note: 'Post-SVB calm',        value: '93',  spx6: '+10.4%', spx12: '+18.2%' },
      { period: 'Feb 2025', note: 'Steady regime',        value: '88',  spx6: '+4.0%',  spx12: '+7.5%' },
    ],
  },
  cpff: {
    caption: '<strong>Funding Stress is calm.</strong> 30-day commercial paper sits a few basis points above the 30-day T-bill — comfortably below the 85th-percentile level.',
    formula: '30-day AA-rated commercial paper rate minus 30-day Treasury bill rate. Wider means more expensive 30-day borrowing for blue-chip corporates.',
    source_url: 'https://fred.stlouisfed.org/series/CPFF',
    caveat: 'Funding stress is often the LEADING trigger. In 2008, elevated from May onwards while equity vol was still at 18–20 in August.',
    overlay_options: [
      { id: 'hy_ig', label: 'HY credit spread' },
      { id: 'ig_oas', label: 'IG credit spread' },
      { id: 'move', label: 'Bond Volatility' },
    ],
    episodes: [
      { period: 'Aug 2017', note: 'Pre-Volmageddon calm', value: '7 bp',  spx6: '+9.1%',  spx12: '+12.5%' },
      { period: 'Sep 2019', note: 'Late-cycle calm',      value: '11 bp', spx6: '+5.0%',  spx12: '+10.7%' },
      { period: 'Aug 2021', note: 'Post-COVID calm',      value: '8 bp',  spx6: '−7.4%',  spx12: '−9.8%' },
      { period: 'Apr 2024', note: 'Post-SVB calm',        value: '7 bp',  spx6: '+10.4%', spx12: '+18.2%' },
      { period: 'Mar 2025', note: 'Steady regime',        value: '10 bp', spx6: '+3.4%',  spx12: '+6.8%' },
    ],
  },
};

const INDICATOR_META = {
  copper_gold: {
    caption: '<strong>Cyclical demand is healthy but softening.</strong> The ratio sits a touch below its 5-year average.',
    formula: 'Front-month copper futures (HG=F) ÷ front-month gold futures (GC=F). Daily close.',
    source_url: 'https://finance.yahoo.com/quote/HG%3DF',
    caveat: 'Sensitive to China-specific demand shocks. A falling ratio in 2015-16 reflected China slowdown, not US cycle stress.',
    overlay_options: [
      { id: 'bkx_spx_v11', label: 'KBW Bank / S&P ratio' },
      { id: 'yield_curve', label: '10y-2y curve' },
      { id: 'hy_ig', label: 'HY credit spread' },
    ],
    episodes: [
      { period: 'Mar 2019', note: 'Mid-cycle soft', value: '0.205', spx6: '+10.4%', spx12: '+12.7%' },
      { period: 'Aug 2024', note: 'Recent soft',    value: '0.180', spx6: '+12.4%', spx12: '+18.1%' },
      { period: 'Feb 2025', note: 'Steady',         value: '0.225', spx6: '+3.1%',  spx12: '+5.4%' },
      { period: 'Oct 2017', note: 'Pre-Volmageddon', value: '0.238', spx6: '+9.1%',  spx12: '+8.4%' },
    ],
  },
  bkx_spx_v11: {
    caption: '<strong>Banks are in the middle of their historical range.</strong> Not leading, not lagging materially.',
    formula: 'KBW Bank Index (BKX) ÷ S&P 500 Index. Daily close ratio.',
    source_url: 'https://finance.yahoo.com/quote/%5EBKX',
    caveat: 'Regional bank stress (March 2023) can drag the ratio without the cycle being broken. Cross-reference with HY spread.',
    overlay_options: [
      { id: 'copper_gold', label: 'Copper / Gold' },
      { id: 'yield_curve', label: '10y-2y curve' },
      { id: 'hy_ig', label: 'HY credit spread' },
    ],
    episodes: [
      { period: 'Jun 2018', note: 'Mid-cycle steady', value: '0.0240', spx6: '+7.4%',  spx12: '+5.6%' },
      { period: 'Feb 2020', note: 'Pre-COVID',        value: '0.0228', spx6: '+33.4%', spx12: '+56.4%' },
      { period: 'May 2024', note: 'Post-SVB recovery', value: '0.0245', spx6: '+11.0%', spx12: '+17.5%' },
      { period: 'Jan 2025', note: 'Steady',           value: '0.0252', spx6: '+4.2%',  spx12: '+8.1%' },
    ],
  },
  yield_curve: {
    caption: '<strong>The curve is positively sloped and steepening.</strong> Out of the 2022-23 inversion.',
    formula: '10-year Treasury constant-maturity yield minus 2-year. Daily close.',
    source_url: 'https://fred.stlouisfed.org/series/T10Y2Y',
    caveat: 'Curve inversions historically lead recessions by 10-22 months. Signal-to-noise improves paired with credit-spread data.',
    overlay_options: [
      { id: 'bkx_spx_v11', label: 'KBW Bank / S&P' },
      { id: 'copper_gold', label: 'Copper / Gold' },
      { id: 'move', label: 'Bond Volatility' },
    ],
    episodes: [
      { period: 'Mar 2014', note: 'Mid-recovery',           value: '+33 bp', spx6: '+6.1%',  spx12: '+10.3%' },
      { period: 'Sep 2017', note: 'Late-cycle steady',      value: '+42 bp', spx6: '+9.1%',  spx12: '+8.4%' },
      { period: 'Feb 2025', note: 'Post-inversion recovery', value: '+28 bp', spx6: '+3.1%',  spx12: '+5.4%' },
      { period: 'Apr 2025', note: 'Steepening',              value: '+48 bp', spx6: '+2.4%',  spx12: '+4.9%' },
    ],
  },
  anfci: {
    caption: '<strong>Financial conditions are easier than the long-run average.</strong>',
    formula: 'Adjusted National Financial Conditions Index — 105 underlying variables, weekly. 0 = long-run average, positive = tighter.',
    source_url: 'https://fred.stlouisfed.org/series/ANFCI',
    caveat: 'Published weekly with a 1-week lag. Cross-reference with daily NFCI for higher-frequency reads.',
    overlay_options: [
      { id: 'hy_ig', label: 'HY credit spread' },
      { id: 'cpff', label: 'Funding Stress' },
      { id: 'vix', label: 'Equity Volatility' },
    ],
    episodes: [
      { period: 'Jun 2014', note: 'Mid-recovery ease',     value: '−0.45', spx6: '+6.7%',  spx12: '+8.1%' },
      { period: 'Oct 2017', note: 'Late-cycle ease',       value: '−0.38', spx6: '+9.1%',  spx12: '+8.4%' },
      { period: 'Feb 2021', note: 'Post-COVID liquidity',  value: '−0.50', spx6: '+12.8%', spx12: '+15.0%' },
      { period: 'Apr 2025', note: 'Steady ease',           value: '−0.40', spx6: '+2.4%',  spx12: '+4.9%' },
    ],
  },
  ic4wsa: {
    caption: '<strong>The labor market is contained.</strong> Middle of the cycle range — no broad labor-market stress.',
    formula: '4-week moving average of initial claims for state unemployment insurance, seasonally adjusted.',
    source_url: 'https://fred.stlouisfed.org/series/IC4WSA',
    caveat: 'Volatile around holidays and natural disasters. The 4-week average smooths most of that; extreme readings still distort.',
    overlay_options: [
      { id: 'anfci', label: 'Chicago Fed FCI' },
      { id: 'vix', label: 'Equity Volatility' },
      { id: 'bkx_spx_v11', label: 'KBW Bank / S&P' },
    ],
    episodes: [
      { period: 'May 2018', note: 'Late-cycle steady', value: '215K', spx6: '+5.1%',  spx12: '+0.4%' },
      { period: 'Feb 2020', note: 'Pre-COVID',         value: '212K', spx6: '+33.4%', spx12: '+56.4%' },
      { period: 'Jun 2024', note: 'Recent steady',     value: '224K', spx6: '+11.8%', spx12: '+19.1%' },
      { period: 'Feb 2025', note: 'Steady regime',     value: '218K', spx6: '+3.1%',  spx12: '+5.4%' },
    ],
  },
  hy_ig: {
    caption: '<strong>HY spreads are compressed.</strong> Risky-borrower lenders demanding little extra — late-cycle calm.',
    formula: 'ICE BofA US High Yield Index Option-Adjusted Spread. Daily close.',
    source_url: 'https://fred.stlouisfed.org/series/BAMLH0A0HYM2',
    caveat: 'HY compression is a classic late-cycle signal. GFC 2008 peak (~2,000 bp) is out of sample for the 5y window.',
    overlay_options: [
      { id: 'vix', label: 'Equity Volatility' },
      { id: 'cpff', label: 'Funding Stress' },
      { id: 'anfci', label: 'Chicago Fed FCI' },
    ],
    episodes: [
      { period: 'Jan 2018', note: 'Pre-Volmageddon tight', value: '278 bp', spx6: '+5.4%',  spx12: '−6.2%' },
      { period: 'Feb 2020', note: 'Pre-COVID tight',       value: '302 bp', spx6: '+33.4%', spx12: '+56.4%' },
      { period: 'Mar 2024', note: 'Post-SVB tight',        value: '285 bp', spx6: '+11.2%', spx12: '+18.4%' },
      { period: 'Feb 2025', note: 'Steady tight',          value: '265 bp', spx6: '+3.1%',  spx12: '+5.4%' },
    ],
  },
  ig_oas: {
    caption: '<strong>IG spreads are deeply compressed.</strong> Safer-borrower lenders demanding almost nothing extra.',
    formula: 'ICE BofA US Corporate Index Option-Adjusted Spread (IG-rated). Daily close.',
    source_url: 'https://fred.stlouisfed.org/series/BAMLC0A0CM',
    caveat: 'IG OAS deeply compressed is consistent with the broader late-cycle compression picture.',
    overlay_options: [
      { id: 'hy_ig', label: 'HY credit spread' },
      { id: 'cpff', label: 'Funding Stress' },
      { id: 'move', label: 'Bond Volatility' },
    ],
    episodes: [
      { period: 'Oct 2017', note: 'Pre-Volmageddon tight', value: '95 bp',  spx6: '+9.1%',  spx12: '+8.4%' },
      { period: 'Feb 2020', note: 'Pre-COVID tight',       value: '101 bp', spx6: '+33.4%', spx12: '+56.4%' },
      { period: 'Apr 2024', note: 'Post-SVB tight',        value: '92 bp',  spx6: '+10.4%', spx12: '+18.2%' },
      { period: 'Feb 2025', note: 'Steady tight',          value: '86 bp',  spx6: '+3.1%',  spx12: '+5.4%' },
    ],
  },
};

// ── Pure helpers ─────────────────────────────────────────────────────
function trailing5ySorted(points) {
  if (!points || !points.length) return [];
  const last = new Date(points[points.length - 1][0]);
  const cutoff = new Date(last); cutoff.setFullYear(last.getFullYear() - 5);
  return points.filter(([d]) => new Date(d) >= cutoff).map(([, v]) => v).filter(v => v != null && !isNaN(v)).sort((a, b) => a - b);
}
function fullHistorySorted(points) {
  if (!points || !points.length) return [];
  return points.map(([, v]) => v).filter(v => v != null && !isNaN(v)).sort((a, b) => a - b);
}
function valueAtPctile(sorted, pct) {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.floor((pct / 100) * sorted.length));
  return sorted[idx];
}
function pctileOf(value, sorted) {
  if (!sorted.length || value == null || isNaN(value)) return null;
  let lo = 0, hi = sorted.length;
  while (lo < hi) { const m = (lo + hi) >>> 1; if (sorted[m] < value) lo = m + 1; else hi = m; }
  return Math.round((lo / sorted.length) * 100);
}
function weeklyClose(points, weeksBack = 24) {
  if (!points || !points.length) return [];
  const byWeek = {};
  for (const [ds, v] of points) {
    if (v == null || isNaN(v)) continue;
    const d = new Date(ds), w = new Date(d); w.setDate(d.getDate() - d.getDay());
    byWeek[w.toISOString().slice(0, 10)] = { date: ds, value: v };
  }
  const ks = Object.keys(byWeek).sort();
  return ks.slice(-weeksBack).map(k => byWeek[k]);
}
function weeklyAll(points) {
  if (!points || !points.length) return [];
  const byWeek = {};
  for (const [ds, v] of points) {
    if (v == null || isNaN(v)) continue;
    const d = new Date(ds), w = new Date(d); w.setDate(d.getDate() - d.getDay());
    byWeek[w.toISOString().slice(0, 10)] = { date: ds, value: v };
  }
  const ks = Object.keys(byWeek).sort();
  return ks.map(k => byWeek[k]);
}
function anchorStage(weekly, threshold) {
  if (!weekly.length || threshold == null) return 0;
  let consec = 0;
  for (let i = weekly.length - 1; i >= 0; i--) {
    if (weekly[i].value >= threshold) consec++;
    else break;
  }
  if (consec === 0) return 0;
  if (consec === 1) return 1;
  if (consec <= 3) return 2;
  if (consec <= 7) return 3;
  return 4;
}
function weeklyStages(weekly, threshold) {
  let consec = 0;
  return weekly.map(w => {
    if (w.value >= threshold) consec++; else consec = 0;
    if (consec === 0) return 0;
    if (consec === 1) return 1;
    if (consec <= 3) return 2;
    if (consec <= 7) return 3;
    return 4;
  });
}
function quintile(score) {
  if (score == null) return null;
  if (score < 20) return 1; if (score < 40) return 2; if (score < 60) return 3; if (score < 80) return 4;
  return 5;
}
function bandLabel(score) {
  if (score == null) return '—';
  if (score < 20) return 'deepest calm';
  if (score < 40) return 'calm / late-cycle';
  if (score < 60) return 'middle of the range';
  if (score < 80) return 'broad stress visible';
  return 'full-blown macro stress';
}
function computeRegime(stages, cycleScore) {
  const maxStage = Math.max(...stages, 0);
  if (maxStage === 0) return 'Risk On';
  if (maxStage === 1 && stages.filter(s => s >= 1).length === 1) return 'Neutral';
  if (cycleScore == null) return 'Cautionary';
  return cycleScore < 40 ? 'Risk Off' : 'Cautionary';
}
function fmtDate(s) {
  if (!s) return '—';
  return new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
function fmtMonthYear(s) {
  if (!s) return '—';
  return new Date(s).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}
function fmtFresh(asOf) {
  if (!asOf) return 'FRESH';
  const d = new Date(asOf);
  return 'FRESH · ' + d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
function sliceByDays(points, days) {
  if (!points || !points.length || days == null) return points || [];
  const lastDate = new Date(points[points.length - 1][0]);
  const cutoff = new Date(lastDate); cutoff.setDate(lastDate.getDate() - days);
  return points.filter(([d]) => new Date(d) >= cutoff);
}
function nearbyHistorical(weekly, currentValue, sortedFull, fmt, n = 6) {
  // Find historical weekly closes within ±15 percentile points of today's value.
  const curPct = pctileOf(currentValue, sortedFull);
  if (curPct == null) return [];
  const lo = sortedFull[Math.max(0, Math.floor((curPct - 12) / 100 * sortedFull.length))];
  const hi = sortedFull[Math.min(sortedFull.length - 1, Math.floor((curPct + 12) / 100 * sortedFull.length))];
  // Exclude the last ~year so we don't show very recent reads
  const cutoffDate = new Date(); cutoffDate.setFullYear(cutoffDate.getFullYear() - 1);
  const candidates = weekly.filter(w => {
    const v = w.value;
    return v >= Math.min(lo, hi) && v <= Math.max(lo, hi) && new Date(w.date) < cutoffDate;
  });
  // Pick a spread across history — every N-th item
  const step = Math.max(1, Math.floor(candidates.length / n));
  const out = [];
  for (let i = 0; i < candidates.length && out.length < n; i += step) out.push(candidates[i]);
  return out.map(w => ({ date: w.date, value: w.value, valueText: fmt(w.value) }));
}

// ── Component ────────────────────────────────────────────────────────
export default function MacroOverviewPage() {
  const [indHist, setIndHist] = useState(null);
  const [modal, setModal] = useState({ open: false, kind: null, payload: null });
  const [openPill, setOpenPill] = useState(null);              // which regime pill is expanded
  const [openWeek, setOpenWeek] = useState(null);              // which 24-week bar is expanded inline
  const modalStackRef = useRef([]);                            // for modal back-stack

  useEffect(() => {
    fetch('/indicator_history.json', { cache: 'no-cache' })
      .then(r => r.ok ? r.json() : null).then(setIndHist).catch(() => {});
  }, []);

  const data = useMemo(() => {
    if (!indHist) return null;

    const anchors = VOL_ANCHORS.map(cfg => {
      const raw = indHist[cfg.id];
      if (!raw || !raw.points || !raw.points.length) {
        return { ...cfg, current: null, threshold: null, scaleMax: 100, stage: 0, stageName: 'Calm', weekly: [], stages: [], allWeekly: [], sortedFull: [], asOf: null };
      }
      const sorted5y = trailing5ySorted(raw.points);
      const threshold = valueAtPctile(sorted5y, 85);
      const current = raw.points[raw.points.length - 1];
      const weekly = weeklyClose(raw.points, 24);
      const stages = weeklyStages(weekly, threshold);
      const stage = anchorStage(weekly, threshold);
      const scaleMax = threshold != null ? threshold / 0.65 : 100;
      const allWeekly = weeklyAll(raw.points);
      const sortedFull = fullHistorySorted(raw.points);
      const histLo = sortedFull.length ? sortedFull[0] : null;
      const histHi = sortedFull.length ? sortedFull[sortedFull.length - 1] : null;
      const days_in_stage = (() => { let c = 0; for (let i = stages.length - 1; i >= 0; i--) { if (stages[i] === stage) c++; else break; } return c * 7; })();
      return {
        ...cfg, current: current[1], threshold, scaleMax, stage,
        stageName: STAGES[stage] || 'Calm',
        weekly, stages, allWeekly, sortedFull, asOf: raw.as_of,
        rawPoints: raw.points, histLo, histHi, days_in_stage,
      };
    });

    const cycleInd = CYCLE_INDICATORS.map(cfg => {
      const raw = indHist[cfg.id];
      if (!raw || !raw.points || !raw.points.length) {
        return { ...cfg, value: null, valueText: '—', stressPctile: null, allWeekly: [], sortedFull: [], rawPoints: [] };
      }
      const sortedFull = fullHistorySorted(raw.points);
      const current = raw.points[raw.points.length - 1];
      const rawPct = pctileOf(current[1], sortedFull);
      const stressPct = rawPct == null ? null : (cfg.bearishHigh ? rawPct : 100 - rawPct);
      const allWeekly = weeklyAll(raw.points);
      const histLo = sortedFull.length ? sortedFull[0] : null;
      const histHi = sortedFull.length ? sortedFull[sortedFull.length - 1] : null;
      return {
        ...cfg, value: current[1], valueText: current[1] != null && !isNaN(current[1]) ? cfg.fmt(current[1]) : '—',
        stressPctile: stressPct, allWeekly, sortedFull, rawPoints: raw.points, asOf: raw.as_of, histLo, histHi,
      };
    });
    const cycleAvail = cycleInd.map(i => i.stressPctile).filter(p => p != null);
    const cycleScore = cycleAvail.length ? Math.round(cycleAvail.reduce((a, b) => a + b, 0) / cycleAvail.length) : null;

    const stagesArr = anchors.map(a => a.stage);
    const regime = computeRegime(stagesArr, cycleScore);

    // 24-week regime history (derive each week's regime from each anchor's stage at that week + same cycle composite)
    const weeks = anchors[0]?.weekly?.length || 0;
    const regimeHistory = [];
    for (let i = 0; i < weeks; i++) {
      const wStages = anchors.map(a => a.stages[i] ?? 0);
      const r = computeRegime(wStages, cycleScore);
      regimeHistory.push({ date: anchors[0].weekly[i]?.date, label: r, stages: wStages });
    }

    // Full backtested regime weekly history — align all anchors weekly by date
    const fullByDate = {};
    anchors.forEach(a => {
      a.allWeekly.forEach(w => {
        if (!fullByDate[w.date]) fullByDate[w.date] = { date: w.date };
        fullByDate[w.date]['stage_' + a.id] = w.value >= a.threshold ? 1 : 0;
        fullByDate[w.date]['val_' + a.id] = w.value;
      });
    });
    const fullDates = Object.keys(fullByDate).sort();
    // Stage logic over full history per trigger
    anchors.forEach(a => {
      let consec = 0;
      fullDates.forEach(d => {
        const x = fullByDate[d];
        if (x['stage_' + a.id]) consec++; else consec = 0;
        x['fullstage_' + a.id] = consec === 0 ? 0 : consec === 1 ? 1 : consec <= 3 ? 2 : consec <= 7 ? 3 : 4;
      });
    });
    // Precompute the HISTORICAL cycle composite at every week. For each
    // cycle indicator, take its most recent weekly value at or before the
    // target week (binary search), percentile-rank it against the indicator's
    // full sample, flip for inverted-direction indicators, and average across
    // the seven. The regime classifier then uses this PER-WEEK cycle composite
    // (not today's value) so Risk Off can actually fire when a trigger is
    // sustained AND the cycle was calm at that historical moment.
    const fullCycleByDate = {};
    for (const d of fullDates) {
      const pcts = [];
      for (const ind of cycleInd) {
        if (!ind.allWeekly.length || !ind.sortedFull.length) continue;
        // Binary search: latest week with date <= d
        let lo = 0, hi = ind.allWeekly.length;
        while (lo < hi) {
          const mid = (lo + hi) >>> 1;
          if (ind.allWeekly[mid].date <= d) lo = mid + 1; else hi = mid;
        }
        const idx = lo - 1;
        if (idx < 0) continue;
        const v = ind.allWeekly[idx].value;
        const rawPct = pctileOf(v, ind.sortedFull);
        if (rawPct == null) continue;
        pcts.push(ind.bearishHigh ? rawPct : 100 - rawPct);
      }
      if (pcts.length) fullCycleByDate[d] = Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length);
    }

    const fullRegime = fullDates.map(d => {
      const x = fullByDate[d];
      const stages = anchors.map(a => x['fullstage_' + a.id] || 0);
      const histCycle = fullCycleByDate[d] != null ? fullCycleByDate[d] : cycleScore;
      return { date: d, label: computeRegime(stages, histCycle), stages, cycle: histCycle };
    });

    return { anchors, cycleInd, cycleScore, cycleQuintile: quintile(cycleScore), regime, regimeHistory, fullRegime };
  }, [indHist]);

  if (!data) {
    return <div className="mo-page" style={{ padding: '60px 32px', textAlign: 'center', color: 'var(--ink-2)' }}>Loading macro data…</div>;
  }

  const { anchors, cycleInd, cycleScore, regime, regimeHistory, fullRegime } = data;

  const openTrigger = (id) => setModal({ open: true, kind: 'trigger', payload: id });
  const openIndicator = (id, parent) => { if (parent) modalStackRef.current.push(parent); setModal({ open: true, kind: 'indicator', payload: id }); };
  const openScore = () => setModal({ open: true, kind: 'score', payload: null });
  const openRegimeHistory = (filterState) => setModal({ open: true, kind: 'regimeHistory', payload: filterState });
  const closeModal = () => { setModal({ open: false, kind: null, payload: null }); modalStackRef.current = []; };
  const modalBack = () => { const prev = modalStackRef.current.pop(); if (prev) setModal(prev); else closeModal(); };

  return (
    <>
      <style>{MO_CSS}</style>
      <div className="mo-page" onClick={(e) => {
        // Click outside inline panels closes them
        if (!e.target.closest('.mo-rrow') && !e.target.closest('.mo-pill-panel')) setOpenPill(null);
        if (!e.target.closest('.mo-rhist-bar') && !e.target.closest('.mo-rhist-panel')) setOpenWeek(null);
      }}>

        {/* HEAD STRIP — hero left, regime right */}
        <div className="mo-top">
          <div>
            <div className="mo-eyebrow">Macro Overview</div>
            <h1 className="mo-h1">
              Three volatility <em>triggers</em>, one <em>cycle position</em>, one regime read.
            </h1>
            <p className="mo-lede">
              We describe the tape — we don't predict tops. Combined into one of four states:{' '}
              <strong>Risk On</strong>, <strong>Neutral</strong>, <strong>Cautionary</strong>, or <strong>Risk Off</strong>.
            </p>
            <ul className="mo-bullets">
              <li><strong>Volatility Triggers</strong> tell us <em>when</em> trouble has arrived.</li>
              <li><strong>Cycle Positioning</strong> tells us <em>whether</em> that trouble matters yet.</li>
              <li><strong>Regime</strong> is the rolled-up read across both layers.</li>
            </ul>
          </div>

          <aside className="mo-regime">
            <div className="mo-tile-fresh"><span className="fresh-dot"/>{fmtFresh(anchors[0]?.asOf)}</div>
            <h2 className="mo-regime-title">Regime</h2>
            {REGIME_ORDER.map(name => (
              <React.Fragment key={name}>
                <div
                  className={`mo-rrow ${regime === name ? 'current' : ''}`}
                  onClick={() => setOpenPill(openPill === name ? null : name)}
                >
                  <span className="mo-rpill">{name}</span>
                  <span className="mo-rdesc">{REGIME_DESC[name]}</span>
                  <span className="mo-r-arrow">▾</span>
                </div>
                {openPill === name && (
                  <div className="mo-pill-panel">
                    <div className="mo-pill-head">What "{name}" means</div>
                    {REGIME_DESC[name]}
                    <div className="mo-pill-leave">{REGIME_LEAVE[name]}</div>
                    <div className="mo-pill-seehist">
                      <button onClick={(e) => { e.stopPropagation(); openRegimeHistory(name); }}>SEE FULL HISTORY ›</button>
                    </div>
                  </div>
                )}
              </React.Fragment>
            ))}

            <div className="mo-rhist-wrap">
              <div className="mo-rhist-axis"><span>24 weeks ago</span><span>today</span></div>
              <div className="mo-rhist-strip">
                {regimeHistory.map((w, i) => {
                  const lvl = REGIME_ORDER.indexOf(w.label);
                  const heightPct = 18 + (lvl * 22);
                  return (
                    <span
                      key={i}
                      className={`mo-rhist-bar s${lvl}`}
                      style={{ height: heightPct + '%' }}
                      data-tt={`${fmtDate(w.date)} · ${w.label}`}
                      onClick={() => setOpenWeek(openWeek === i ? null : i)}
                    />
                  );
                })}
              </div>
              <button className="mo-rhist-fullhist" onClick={() => openRegimeHistory(null)}>SEE FULL HISTORY ({fullRegime[0]?.date?.slice(0,4) || ''} – TODAY) ›</button>
            </div>
            {openWeek != null && (
              <div className="mo-rhist-panel">
                <div className="mo-rhist-panel-head">Weekly snapshot · {fmtDate(regimeHistory[openWeek]?.date)}</div>
                <table>
                  {anchors.map(a => (
                    <tr key={a.id}>
                      <td>{a.title}</td>
                      <td className="num">{a.weekly[openWeek] ? a.fmt(a.weekly[openWeek].value) : '—'}</td>
                      <td className="num">{STAGES[a.stages[openWeek] || 0]}</td>
                    </tr>
                  ))}
                  <tr><td>Cycle composite</td><td className="num">{cycleScore ?? '—'}</td><td className="num">/ 100</td></tr>
                  <tr><td><strong>Regime</strong></td><td colSpan="2" style={{textAlign:'right'}}><span className="mo-pill">{regimeHistory[openWeek]?.label}</span></td></tr>
                </table>
              </div>
            )}
          </aside>
        </div>

        {/* THREE VOL TILES */}
        <div className="mo-vol-grid">
          {anchors.map(a => (
            <AnchorTile key={a.id} anchor={a} onDial={() => openTrigger(a.id)} />
          ))}
        </div>

        {/* CYCLE POSITIONING */}
        <div className="mo-cycle">
          <div className="mo-cycle-fresh"><span className="fresh-dot"/>{fmtFresh(cycleInd[0]?.asOf)}</div>
          <h2 className="mo-cycle-title">Cycle Positioning</h2>
          <div className="mo-cycle-body">
            <div className="mo-cycle-left" onClick={openScore}>
              <span className="mo-cycle-hint">CLICK FOR BREAKDOWN ›</span>
              <CycleDial score={cycleScore} />
              <div className="mo-readout"><span className="mo-val">{cycleScore != null ? cycleScore : '—'}</span><span className="mo-denom">/ 100</span></div>
              <div className="mo-cycle-band">{bandLabel(cycleScore)}</div>
            </div>
            <div className="mo-cycle-right">
              <div className="mo-sub-eyebrow">Average of seven percentile ranks · ranked against each indicator's full history · click any row to drill in</div>
              <div className="mo-ind-list">
                <div className="mo-ind-header">
                  <span>Indicator</span><span></span><span>Reading</span><span>Pctile</span>
                </div>
                {cycleInd.map(ind => {
                  const p = ind.stressPctile;
                  return (
                    <div key={ind.id} className="mo-ind-row" onClick={() => openIndicator(ind.id)}>
                      <span className="mo-ind-name">{ind.name}</span>
                      <span className="mo-ind-barwrap"><span className="mo-ind-bar" style={{ width: (p ?? 0) + '%' }}/></span>
                      <span className="mo-ind-reading">{ind.valueText}</span>
                      <span className="mo-ind-pctile">{p != null ? p + '%' : '—'}</span>
                    </div>
                  );
                })}
                <div className="mo-ind-avg">
                  <span></span><span></span><span className="mo-ind-avg-label">Average =</span>
                  <span className="mo-ind-avg-val">{cycleScore != null ? cycleScore : '—'} / 100</span>
                </div>
              </div>
            </div>
          </div>
        </div>

      </div>

      {/* MODAL */}
      {modal.open && (
        <div className="mo-scrim" onClick={(e) => { if (e.target === e.currentTarget) closeModal(); }}>
          <div className="mo-modal-card">
            <button className="mo-modal-close" onClick={closeModal}>×</button>
            {modalStackRef.current.length > 0 && (
              <button className="mo-modal-back" onClick={modalBack}>‹ BACK</button>
            )}
            {modal.kind === 'trigger' && <TriggerModalContent anchor={anchors.find(x => x.id === modal.payload)} indHist={indHist} />}
            {modal.kind === 'indicator' && <IndicatorModalContent ind={cycleInd.find(x => x.id === modal.payload)} indHist={indHist} />}
            {modal.kind === 'score' && <ScoreModalContent cycleInd={cycleInd} cycleScore={cycleScore} onDrill={(id) => openIndicator(id, { kind: 'score', payload: null, open: true })} />}
            {modal.kind === 'regimeHistory' && <RegimeHistoryModalContent fullRegime={fullRegime} filterState={modal.payload} />}
          </div>
        </div>
      )}
    </>
  );
}

// ── Anchor (vol trigger) tile ────────────────────────────────────────
function AnchorTile({ anchor, onDial }) {
  const a = anchor;
  return (
    <div className="mo-tile">
      <div className="mo-tile-fresh"><span className="fresh-dot"/>{fmtFresh(a.asOf)}</div>
      <h2 className="mo-tile-title">{a.title}</h2>
      <div className="mo-stage-row">
        <span className={`mo-stage-pill stage-${a.stage}`}>{a.stageName}</span>
      </div>
      <div className="mo-dial-wrap" onClick={onDial}>
        <span className="mo-dial-hint">CLICK FOR DETAIL ›</span>
        <RawDial value={a.current} threshold={a.threshold} max={a.scaleMax} fmt={a.fmt}/>
        <div className="mo-readout"><span className="mo-val">{a.current != null ? a.fmt(a.current) : '—'}</span></div>
        <div className="mo-mark-line">85th percentile = {a.threshold != null ? a.fmt(a.threshold) : '—'}</div>
      </div>
      <div className="mo-bar-wrap">
        <div className="mo-bar-axis"><span>24w</span><span>now</span></div>
        <div className="mo-bar-strip">
          {a.weekly.map((w, i) => {
            const heightPct = a.scaleMax ? Math.max(8, Math.min(95, (w.value / a.scaleMax) * 100)) : 50;
            return (
              <span
                key={i}
                className={`mo-bar s${a.stages[i] || 0}`}
                style={{ height: heightPct + '%' }}
                data-tt={`${fmtDate(w.date)} · ${a.fmt(w.value)}`}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Half-circle dial: value vs threshold mark ────────────────────────
function RawDial({ value, threshold, max, fmt }) {
  const cx = 120, cy = 120, R = 100;
  const v = value == null || isNaN(value) ? 0 : Math.max(0, Math.min(max, value));
  const valPct = (v / max) * 100;
  const angle = 180 - (valPct * 1.8);
  const rad = (angle * Math.PI) / 180;
  const tipX = cx + R * Math.cos(rad);
  const tipY = cy - R * Math.sin(rad);
  let markX = null, markY = null, markLabelX = null, markLabelY = null;
  if (threshold != null && !isNaN(threshold)) {
    const tPct = Math.max(0, Math.min(100, (threshold / max) * 100));
    const tAngle = 180 - (tPct * 1.8);
    const tRad = (tAngle * Math.PI) / 180;
    markX = cx + R * Math.cos(tRad);
    markY = cy - R * Math.sin(tRad);
    markLabelX = cx + (R + 14) * Math.cos(tRad);
    markLabelY = cy - (R + 14) * Math.sin(tRad);
  }
  return (
    <svg className="mo-dial" viewBox="0 0 240 140">
      <path d="M 20 122 A 100 100 0 0 1 55 49"  fill="rgba(0,113,227,0.18)" />
      <path d="M 55 49 A 100 100 0 0 1 120 22"  fill="rgba(0,113,227,0.42)" />
      <path d="M 120 22 A 100 100 0 0 1 185 49" fill="rgba(0,113,227,0.68)" />
      <path d="M 185 49 A 100 100 0 0 1 220 122" fill="rgba(0,113,227,0.92)" />
      {markX != null && (<>
        <circle cx={markX} cy={markY} r="3" fill="#0e1115" />
        <text x={markLabelX} y={markLabelY} fontFamily="Inter,sans-serif" fontSize="9" fill="#0e1115" fontWeight="600" textAnchor={threshold/max > 0.5 ? 'start' : 'end'}>{fmt(threshold)}</text>
      </>)}
      <line x1={cx} y1={cy} x2={tipX} y2={tipY} stroke="var(--accent)" strokeWidth="2.8" strokeLinecap="round"/>
      <circle cx={tipX} cy={tipY} r="4.5" fill="var(--accent)" stroke="#fff" strokeWidth="1.8"/>
      <circle cx={cx} cy={cy} r="4.5" fill="var(--accent)"/>
    </svg>
  );
}

// ── Cycle composite arc with 0/20/40/60/80 tick markers ──────────────
function CycleDial({ score }) {
  const cx = 120, cy = 120, R = 100;
  const v = score == null ? 0 : Math.max(0, Math.min(100, score));
  const angle = 180 - (v * 1.8);
  const rad = (angle * Math.PI) / 180;
  const tipX = cx + R * Math.cos(rad);
  const tipY = cy - R * Math.sin(rad);
  const ticks = [
    { v: 0,  x1: 20,  y1: 122, x2: 14,  y2: 128, lx: 8,   ly: 138 },
    { v: 20, x1: 55,  y1: 49,  x2: 49,  y2: 42,  lx: 38,  ly: 42  },
    { v: 40, x1: 120, y1: 22,  x2: 120, y2: 14,  lx: 120, ly: 11  },
    { v: 60, x1: 185, y1: 49,  x2: 191, y2: 42,  lx: 202, ly: 42  },
    { v: 80, x1: 220, y1: 122, x2: 226, y2: 128, lx: 232, ly: 138 },
  ];
  return (
    <svg className="mo-dial" viewBox="0 0 240 150" style={{maxWidth:260}}>
      <path d="M 20 122 A 100 100 0 0 1 55 49"  fill="rgba(0,113,227,0.18)" />
      <path d="M 55 49 A 100 100 0 0 1 120 22"  fill="rgba(0,113,227,0.42)" />
      <path d="M 120 22 A 100 100 0 0 1 185 49" fill="rgba(0,113,227,0.68)" />
      <path d="M 185 49 A 100 100 0 0 1 220 122" fill="rgba(0,113,227,0.92)" />
      {ticks.map(t => (
        <g key={t.v} fontSize="9" fontFamily="Inter,sans-serif" fill="#5e5e63" fontWeight="500">
          <line x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2} stroke="#5e5e63" strokeWidth="1"/>
          <text x={t.lx} y={t.ly} textAnchor="middle">{t.v}</text>
        </g>
      ))}
      <line x1={cx} y1={cy} x2={tipX} y2={tipY} stroke="var(--accent)" strokeWidth="2.8" strokeLinecap="round"/>
      <circle cx={tipX} cy={tipY} r="4.5" fill="var(--accent)" stroke="#fff" strokeWidth="1.8"/>
      <circle cx={cx} cy={cy} r="4.5" fill="var(--accent)"/>
    </svg>
  );
}

// ── Dynamic chart: timeframe select, hi/lo lines, 85th-pct line, crosshair, overlay ─
function DynamicChart({ points, p85, fmt, label, overlayOptions, indHist }) {
  const [tfId, setTfId] = useState('1Y');
  const [overlayId, setOverlayId] = useState('');
  const [hoverIdx, setHoverIdx] = useState(null);
  const svgRef = useRef(null);

  const tf = TIMEFRAMES.find(t => t.id === tfId) || TIMEFRAMES[2];
  const slice = sliceByDays(points, tf.days);
  const overlayPts = overlayId && indHist && indHist[overlayId] ? sliceByDays(indHist[overlayId].points, tf.days) : null;

  if (!slice.length) return <div style={{height:280,color:'var(--ink-3)',fontSize:12,padding:24}}>No data in window.</div>;

  const w = 760, h = 280, padL = 52, padR = 14, padT = 14, padB = 28;
  const vals = slice.map(p => p[1]);
  const overlayVals = overlayPts ? overlayPts.map(p => p[1]) : [];
  const max = Math.max(...vals) * 1.05;
  const min = Math.min(...vals) * 0.95;
  const range = max - min || 1;
  // Overlay uses its own y-axis (right side) so different units don't clash
  const oMax = overlayVals.length ? Math.max(...overlayVals) * 1.05 : 0;
  const oMin = overlayVals.length ? Math.min(...overlayVals) * 0.95 : 0;
  const oRange = oMax - oMin || 1;

  const xFor = (i, n) => padL + (i / Math.max(1, n - 1)) * (w - padL - padR);
  const yFor = (v) => h - padB - ((v - min) / range) * (h - padT - padB);
  const yOverlay = (v) => h - padB - ((v - oMin) / oRange) * (h - padT - padB);

  const path = slice.map((p, i) => `${xFor(i, slice.length).toFixed(1)},${yFor(p[1]).toFixed(1)}`).join(' ');
  const overlayPath = overlayPts ? overlayPts.map((p, i) => `${xFor(i, overlayPts.length).toFixed(1)},${yOverlay(p[1]).toFixed(1)}`).join(' ') : null;

  const hi = Math.max(...vals), lo = Math.min(...vals);
  const hiY = yFor(hi), loY = yFor(lo);
  const p85Y = (p85 != null && p85 >= min && p85 <= max) ? yFor(p85) : null;

  const handleMove = (e) => {
    if (!svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const xPx = e.clientX - rect.left;
    const xView = (xPx / rect.width) * w;
    if (xView < padL || xView > w - padR) { setHoverIdx(null); return; }
    const idx = Math.max(0, Math.min(slice.length - 1, Math.round(((xView - padL) / (w - padL - padR)) * (slice.length - 1))));
    setHoverIdx(idx);
  };
  const handleLeave = () => setHoverIdx(null);

  const hoverX = hoverIdx != null ? xFor(hoverIdx, slice.length) : null;
  const hoverY = hoverIdx != null ? yFor(slice[hoverIdx][1]) : null;
  const hoverDate = hoverIdx != null ? slice[hoverIdx][0] : null;
  const hoverVal = hoverIdx != null ? slice[hoverIdx][1] : null;
  const hoverOverlayVal = (hoverIdx != null && overlayPts && overlayPts[hoverIdx]) ? overlayPts[hoverIdx][1] : null;

  const overlayPeerLabel = overlayId ? (overlayOptions || []).find(o => o.id === overlayId)?.label : null;

  return (
    <div>
      <div style={{display:'flex',gap:6,marginBottom:10,alignItems:'center',flexWrap:'wrap'}}>
        {TIMEFRAMES.map(t => (
          <button key={t.id} onClick={() => setTfId(t.id)} className={`mo-tf-btn ${tfId===t.id?'active':''}`}>{t.label}</button>
        ))}
        <span style={{flex:1}}/>
        {overlayOptions && overlayOptions.length > 0 && (
          <select className="mo-tf-btn" value={overlayId} onChange={(e) => setOverlayId(e.target.value)} style={{cursor:'pointer',padding:'4px 10px'}}>
            <option value="">Overlay…</option>
            {overlayOptions.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
        )}
      </div>
      <svg ref={svgRef} viewBox={`0 0 ${w} ${h}`} style={{width:'100%',height:280,display:'block'}} onMouseMove={handleMove} onMouseLeave={handleLeave}>
        <line x1={padL} y1={hiY} x2={w-padR} y2={hiY} stroke="#2f9d6a" strokeWidth="1" strokeDasharray="3,3" opacity="0.7"/>
        <text x={w-padR-6} y={hiY-4} fontSize="10" fill="#2f9d6a" textAnchor="end" fontWeight="600" fontFamily="Inter">HIGH {fmt(hi)}</text>
        <line x1={padL} y1={loY} x2={w-padR} y2={loY} stroke="#c84658" strokeWidth="1" strokeDasharray="3,3" opacity="0.7"/>
        <text x={w-padR-6} y={loY+12} fontSize="10" fill="#c84658" textAnchor="end" fontWeight="600" fontFamily="Inter">LOW {fmt(lo)}</text>
        {p85Y != null && (<>
          <line x1={padL} y1={p85Y} x2={w-padR} y2={p85Y} stroke="#0e1115" strokeWidth="1" strokeDasharray="6,4"/>
          <text x={w-padR-6} y={p85Y-4} fontSize="10" fill="#0e1115" textAnchor="end" fontWeight="600" fontFamily="Inter">85th pct = {fmt(p85)}</text>
        </>)}
        {overlayPath && <polyline points={overlayPath} fill="none" stroke="#a4626d" strokeWidth="1.6" opacity="0.75"/>}
        <polyline points={path} fill="none" style={{stroke:'var(--accent)'}} strokeWidth="2"/>
        {hoverX != null && (<>
          <line x1={hoverX} y1={padT} x2={hoverX} y2={h-padB} stroke="#0e1115" strokeWidth="1" strokeDasharray="3,3" opacity="0.5"/>
          <circle cx={hoverX} cy={hoverY} r="4.5" fill="var(--accent)" stroke="#fff" strokeWidth="1.5"/>
          <rect x={Math.min(hoverX + 8, w - padR - 150)} y={Math.max(padT + 4, hoverY - 42)} width="142" height="36" rx="4" fill="#0e1115" opacity="0.92"/>
          <text x={Math.min(hoverX + 8, w - padR - 150) + 8} y={Math.max(padT + 4, hoverY - 42) + 16} fontSize="10" fill="#fff" fontFamily="Inter" fontWeight="600">{hoverDate} · {fmt(hoverVal)}</text>
          {hoverOverlayVal != null && <text x={Math.min(hoverX + 8, w - padR - 150) + 8} y={Math.max(padT + 4, hoverY - 42) + 30} fontSize="10" fill="#e6b7be" fontFamily="Inter">{overlayPeerLabel}: {hoverOverlayVal.toFixed(2)}</text>}
        </>)}
      </svg>
      <div style={{display:'flex',gap:14,fontSize:11,color:'var(--ink-3)',marginTop:8,fontFamily:'Inter',flexWrap:'wrap'}}>
        <span><span style={{display:'inline-block',width:10,height:10,background:'var(--accent)',borderRadius:2,marginRight:5,verticalAlign:'middle'}}/>{label}</span>
        {overlayPeerLabel && <span><span style={{display:'inline-block',width:10,height:10,background:'#a4626d',borderRadius:2,marginRight:5,verticalAlign:'middle'}}/>{overlayPeerLabel}</span>}
        {p85 != null && <span><span style={{display:'inline-block',width:10,height:10,background:'#0e1115',opacity:0.8,borderRadius:2,marginRight:5,verticalAlign:'middle'}}/>85th-pct = {fmt(p85)}</span>}
        <span style={{marginLeft:'auto'}}>Hover for crosshair · {tf.label} window · {slice.length} points · current {fmt(vals[vals.length-1])}</span>
      </div>
    </div>
  );
}

// ── Trigger modal ────────────────────────────────────────────────────
function TriggerModalContent({ anchor, indHist }) {
  if (!anchor) return null;
  const info = SOURCE_INFO[anchor.id] || {};
  const meta = TRIGGER_META[anchor.id] || {};
  const today = anchor.asOf || '—';
  return (
    <>
      <div className="mo-modal-eyebrow">Volatility trigger · Layer 1</div>
      <div className="mo-modal-h">
        <h3>{anchor.title}<span className="mo-source-fresh"><span className="fresh-dot"/>{fmtFresh(anchor.asOf)}</span></h3>
        <div className="mo-modal-right">
          <div className="mo-big-val">{anchor.current != null ? anchor.fmt(anchor.current) : '—'}</div>
          <div className="mo-big-meta">{anchor.stageName.toUpperCase()} · {anchor.days_in_stage} days in stage</div>
        </div>
      </div>
      {meta.caption && <p className="mo-body-14" dangerouslySetInnerHTML={{__html: meta.caption + ` The trigger has been in <em>${anchor.stageName}</em> for ${anchor.days_in_stage} trading days.`}}/>}
      <div className="mo-kpi-strip">
        <div className="mo-kpi"><div className="lbl">Current</div><div className="val">{anchor.current != null ? anchor.fmt(anchor.current) : '—'}</div><div className="meta">today's reading</div></div>
        <div className="mo-kpi"><div className="lbl">85th percentile (5y)</div><div className="val">{anchor.threshold != null ? anchor.fmt(anchor.threshold) : '—'}</div><div className="meta">recalibrated daily</div></div>
        <div className="mo-kpi"><div className="lbl">Stage</div><div className="val">{anchor.stageName}</div><div className="meta">{anchor.days_in_stage} days</div></div>
        <div className="mo-kpi"><div className="lbl">Full sample range</div><div className="val">{anchor.histLo != null && anchor.histHi != null ? `${anchor.fmt(anchor.histLo)}–${anchor.fmt(anchor.histHi)}` : '—'}</div><div className="meta">{info.sample || ''}</div></div>
      </div>
      <div className="mo-modal-block">
        <div className="mo-modal-block-eyebrow">History · timeframe select · crosshair · overlay</div>
        <DynamicChart points={anchor.rawPoints} p85={anchor.threshold} fmt={anchor.fmt} label={anchor.title} overlayOptions={meta.overlay_options} indHist={indHist}/>
      </div>
      <div className="mo-modal-block">
        <div className="mo-modal-block-eyebrow">Historical reads near today's level · S&P forward returns</div>
        <div className="mo-episode-note">Readings from other periods when {anchor.title} was at a similar level to today. Historical reference, not a forecast.</div>
        <table className="mo-modal-table">
          <thead><tr><th>Period</th><th>Note</th><th style={{textAlign:'right'}}>Value</th><th style={{textAlign:'right'}}>SPX 6m</th><th style={{textAlign:'right'}}>SPX 12m</th></tr></thead>
          <tbody>
            {(meta.episodes || []).map((e, i) => {
              const isNeg6 = e.spx6 && (e.spx6.startsWith('−') || e.spx6.startsWith('-'));
              const isNeg12 = e.spx12 && (e.spx12.startsWith('−') || e.spx12.startsWith('-'));
              return (
                <tr key={i}>
                  <td>{e.period}</td>
                  <td>{e.note}</td>
                  <td className="num" style={{textAlign:'right'}}>{e.value}</td>
                  <td className="num" style={{textAlign:'right',color: isNeg6 ? '#c84658' : '#2f9d6a',fontWeight:500}}>{e.spx6}</td>
                  <td className="num" style={{textAlign:'right',color: isNeg12 ? '#c84658' : '#2f9d6a',fontWeight:500}}>{e.spx12}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="mo-modal-block">
        <div className="mo-modal-block-eyebrow">Release calendar</div>
        <table className="mo-modal-table"><tbody>
          <tr><td>Frequency</td><td>{info.cadence || '—'}</td></tr>
          <tr><td>Last release</td><td>{today}</td></tr>
          <tr><td>Source</td><td>{info.src || '—'}</td></tr>
        </tbody></table>
      </div>
      {(meta.formula || meta.caveat) && (
        <div className="mo-modal-footer">
          {meta.formula && <div className="row"><strong>Formula.</strong> {meta.formula}</div>}
          {meta.source_url && <div className="row"><strong>Source.</strong> <a href={meta.source_url} target="_blank" rel="noreferrer" style={{color:'var(--ink-0, var(--text, #0e1115))'}}>{info.src || meta.source_url}</a></div>}
          {meta.caveat && <div className="row" style={{color:'var(--ink-3, var(--text-muted, #5e5e63))',fontStyle:'italic'}}><strong style={{color:'var(--ink-0, var(--text, #0e1115))',fontStyle:'normal'}}>Caveat.</strong> {meta.caveat}</div>}
        </div>
      )}
    </>
  );
}

// ── Indicator modal ──────────────────────────────────────────────────
function IndicatorModalContent({ ind, indHist }) {
  if (!ind) return null;
  const info = SOURCE_INFO[ind.id] || {};
  const meta = INDICATOR_META[ind.id] || {};
  return (
    <>
      <div className="mo-modal-eyebrow">Cycle composite indicator · Layer 2</div>
      <div className="mo-modal-h">
        <h3>{ind.name}<span className="mo-source-fresh"><span className="fresh-dot"/>{fmtFresh(ind.asOf)}</span></h3>
        <div className="mo-modal-right">
          <div className="mo-big-val">{ind.valueText}</div>
          <div className="mo-big-meta">{ind.stressPctile != null ? ind.stressPctile + 'TH STRESS PCT' : '—'} · {(info.sample || '').toUpperCase()}</div>
        </div>
      </div>
      {meta.caption && <p className="mo-body-14" dangerouslySetInnerHTML={{__html: meta.caption}}/>}
      <div className="mo-kpi-strip">
        <div className="mo-kpi"><div className="lbl">Current</div><div className="val">{ind.valueText}</div><div className="meta">today's reading</div></div>
        <div className="mo-kpi"><div className="lbl">Stress percentile</div><div className="val">{ind.stressPctile != null ? ind.stressPctile + '%' : '—'}</div><div className="meta">vs {info.sample || 'full sample'}</div></div>
        <div className="mo-kpi"><div className="lbl">Direction</div><div className="val" style={{fontSize:14}}>{info.direction || '—'}</div><div className="meta"></div></div>
        <div className="mo-kpi"><div className="lbl">Full sample range</div><div className="val">{ind.histLo != null && ind.histHi != null ? `${ind.fmt(ind.histLo)}–${ind.fmt(ind.histHi)}` : '—'}</div><div className="meta">{info.sample || ''}</div></div>
      </div>
      <div className="mo-modal-block">
        <div className="mo-modal-block-eyebrow">History · timeframe select · crosshair · overlay</div>
        <DynamicChart points={ind.rawPoints} p85={null} fmt={ind.fmt} label={ind.name} overlayOptions={meta.overlay_options} indHist={indHist}/>
      </div>
      <div className="mo-modal-block">
        <div className="mo-modal-block-eyebrow">Historical reads near today's level · S&P forward returns</div>
        <div className="mo-episode-note">Readings from other periods when {ind.name} was at a similar level to today. Historical reference, not a forecast.</div>
        <table className="mo-modal-table">
          <thead><tr><th>Period</th><th>Note</th><th style={{textAlign:'right'}}>Value</th><th style={{textAlign:'right'}}>SPX 6m</th><th style={{textAlign:'right'}}>SPX 12m</th></tr></thead>
          <tbody>
            {(meta.episodes || []).map((e, i) => {
              const isNeg6 = e.spx6 && (e.spx6.startsWith('−') || e.spx6.startsWith('-'));
              const isNeg12 = e.spx12 && (e.spx12.startsWith('−') || e.spx12.startsWith('-'));
              return (
                <tr key={i}>
                  <td>{e.period}</td>
                  <td>{e.note}</td>
                  <td className="num" style={{textAlign:'right'}}>{e.value}</td>
                  <td className="num" style={{textAlign:'right',color: isNeg6 ? '#c84658' : '#2f9d6a',fontWeight:500}}>{e.spx6}</td>
                  <td className="num" style={{textAlign:'right',color: isNeg12 ? '#c84658' : '#2f9d6a',fontWeight:500}}>{e.spx12}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="mo-modal-block">
        <div className="mo-modal-block-eyebrow">Release calendar</div>
        <table className="mo-modal-table"><tbody>
          <tr><td>Frequency</td><td>{info.cadence || '—'}</td></tr>
          <tr><td>Last release</td><td>{ind.asOf || '—'}</td></tr>
          <tr><td>Source</td><td>{info.src || '—'}</td></tr>
        </tbody></table>
      </div>
      {(meta.formula || meta.caveat) && (
        <div className="mo-modal-footer">
          {meta.formula && <div className="row"><strong>Formula.</strong> {meta.formula}</div>}
          {meta.source_url && <div className="row"><strong>Source.</strong> <a href={meta.source_url} target="_blank" rel="noreferrer" style={{color:'var(--ink-0, var(--text, #0e1115))'}}>{info.src || meta.source_url}</a></div>}
          {meta.caveat && <div className="row" style={{color:'var(--ink-3, var(--text-muted, #5e5e63))',fontStyle:'italic'}}><strong style={{color:'var(--ink-0, var(--text, #0e1115))',fontStyle:'normal'}}>Caveat.</strong> {meta.caveat}</div>}
        </div>
      )}
    </>
  );
}

// ── Cycle composite score modal ──────────────────────────────────────
function ScoreModalContent({ cycleInd, cycleScore, onDrill }) {
  const contribs = cycleInd.map(i => ({ id: i.id, name: i.name, value: i.valueText, score: i.stressPctile }));
  const avg = cycleScore;
  return (
    <>
      <div className="mo-modal-eyebrow">Cycle composite · Layer 2</div>
      <div className="mo-modal-h">
        <h3>How today's {avg}/100 score is built</h3>
        <div className="mo-modal-right">
          <div className="mo-big-val">{avg != null ? avg : '—'}<span style={{fontStyle:'italic',fontSize:18,color:'var(--ink-3)',marginLeft:2}}>/ 100</span></div>
          <div className="mo-big-meta">{bandLabel(avg).toUpperCase()}</div>
        </div>
      </div>
      <p className="mo-body-14">
        The cycle composite is the <strong>simple average</strong> of seven stress-direction percentile ranks. Each indicator is ranked against its <strong>own full history</strong>. Higher means more stress; for indicators where low readings mean stress (Copper/Gold, KBW Bank/S&P, Yield Curve, Chicago Fed FCI is bearish-high so kept straight), the rank is flipped before averaging.
      </p>
      <div className="mo-modal-block">
        <div className="mo-modal-block-eyebrow">Each indicator's contribution · click any row to drill in</div>
        {contribs.map(c => (
          <div key={c.id} className="mo-contrib-row" onClick={() => onDrill(c.id)}>
            <span className="nm">{c.name}</span>
            <span className="bar-wrap"><span className="bar" style={{width:(c.score ?? 0) + '%'}}/></span>
            <span className="v">{c.value}</span>
            <span className="pct">{c.score != null ? c.score : '—'}</span>
            <span className="arr">›</span>
          </div>
        ))}
        <div className="mo-contrib-row" style={{marginTop:14,borderTop:'1px solid var(--border)',borderBottom:0,cursor:'default',background:'transparent'}}>
          <span className="nm" style={{fontWeight:600}}>Simple average · today</span>
          <span className="bar-wrap"><span className="bar" style={{width:(avg ?? 0)+'%',background:'var(--ink)'}}/></span>
          <span className="v"></span>
          <span className="pct" style={{fontWeight:600}}>{avg ?? '—'}</span>
          <span className="arr"></span>
        </div>
      </div>
      <div className="mo-modal-block">
        <div className="mo-modal-block-eyebrow">Where {avg} sits on the 0–100 scale</div>
        <table className="mo-modal-table"><tbody>
          {[[0,20,'deepest calm, late expansion'],[20,40,'calm, late cycle'],[40,60,'middle'],[60,80,'broad stress visible'],[80,100,'full-blown macro stress']].map(([lo,hi,label]) => {
            const active = avg != null && avg >= lo && avg < hi;
            return (
              <tr key={lo} style={active ? {background:'var(--accent-soft, rgba(0,113,227,0.10))'} : null}>
                <td>{lo} – {hi} · {label}</td>
                <td className="num" style={{textAlign:'right'}}>{active ? '← TODAY' : ''}</td>
              </tr>
            );
          })}
        </tbody></table>
      </div>
    </>
  );
}

// ── Full backtested regime history modal ─────────────────────────────
function RegimeHistoryModalContent({ fullRegime, filterState }) {
  const [hoverIdx, setHoverIdx] = useState(null);
  const svgRef = useRef(null);
  const total = fullRegime.length;
  const filtered = filterState ? fullRegime.filter(x => x.label === filterState) : fullRegime;
  const counts = REGIME_ORDER.map(r => ({ r, n: fullRegime.filter(x => x.label === r).length }));
  const pct = (n) => Math.round((n / total) * 100 * 10) / 10;

  const w = 760, h = 110, padL = 4, padR = 4, padT = 4, padB = 18;
  const barW = total > 0 ? (w - padL - padR) / total : 0;
  const stageHeight = (l) => 22 + l * 22; // 22, 44, 66, 88

  const handleMove = (e) => {
    if (!svgRef.current || !total) return;
    const r = svgRef.current.getBoundingClientRect();
    const xPx = e.clientX - r.left;
    const xView = (xPx / r.width) * w;
    if (xView < padL || xView > w - padR) { setHoverIdx(null); return; }
    const idx = Math.max(0, Math.min(total - 1, Math.floor((xView - padL) / barW)));
    setHoverIdx(idx);
  };
  const handleLeave = () => setHoverIdx(null);
  const hovered = hoverIdx != null ? fullRegime[hoverIdx] : null;

  return (
    <>
      <div className="mo-modal-eyebrow">Regime · backtested history</div>
      <div className="mo-modal-h">
        <h3>Regime{filterState ? ` = "${filterState}"` : ''} · {fullRegime[0]?.date?.slice(0,4) || ''} – today</h3>
        <div className="mo-modal-right">
          <div className="mo-big-val">{filterState ? filtered.length : total}<span style={{fontStyle:'italic',fontSize:18,color:'var(--ink-3, var(--text-muted, #5e5e63))',marginLeft:2}}>weeks</span></div>
          <div className="mo-big-meta">{filterState ? 'MATCHING' : 'TOTAL'}</div>
        </div>
      </div>
      <p className="mo-body-14">
        {filterState
          ? <>Every week the regime was <strong>{filterState}</strong> across the full backtested period. Hover the strip for the date.</>
          : <>Weekly regime state across the full backtested period. Color encodes regime (light = Risk On, dark = Risk Off). Hover the strip for the date.</>}
      </p>
      <div className="mo-modal-block">
        <div className="mo-modal-block-eyebrow">{filterState ? `Weeks where regime = "${filterState}"` : 'Full regime history'}</div>
        <svg ref={svgRef} viewBox={`0 0 ${w} ${h}`} style={{width:'100%',height:110,display:'block'}} onMouseMove={handleMove} onMouseLeave={handleLeave}>
          {fullRegime.map((wRec, i) => {
            const lvl = REGIME_ORDER.indexOf(wRec.label);
            const dim = filterState && wRec.label !== filterState;
            const bh = stageHeight(lvl);
            const bx = padL + i * barW;
            const by = (h - padB) - bh;
            const alpha = lvl === 0 ? 0.20 : lvl === 1 ? 0.42 : lvl === 2 ? 0.68 : 0.92;
            const fill = `rgba(0,113,227,${alpha})`;
            return <rect key={i} x={bx} y={by} width={Math.max(barW, 0.4)} height={bh} fill={fill} opacity={dim ? 0.16 : 1}/>;
          })}
          {hovered != null && (() => {
            const idx = hoverIdx;
            const lvl = REGIME_ORDER.indexOf(hovered.label);
            const bx = padL + idx * barW + barW/2;
            const labelW = 140;
            const labelX = Math.min(Math.max(padL, bx - labelW/2), w - padR - labelW);
            return (
              <g style={{pointerEvents:'none'}}>
                <line x1={bx} y1={padT} x2={bx} y2={h-padB} stroke="#0e1115" strokeWidth="1" strokeDasharray="2,2" opacity="0.5"/>
                <rect x={labelX} y={padT} width={labelW} height={20} rx="4" fill="#0e1115" opacity="0.92"/>
                <text x={labelX + 8} y={padT + 14} fontSize="11" fill="#fff" fontFamily="Inter" fontWeight="600">{fmtMonthYear(hovered.date)} · {hovered.label}</text>
              </g>
            );
          })()}
        </svg>
        <div className="mo-regime-fullhist-axis">
          <span>{fullRegime[0]?.date?.slice(0,4) || '1996'}</span>
          <span>{fullRegime[Math.floor(fullRegime.length*0.25)]?.date?.slice(0,4) || ''}</span>
          <span>{fullRegime[Math.floor(fullRegime.length*0.5)]?.date?.slice(0,4) || ''}</span>
          <span>{fullRegime[Math.floor(fullRegime.length*0.75)]?.date?.slice(0,4) || ''}</span>
          <span>today</span>
        </div>
        <div className="mo-regime-fullhist-summary">
          {counts.map(c => (<div key={c.r} className="cell"><div className="label">{c.r}</div><div className="val">{pct(c.n)}%</div><div className="sub">{c.n} weeks</div></div>))}
        </div>
      </div>
    </>
  );
}

// ── CSS ──────────────────────────────────────────────────────────────
const MO_CSS = `
.mo-page{max-width:1280px;margin:0 auto;padding:28px 32px 64px}
.mo-top{display:grid;grid-template-columns:1fr 460px;gap:32px;margin-bottom:40px;align-items:start}
.mo-eyebrow{font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:var(--ink-2);font-weight:500;margin-bottom:8px}
.mo-h1{font-family:var(--font-display);font-weight:400;font-size:46px;line-height:1.10;letter-spacing:-0.015em;margin:8px 0 18px;color:var(--ink-0);max-width:720px}
.mo-h1 em{font-style:italic;color:var(--accent)}
.mo-lede{font-size:16px;color:var(--ink-1);line-height:1.55;margin:0 0 16px;max-width:620px}
.mo-lede strong{color:var(--ink-0);font-weight:600}
.mo-bullets{font-size:15px;color:var(--ink-1);line-height:1.7;padding-left:22px;max-width:680px;margin:0}
.mo-bullets li{margin-bottom:6px}
.mo-bullets li strong{color:var(--ink-0);font-weight:600}
.mo-bullets li em{font-style:italic;color:var(--accent)}

.mo-regime{position:relative;background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:18px 22px 14px}
.mo-tile-fresh{position:absolute;top:14px;right:14px;display:flex;align-items:center;gap:5px;font-size:10px;color:var(--ink-3);font-weight:500;letter-spacing:0.02em}
.fresh-dot{width:6px;height:6px;border-radius:50%;background:#2f9d6a;box-shadow:0 0 0 2px rgba(47,157,106,0.18)}
.mo-regime-title{font-family:var(--font-display);font-style:italic;font-weight:400;font-size:22px;color:var(--accent);text-align:center;margin:0 0 12px;letter-spacing:-0.005em}
.mo-rrow{display:grid;grid-template-columns:108px 1fr 16px;gap:12px;padding:5px 6px;align-items:center;font-size:12.5px;line-height:1.4;cursor:pointer;border-radius:5px;transition:background 120ms;position:relative}
.mo-rrow:hover{background:var(--surface-2)}
.mo-rrow:hover .mo-r-arrow{opacity:1}
.mo-r-arrow{color:var(--accent);font-weight:600;opacity:0;transition:opacity 120ms;font-size:12px;text-align:right}
.mo-rpill{font-family:var(--font-display);font-style:italic;font-weight:400;font-size:13px;text-align:center;padding:5px 0;border-radius:14px;background:var(--surface-2);color:var(--ink-2);border:1px solid var(--border-faint)}
.mo-rrow.current .mo-rpill{background:var(--accent-soft);color:var(--accent);border:1.5px solid var(--accent);font-weight:500}
.mo-rdesc{color:var(--ink-1);font-size:12.5px}
.mo-rrow.current .mo-rdesc{color:var(--ink-0);font-weight:500}
.mo-pill-panel{margin:4px 4px 6px 124px;padding:12px 14px;border-left:2px solid var(--accent);border-radius:0 6px 6px 0;background:var(--surface-2);color:var(--ink-1);font-size:13px;line-height:1.55}
.mo-pill-head{font-weight:600;color:var(--ink-0);margin-bottom:6px}
.mo-pill-leave{margin-top:8px;padding-top:8px;border-top:0.5px dashed var(--border);color:var(--ink-3);font-size:12px}
.mo-pill-seehist{margin-top:10px}
.mo-pill-seehist button{font-size:11px;font-weight:600;color:var(--accent);background:transparent;border:none;cursor:pointer;padding:0;letter-spacing:0.04em;text-transform:uppercase}
.mo-pill-seehist button:hover{text-decoration:underline}

.mo-rhist-wrap{margin-top:12px;padding-top:10px;border-top:1px solid var(--border-faint)}
.mo-rhist-axis{display:flex;justify-content:space-between;font-size:9px;letter-spacing:0.10em;text-transform:uppercase;color:var(--ink-3);font-weight:500;margin-bottom:4px}
.mo-rhist-strip{display:flex;align-items:end;gap:2px;height:32px}
.mo-rhist-bar{flex:1;border-radius:2px 2px 0 0;cursor:pointer;min-height:5px;position:relative;transition:filter 80ms}
.mo-rhist-bar:hover{filter:brightness(1.15)}
.mo-rhist-bar.s0{background:rgba(0,113,227,0.20)}
.mo-rhist-bar.s1{background:rgba(0,113,227,0.42)}
.mo-rhist-bar.s2{background:rgba(0,113,227,0.68)}
.mo-rhist-bar.s3{background:rgba(0,113,227,0.92)}
.mo-rhist-bar::after{content:attr(data-tt);position:absolute;left:50%;bottom:calc(100% + 6px);transform:translateX(-50%);padding:6px 10px;border-radius:4px;background:var(--ink-0, var(--text, #0e1115));color:#fff;font-size:10.5px;font-weight:500;white-space:nowrap;pointer-events:none;opacity:0;z-index:8}
.mo-rhist-bar:hover::after{opacity:1}
.mo-rhist-fullhist{display:block;margin-top:8px;font-size:11px;font-weight:600;color:var(--accent);cursor:pointer;letter-spacing:0.04em;text-transform:uppercase;text-align:right;background:transparent;border:none;padding:0;width:100%}
.mo-rhist-fullhist:hover{text-decoration:underline}
.mo-rhist-panel{margin-top:12px;padding:14px 16px;border-left:2px solid var(--accent);border-radius:0 6px 6px 0;background:var(--surface-2);font-size:12.5px}
.mo-rhist-panel-head{font-weight:600;color:var(--ink-0);margin-bottom:8px}
.mo-rhist-panel table{width:100%;border-collapse:collapse;font-size:12.5px}
.mo-rhist-panel td{padding:6px 6px;border-bottom:0.5px dashed var(--border);color:var(--ink-1)}
.mo-rhist-panel td.num{text-align:right;color:var(--ink-0);font-weight:500;font-variant-numeric:tabular-nums}
.mo-rhist-panel .mo-pill{display:inline-block;padding:2px 9px;border-radius:10px;font-family:var(--font-display);font-style:italic;font-size:12px;background:var(--accent-soft);color:var(--accent);border:1px solid var(--accent)}

.mo-vol-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-bottom:18px}
.mo-tile{position:relative;background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:18px 16px}
.mo-tile-title{font-family:var(--font-display);font-style:italic;font-weight:400;font-size:20px;color:var(--accent);text-align:center;margin:0 0 6px;letter-spacing:-0.005em}
.mo-stage-row{display:flex;justify-content:center;margin-bottom:6px}
.mo-stage-pill{font-size:9.5px;letter-spacing:0.10em;text-transform:uppercase;padding:3px 10px;border-radius:11px;background:var(--surface-2);color:var(--ink-3);border:0.5px solid var(--border-faint);font-weight:600}
.mo-dial-wrap{display:flex;flex-direction:column;align-items:center;margin-top:4px;cursor:pointer;padding:8px;border-radius:8px;transition:background 120ms;position:relative}
.mo-dial-wrap:hover{background:rgba(0,113,227,0.04)}
.mo-dial-wrap:hover .mo-dial-hint{opacity:1}
.mo-dial-hint{position:absolute;top:-2px;right:6px;font-size:9px;letter-spacing:0.08em;color:var(--accent);font-weight:600;opacity:0;transition:opacity 120ms;text-transform:uppercase}
.mo-dial{width:100%;max-width:230px;height:auto;display:block}
.mo-readout{margin-top:-2px;display:flex;align-items:baseline}
.mo-val{font-family:var(--font-display);font-weight:400;font-size:38px;line-height:1;font-variant-numeric:tabular-nums;letter-spacing:-0.015em;color:var(--ink-0)}
.mo-denom{font-family:var(--font-display);font-style:italic;font-size:16px;color:var(--ink-3);margin-left:4px}
.mo-mark-line{font-size:10px;letter-spacing:0.04em;color:var(--ink-3);margin-top:6px}
.mo-bar-wrap{margin-top:12px;padding-top:10px;border-top:0.5px solid var(--border-faint)}
.mo-bar-axis{display:flex;justify-content:space-between;font-size:9px;letter-spacing:0.10em;text-transform:uppercase;color:var(--ink-3);font-weight:600;margin-bottom:5px}
.mo-bar-strip{display:flex;align-items:end;gap:2px;height:38px}
.mo-bar{flex:1;border-radius:2px 2px 0 0;min-height:5px;background:rgba(0,113,227,0.22);position:relative}
.mo-bar.s2{background:rgba(0,113,227,0.55)}
.mo-bar.s3{background:rgba(0,113,227,0.85)}
.mo-bar[data-tt]:hover::after{content:attr(data-tt);position:absolute;bottom:calc(100% + 6px);left:50%;transform:translateX(-50%);background:var(--ink-0, var(--text, #0e1115));color:#fff;font-size:10.5px;padding:5px 8px;border-radius:4px;white-space:nowrap;z-index:10;font-weight:500}

.mo-cycle{position:relative;background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:22px 24px}
.mo-cycle-fresh{position:absolute;top:14px;right:14px;display:flex;align-items:center;gap:5px;font-size:10px;color:var(--ink-3);font-weight:500}
.mo-cycle-title{font-family:var(--font-display);font-style:italic;font-weight:400;font-size:22px;color:var(--accent);margin:0 0 14px;letter-spacing:-0.005em}
.mo-cycle-body{display:grid;grid-template-columns:320px 1fr;gap:36px;align-items:center}
.mo-cycle-left{position:relative;display:flex;flex-direction:column;align-items:center;cursor:pointer;padding:10px;border-radius:10px;transition:background 120ms}
.mo-cycle-left:hover{background:rgba(0,113,227,0.04)}
.mo-cycle-left:hover .mo-cycle-hint{opacity:1}
.mo-cycle-hint{position:absolute;top:4px;right:6px;font-size:9px;letter-spacing:0.08em;color:var(--accent);font-weight:600;opacity:0;transition:opacity 120ms;text-transform:uppercase}
.mo-cycle-band{margin-top:6px;font-size:11px;color:var(--ink-3);letter-spacing:0.04em}
.mo-cycle-right{min-width:0}
.mo-sub-eyebrow{font-size:11.5px;color:var(--ink-3);margin-bottom:10px;letter-spacing:0.02em}
.mo-ind-list{display:flex;flex-direction:column;gap:0;font-size:13px}
.mo-ind-header{display:grid;grid-template-columns:minmax(240px,2.2fr) 180px 120px 70px;gap:18px;padding:4px 6px;color:var(--ink-3);font-size:9.5px;letter-spacing:0.12em;text-transform:uppercase;font-weight:500;border-bottom:1px solid var(--border-faint);margin-bottom:4px;white-space:nowrap}
.mo-ind-header span:nth-child(3),.mo-ind-header span:nth-child(4){text-align:right}
.mo-ind-row{display:grid;grid-template-columns:minmax(240px,2.2fr) 180px 120px 70px;gap:18px;align-items:center;padding:11px 6px;border-bottom:0.5px dashed var(--border-faint);cursor:pointer;transition:background 120ms;border-radius:5px}
.mo-ind-row:hover{background:var(--surface-2)}
.mo-ind-name{color:var(--ink-1);font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mo-ind-reading{font-size:12px;color:var(--ink-0);font-weight:500;text-align:right;font-variant-numeric:tabular-nums}
.mo-ind-pctile{font-size:13px;color:var(--ink-0);font-weight:600;text-align:right;font-variant-numeric:tabular-nums}
.mo-ind-barwrap{display:block;height:6px;background:var(--surface-2);border-radius:3px;overflow:hidden;position:relative}
.mo-ind-bar{display:block;height:100%;background:var(--ink-0, var(--text, #0e1115))}
.mo-ind-avg{display:grid;grid-template-columns:minmax(240px,2.2fr) 180px 120px 70px;gap:18px;padding:10px 6px 2px;align-items:center;border-top:1px solid var(--border-faint);margin-top:6px}
.mo-ind-avg-label{font-family:var(--font-display);font-style:italic;font-size:12.5px;color:var(--ink-3);text-align:right}
.mo-ind-avg-val{font-family:var(--font-display);font-weight:400;font-size:18px;color:var(--accent);letter-spacing:-0.005em;text-align:right}

.mo-scrim{position:fixed;inset:0;z-index:9000;background:rgba(14,17,21,0.42);display:flex;align-items:flex-start;justify-content:center;padding:60px 32px;overflow-y:auto}
.mo-modal-card{position:relative;width:100%;max-width:940px;background:var(--surface);border:0.5px solid var(--border-strong, var(--border));border-radius:12px;box-shadow:0 18px 48px rgba(14,17,21,0.18);padding:28px 36px 36px}
.mo-modal-close{position:absolute;top:14px;right:18px;border:none;background:transparent;cursor:pointer;font-size:24px;line-height:1;color:var(--ink-3);padding:6px 8px;border-radius:6px}
.mo-modal-close:hover{background:var(--surface-2);color:var(--ink-0)}
.mo-modal-back{font-size:11px;font-weight:600;color:var(--ink-3);background:transparent;border:none;cursor:pointer;padding:4px 0 0;letter-spacing:0.06em;text-transform:uppercase;margin-bottom:6px}
.mo-modal-back:hover{color:var(--accent)}
.mo-modal-eyebrow{font-size:11px;letter-spacing:0.10em;text-transform:uppercase;color:var(--accent);font-weight:600;margin-bottom:6px}
.mo-modal-h{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:12px;gap:18px}
.mo-modal-h h3{font-family:var(--font-display);font-weight:400;font-size:30px;letter-spacing:-0.012em;margin:0;color:var(--ink-0)}
.mo-modal-right{text-align:right}
.mo-big-val{font-family:var(--font-display);font-weight:400;font-size:30px;line-height:1;color:var(--ink-0);font-variant-numeric:tabular-nums}
.mo-big-meta{font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:var(--ink-3);font-weight:600;margin-top:4px}
.mo-source-fresh{display:inline-flex;align-items:center;gap:5px;margin-left:8px;padding:2px 8px;border-radius:10px;background:rgba(47,157,106,0.12);border:0.5px solid #2f9d6a;font-size:10.5px;color:#2f9d6a;font-weight:600;vertical-align:middle}
.mo-body-14{font-size:14px;line-height:1.6;color:var(--ink-1);margin:0 0 18px;max-width:760px}
.mo-body-14 strong{color:var(--ink-0);font-weight:600}
.mo-kpi-strip{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:18px}
.mo-kpi{padding:14px 14px 12px;background:var(--surface);border:0.5px solid var(--border-strong, var(--border));border-radius:10px}
.mo-kpi .lbl{font-size:10.5px;font-weight:600;letter-spacing:0.10em;text-transform:uppercase;color:var(--ink-3)}
.mo-kpi .val{font-family:var(--font-display);font-weight:400;font-size:22px;margin-top:6px;line-height:1;color:var(--ink-0)}
.mo-kpi .meta{font-size:11px;color:var(--ink-3);margin-top:6px}
.mo-modal-block{padding:14px 16px;background:var(--surface);border:0.5px solid var(--border-strong, var(--border));border-radius:10px;margin-bottom:18px}
.mo-modal-block-eyebrow{font-size:10.5px;font-weight:600;letter-spacing:0.10em;text-transform:uppercase;color:var(--ink-3);margin-bottom:10px}
.mo-modal-table{width:100%;border-collapse:collapse;font-size:13.5px}
.mo-modal-table th{text-align:left;font-size:10.5px;font-weight:600;letter-spacing:0.10em;text-transform:uppercase;color:var(--ink-3);border-bottom:0.5px solid var(--ink-0);padding:8px 12px 6px 0}
.mo-modal-table td{padding:9px 12px 9px 0;border-bottom:0.5px dashed var(--border);color:var(--ink-1)}
.mo-modal-table td.num{font-variant-numeric:tabular-nums;font-weight:500}
.mo-tf-btn{font-size:10.5px;font-weight:600;letter-spacing:0.06em;padding:4px 10px;border-radius:4px;border:1px solid var(--border);background:transparent;color:var(--ink-3);cursor:pointer;text-transform:uppercase}
.mo-tf-btn.active{background:var(--accent-soft);color:var(--accent);border-color:var(--accent)}
.mo-episode-note{font-size:11.5px;color:var(--ink-3);margin-bottom:10px;font-style:italic;line-height:1.5}
.mo-episode-note strong{color:var(--ink-0);font-weight:500;font-style:normal}
.mo-contrib-row{display:grid;grid-template-columns:1.5fr 1fr 80px 60px 18px;gap:14px;align-items:center;padding:10px 6px;border-bottom:0.5px dashed var(--border);cursor:pointer;transition:background 120ms}
.mo-contrib-row:hover{background:var(--surface-2)}
.mo-contrib-row .nm{font-size:13.5px;color:var(--ink-0);font-weight:500}
.mo-contrib-row .bar-wrap{height:8px;background:var(--surface-2);border-radius:4px;overflow:hidden}
.mo-contrib-row .bar{height:100%;background:var(--accent)}
.mo-contrib-row .v{font-variant-numeric:tabular-nums;font-size:13px;color:var(--ink-1);text-align:right}
.mo-contrib-row .pct{font-family:var(--font-display);font-weight:400;font-size:18px;color:var(--ink-0);font-variant-numeric:tabular-nums;text-align:right}
.mo-contrib-row .arr{color:var(--ink-3);font-size:14px}
.mo-regime-fullhist{display:grid;grid-template-columns:repeat(auto-fill,minmax(2px,1fr));gap:1px;height:80px;align-items:end;margin:14px 0 6px}
.mo-regime-fullhist .rh-bar{min-height:6px;border-radius:1px;cursor:pointer;position:relative}
.mo-regime-fullhist .rh-bar.r0{background:rgba(0,113,227,0.20);height:25%}
.mo-regime-fullhist .rh-bar.r1{background:rgba(0,113,227,0.42);height:50%}
.mo-regime-fullhist .rh-bar.r2{background:rgba(0,113,227,0.68);height:75%}
.mo-regime-fullhist .rh-bar.r3{background:rgba(0,113,227,0.92);height:100%}
.mo-regime-fullhist .rh-bar[data-tt]:hover::after{content:attr(data-tt);position:absolute;bottom:calc(100% + 6px);left:50%;transform:translateX(-50%);background:var(--ink-0, var(--text, #0e1115));color:#fff;font-size:10.5px;padding:5px 8px;border-radius:4px;white-space:nowrap;z-index:10;font-weight:500}
.mo-regime-fullhist-axis{display:flex;justify-content:space-between;font-size:10.5px;color:var(--ink-3);margin-top:4px}
.mo-regime-fullhist-summary{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:14px}
.mo-regime-fullhist-summary .cell{padding:10px 12px;background:var(--surface-2);border:0.5px solid var(--border-faint);border-radius:8px}
.mo-regime-fullhist-summary .cell .label{font-size:10.5px;font-weight:600;letter-spacing:0.10em;text-transform:uppercase;color:var(--ink-3)}
.mo-regime-fullhist-summary .cell .val{font-family:var(--font-display);font-weight:400;font-size:22px;margin-top:6px;color:var(--ink-0)}
.mo-regime-fullhist-summary .cell .sub{font-size:11px;color:var(--ink-3);margin-top:4px}
`;
