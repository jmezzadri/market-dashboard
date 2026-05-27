/* CCAR engine — ported from src/pages/ScenarioAnalysis.jsx (2026-05-27).

   The legacy Scenario Analysis page is ~2,957 lines and the engine logic is
   intertwined with JSX. This module lifts the engine's pure constants and
   pure functions into a clean, reusable surface so the overhaul Scenarios
   page (and any future surface) can consume them without coupling to the
   legacy component.

   Senior Quant sign-off: 2026-05-27. The math is verbatim from the legacy
   file (FACTORS, FACTOR_BASELINES, FACTOR_HISTORY_KEYS, SCENARIOS,
   SECTORS_RAW, CORR_PAIRS, STRAT_REGIME_MAP, STRAT_RETURNS_MAP,
   STRAT_SLEEVES, propagateRealistic, sectorShocks, custom-regime /
   custom-yieldDir / custom-returns derivations). No re-calibration; the
   port is a refactor, not a model change. Backtested numbers remain in
   public/macrotilt_engine_backtest.json drawdowns.

   What is INTENTIONALLY left in the legacy file
   ─────────────────────────────────────────────
   - PORTFOLIO mock data (no longer used; portfolio P&L now reads from the
     user's actual positions).
   - Inline JSX styles. The overhaul page binds to the prototype's .sn-*
     class set in proto-pages.css; no inline style props.
   - The coherence() badge UX. Useful for diagnosis but the overhaul puts
     the sigma → nominal translation in the slider itself instead.

   Public API
   ──────────
   Constants:
     FACTORS                   — 12 factor descriptors (id, name, min, max, step)
     FACTOR_IDS                — array of factor ids in canonical order
     FACTOR_BASELINES          — per-factor { mean, std, fmt } for nominal display
     FACTOR_HISTORY_KEYS       — factor id → indicator_history.json key
     SCENARIOS                 — 8 canned scenarios w/ 12-factor sigma vectors
     STRAT_REGIME_MAP          — canned scenario → { severity, yieldDir }
     STRAT_RETURNS_MAP         — canned scenario → { spy, engine } (depth %)
     STRAT_SLEEVES             — yield dir → { cash, gld, tlt, shy } weights
     SECTORS                   — 17 sectors w/ per-factor loadings
     SECTOR_BY_NAME            — sector lookup by name
   Functions:
     fmtSigma(v)               — format z-score with sign
     fmtNominal(factorId, σ)   — translate sigma into nominal value string
     getCorr(a, b)             — cross-factor correlation
     getCurrentReadings(hist)  — translate today's indicator_history → sigma
     propagateRealistic(driver, driverZ)  — correlated propagation from a driver
     sectorReturns(shocks, h)  — per-sector expected return % for horizon h
     customRegime(shocks)      — derive regime severity from MOVE sigma
     customYieldDir(shocks)    — derive yield direction from real-rates sigma
     customReturns(shocks, h)  — { spy, engine } depth from custom factor shocks
*/

// ════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ════════════════════════════════════════════════════════════════════════

export const FACTORS = [
  { id: 'vix',          name: 'VIX',            min: -3, max: 5, step: 0.1 },
  { id: 'move',         name: 'MOVE',           min: -3, max: 5, step: 0.1 },
  { id: 'real_rates',   name: 'Real rates',     min: -3, max: 5, step: 0.1 },
  { id: 'term_premium', name: 'Term premium',   min: -3, max: 5, step: 0.1 },
  { id: 'dxy',          name: 'DXY (USD)',      min: -3, max: 5, step: 0.1 },
  { id: 'copper_gold',  name: 'Copper / gold',  min: -3, max: 5, step: 0.1 },
  { id: 'hy',           name: 'HY OAS',         min: -3, max: 5, step: 0.1 },
  { id: 'stlfsi',       name: 'STLFSI',         min: -3, max: 5, step: 0.1 },
  { id: 'anfci',        name: 'ANFCI',          min: -3, max: 5, step: 0.1 },
  { id: 'aaii',         name: 'AAII bull-bear', min: -3, max: 5, step: 0.1 },
  { id: 'putcall',      name: 'Put/call',       min: -3, max: 5, step: 0.1 },
  { id: 'breadth',      name: 'Breadth',        min: -5, max: 3, step: 0.1 },
];
export const FACTOR_IDS = FACTORS.map((f) => f.id);

// Bug #1106 calibration (legacy). Mean / std measured 2006-01 to 2026-03 on the 8
// factors carried in indicator_history.json; textbook baselines for the 4 that
// aren't (hy, aaii, putcall, breadth). Used to translate "+2σ on VIX" → "VIX 32".
export const FACTOR_BASELINES = {
  vix:          { mean: 19.6,   std: 8.1,   fmt: (v) => v.toFixed(1) },
  move:         { mean: 85.2,   std: 31.7,  fmt: (v) => v.toFixed(0) },
  real_rates:   { mean: 0.83,   std: 1.0,   fmt: (v) => v.toFixed(2) + '%' },
  term_premium: { mean: 29.2,   std: 39.5,  fmt: (v) => v.toFixed(0) + 'bps' },
  dxy:          { mean: 106.2,  std: 12.4,  fmt: (v) => v.toFixed(1) },
  copper_gold:  { mean: 0.247,  std: 0.098, fmt: (v) => v.toFixed(3) },
  hy:           { mean: 400,    std: 150,   fmt: (v) => v.toFixed(0) + 'bps' },
  stlfsi:       { mean: 0.0,    std: 1.18,  fmt: (v) => v.toFixed(2) },
  anfci:        { mean: -0.24,  std: 0.75,  fmt: (v) => v.toFixed(2) },
  aaii:         { mean: 6,      std: 12,    fmt: (v) => (v >= 0 ? '+' : '') + v.toFixed(0) },
  putcall:      { mean: 0.95,   std: 0.20,  fmt: (v) => v.toFixed(2) },
  breadth:      { mean: 55,     std: 25,    fmt: (v) => v.toFixed(0) + '%' },
};

export const FACTOR_HISTORY_KEYS = {
  vix: 'vix',
  move: 'move',
  real_rates: 'real_rates',
  term_premium: 'term_premium',
  dxy: 'usd',
  copper_gold: 'copper_gold',
  hy: 'hy_ig',
  stlfsi: 'stlfsi',
  anfci: 'anfci',
  aaii: null,
  putcall: null,
  breadth: null,
};

// Correlation matrix (12×12, symmetric, upper-triangle stored).
const CORR_PAIRS = {
  'vix|move': 0.65, 'vix|real_rates': -0.30, 'vix|term_premium': 0.10, 'vix|dxy': 0.15,
  'vix|copper_gold': -0.45, 'vix|hy': 0.75, 'vix|stlfsi': 0.80, 'vix|anfci': 0.60,
  'vix|aaii': -0.55, 'vix|putcall': 0.70, 'vix|breadth': -0.65,
  'move|real_rates': 0.20, 'move|term_premium': -0.30, 'move|dxy': 0.25,
  'move|copper_gold': -0.30, 'move|hy': 0.55, 'move|stlfsi': 0.65, 'move|anfci': 0.50,
  'move|aaii': -0.30, 'move|putcall': 0.45, 'move|breadth': -0.40,
  'real_rates|term_premium': 0.10, 'real_rates|dxy': 0.40, 'real_rates|copper_gold': 0.25,
  'real_rates|hy': -0.20, 'real_rates|stlfsi': 0.10, 'real_rates|anfci': 0.20,
  'real_rates|aaii': 0.10, 'real_rates|putcall': -0.15, 'real_rates|breadth': 0.10,
  'term_premium|dxy': -0.20, 'term_premium|copper_gold': 0.10, 'term_premium|hy': 0.05,
  'term_premium|stlfsi': 0.15, 'term_premium|anfci': 0.20, 'term_premium|aaii': -0.05,
  'term_premium|putcall': 0.10, 'term_premium|breadth': -0.05,
  'dxy|copper_gold': -0.40, 'dxy|hy': 0.10, 'dxy|stlfsi': 0.20, 'dxy|anfci': 0.15,
  'dxy|aaii': -0.10, 'dxy|putcall': 0.10, 'dxy|breadth': -0.15,
  'copper_gold|hy': -0.50, 'copper_gold|stlfsi': -0.50, 'copper_gold|anfci': -0.40,
  'copper_gold|aaii': 0.40, 'copper_gold|putcall': -0.40, 'copper_gold|breadth': 0.50,
  'hy|stlfsi': 0.85, 'hy|anfci': 0.75, 'hy|aaii': -0.50, 'hy|putcall': 0.55, 'hy|breadth': -0.55,
  'stlfsi|anfci': 0.80, 'stlfsi|aaii': -0.55, 'stlfsi|putcall': 0.60, 'stlfsi|breadth': -0.60,
  'anfci|aaii': -0.45, 'anfci|putcall': 0.45, 'anfci|breadth': -0.50,
  'aaii|putcall': -0.45, 'aaii|breadth': 0.55,
  'putcall|breadth': -0.50,
};

export function getCorr(a, b) {
  if (a === b) return 1.0;
  return CORR_PAIRS[a + '|' + b] ?? CORR_PAIRS[b + '|' + a] ?? 0;
}

// 8 canned scenarios — factor sigma vectors. Maps stress_stress_key in
// public/scenario_definitions.json → these factor moves.
export const SCENARIOS = {
  black_monday_1987:        { factors: { vix: +5.0, move: +3.5, real_rates: +1.5, term_premium: -0.5, dxy: -0.5, copper_gold: -1.0, hy: +2.0, stlfsi: +2.5, anfci: +2.0, aaii: -3.0, putcall: +3.5, breadth: -4.0 } },
  dotcom_slow_2000:         { factors: { vix: +1.5, move: +1.0, real_rates: +0.5, term_premium: -0.5, dxy: +0.8, copper_gold: -1.2, hy: +1.8, stlfsi: +1.5, anfci: +1.2, aaii: -2.0, putcall: +1.8, breadth: -2.5 } },
  dotcom_capitulation_2002: { factors: { vix: +2.8, move: +1.8, real_rates: -0.5, term_premium: +0.3, dxy: -0.5, copper_gold: -1.5, hy: +2.5, stlfsi: +1.8, anfci: +1.5, aaii: -2.5, putcall: +2.5, breadth: -3.2 } },
  gfc_2008:                 { factors: { vix: +4.0, move: +3.2, real_rates: -1.5, term_premium: +0.5, dxy: +0.5, copper_gold: -2.0, hy: +3.5, stlfsi: +3.5, anfci: +2.8, aaii: -2.3, putcall: +2.5, breadth: -3.5 } },
  q4_2018:                  { factors: { vix: +2.2, move: +1.5, real_rates: +1.3, term_premium: -0.8, dxy: +0.8, copper_gold: -0.7, hy: +1.5, stlfsi: +1.2, anfci: +0.7, aaii: -1.3, putcall: +1.4, breadth: -1.8 } },
  covid_2020:               { factors: { vix: +3.8, move: +3.5, real_rates: -1.0, term_premium: +0.3, dxy: +1.5, copper_gold: -1.8, hy: +2.8, stlfsi: +2.5, anfci: +1.8, aaii: -1.5, putcall: +2.2, breadth: -3.0 } },
  inflation_2022:           { factors: { vix: +1.5, move: +2.5, real_rates: +3.2, term_premium: -1.5, dxy: +2.5, copper_gold: -0.5, hy: +1.2, stlfsi: +1.0, anfci: +0.5, aaii: -1.8, putcall: +1.5, breadth: -2.0 } },
  ai_2024:                  { factors: { vix: +1.8, move: +1.0, real_rates: -0.5, term_premium: +0.3, dxy: -0.3, copper_gold: -0.4, hy: +0.5, stlfsi: +0.3, anfci: +0.2, aaii: -0.8, putcall: +1.1, breadth: -2.5 } },
};

// Strategy regime + return tables (legacy STRAT_REGIME_MAP / STRAT_RETURNS_MAP /
// STRAT_SLEEVES). Used for canned-scenario allocation rows.
export const STRAT_REGIME_MAP = {
  black_monday_1987:        { severity: 'Risk Off', yieldDir: 'Inflationary' },
  dotcom_slow_2000:         { severity: 'Risk Off', yieldDir: 'Neutral' },
  dotcom_capitulation_2002: { severity: 'Risk Off', yieldDir: 'Deflationary' },
  gfc_2008:                 { severity: 'Risk Off', yieldDir: 'Deflationary' },
  q4_2018:                  { severity: 'Watch',    yieldDir: 'Inflationary' },
  covid_2020:               { severity: 'Risk Off', yieldDir: 'Deflationary' },
  inflation_2022:           { severity: 'Risk Off', yieldDir: 'Inflationary' },
  ai_2024:                  { severity: 'Watch',    yieldDir: 'Neutral' },
};
export const STRAT_RETURNS_MAP = {
  black_monday_1987:        { spy: -32.7, engine: -31.7 },
  dotcom_slow_2000:         { spy: -45.7, engine: -34.9 },
  dotcom_capitulation_2002: { spy: -27.0, engine: -22.0 },
  gfc_2008:                 { spy: -54.6, engine: -31.6 },
  q4_2018:                  { spy: -17.1, engine: -17.1 },
  covid_2020:               { spy: -31.8, engine: -22.3 },
  inflation_2022:           { spy: -23.9, engine: -14.9 },
  ai_2024:                  { spy: -8.5,  engine: -8.0  },
};
export const STRAT_SLEEVES = {
  Inflationary: { cash: 0.50, gld: 0.30, tlt: 0.00, shy: 0.20 },
  Deflationary: { cash: 0.25, gld: 0.25, tlt: 0.50, shy: 0.00 },
  Neutral:      { cash: 0.40, gld: 0.25, tlt: 0.25, shy: 0.10 },
};

// Sectors w/ per-factor loadings (lifted verbatim from legacy SECTORS_RAW).
// 11 GICS equity sectors + 4 defensive proxies + 3 synthetic sleeves.
const SECTORS_RAW = [
  { id: 'XLK', name: 'Technology',            assetClass: 'Equity', beta: 1.15, current: 18, loadings: { vix: +0.85, move: +0.40, real_rates: +0.85, term_premium: -0.30, dxy: +0.45, copper_gold: +0.20, hy: +0.55, stlfsi: +0.65, anfci: +0.50, aaii: -0.40, putcall: +0.50, breadth: -0.70 } },
  { id: 'XLC', name: 'Communication Services', assetClass: 'Equity', beta: 1.05, current: 12, loadings: { vix: +0.80, move: +0.35, real_rates: +0.70, term_premium: -0.25, dxy: +0.30, copper_gold: +0.15, hy: +0.50, stlfsi: +0.60, anfci: +0.45, aaii: -0.30, putcall: +0.45, breadth: -0.65 } },
  { id: 'XLF', name: 'Financials',            assetClass: 'Equity', beta: 1.25, current: 13, loadings: { vix: +0.75, move: +0.45, real_rates: -0.30, term_premium: +0.55, dxy: -0.10, copper_gold: -0.20, hy: +0.85, stlfsi: +0.85, anfci: +0.65, aaii: -0.40, putcall: +0.55, breadth: -0.65 } },
  { id: 'XLY', name: 'Discretionary',         assetClass: 'Equity', beta: 1.20, current: 7,  loadings: { vix: +0.75, move: +0.40, real_rates: +0.45, term_premium: -0.10, dxy: +0.20, copper_gold: +0.10, hy: +0.65, stlfsi: +0.70, anfci: +0.55, aaii: -0.40, putcall: +0.50, breadth: -0.60 } },
  { id: 'XLI', name: 'Industrials',           assetClass: 'Equity', beta: 1.10, current: 6,  loadings: { vix: +0.70, move: +0.35, real_rates: +0.10, term_premium: +0.05, dxy: +0.30, copper_gold: -0.30, hy: +0.55, stlfsi: +0.60, anfci: +0.45, aaii: -0.35, putcall: +0.40, breadth: -0.55 } },
  { id: 'XLB', name: 'Materials',             assetClass: 'Equity', beta: 1.10, current: 3,  loadings: { vix: +0.65, move: +0.30, real_rates: -0.10, term_premium: +0.05, dxy: +0.50, copper_gold: -0.85, hy: +0.50, stlfsi: +0.55, anfci: +0.40, aaii: -0.30, putcall: +0.35, breadth: -0.50 } },
  // Hotfix #1108 — Energy is an INFLATION HEDGE. real_rates / term_premium loadings negative
  // so Energy benefits when rates rise during inflation regimes (matches 2022 actuals where
  // XLE was the only positive sector). Validated directionally across all 8 historical scenarios.
  { id: 'XLE', name: 'Energy',                assetClass: 'Equity', beta: 1.30, current: 4,  loadings: { vix: +0.30, move: +0.10, real_rates: -1.20, term_premium: -0.50, dxy: -0.10, copper_gold: -0.50, hy: +0.20, stlfsi: +0.20, anfci: +0.10, aaii: -0.20, putcall: +0.20, breadth: -0.30 } },
  { id: 'XLV', name: 'Healthcare',            assetClass: 'Equity', beta: 0.85, current: 11, loadings: { vix: +0.45, move: +0.25, real_rates: +0.15, term_premium: -0.05, dxy: +0.10, copper_gold: -0.05, hy: +0.35, stlfsi: +0.40, anfci: +0.30, aaii: -0.25, putcall: +0.30, breadth: -0.35 } },
  { id: 'XLP', name: 'Staples',               assetClass: 'Equity', beta: 0.65, current: 5,  loadings: { vix: +0.30, move: +0.15, real_rates: +0.10, term_premium: -0.05, dxy: +0.15, copper_gold: -0.05, hy: +0.25, stlfsi: +0.30, anfci: +0.20, aaii: -0.15, putcall: +0.20, breadth: -0.30 } },
  { id: 'XLU', name: 'Utilities',             assetClass: 'Equity', beta: 0.55, current: 2,  loadings: { vix: +0.30, move: +0.20, real_rates: +0.55, term_premium: -0.10, dxy: +0.05, copper_gold: -0.05, hy: +0.30, stlfsi: +0.35, anfci: +0.25, aaii: -0.15, putcall: +0.20, breadth: -0.30 } },
  { id: 'XLRE', name: 'Real Estate',          assetClass: 'Equity', beta: 1.05, current: 2,  loadings: { vix: +0.75, move: +0.50, real_rates: +1.10, term_premium: -0.40, dxy: +0.10, copper_gold: -0.10, hy: +0.70, stlfsi: +0.75, anfci: +0.60, aaii: -0.35, putcall: +0.45, breadth: -0.55 } },
  { id: 'BIL', name: 'T-Bills (1-3mo)',       assetClass: 'Defensive', beta: 0.05, current: 0, loadings: { vix: -0.05, move: -0.05, real_rates: +0.20, term_premium: 0,    dxy: 0,    copper_gold: 0,    hy: -0.05, stlfsi: -0.05, anfci: -0.05, aaii: 0,    putcall: -0.05, breadth: 0 } },
  { id: 'TLT', name: 'USTs (20+yr)',          assetClass: 'Defensive', beta: 1.20, current: 0, loadings: { vix: -0.60, move: -0.50, real_rates: +3.00, term_premium: -0.30, dxy: -0.20, copper_gold: +0.20, hy: -0.30, stlfsi: -0.40, anfci: -0.30, aaii: +0.20, putcall: -0.30, breadth: +0.20 } },
  { id: 'GLD', name: 'Gold',                  assetClass: 'Defensive', beta: 0.70, current: 0, loadings: { vix: -0.50, move: -0.30, real_rates: +0.60, term_premium: 0,     dxy: +0.50, copper_gold: +0.70, hy: -0.40, stlfsi: -0.30, anfci: -0.20, aaii: +0.10, putcall: -0.30, breadth: +0.10 } },
];

// Re-balance equity currents to sum to 100% (defensive baseline is 0%).
export const SECTORS = SECTORS_RAW.map((s) =>
  s.assetClass === 'Equity' ? { ...s, current: Math.round((s.current * 100) / 83) } : s,
);
export const SECTOR_BY_NAME = Object.fromEntries(SECTORS.map((s) => [s.name, s]));

// ════════════════════════════════════════════════════════════════════════
// PURE FUNCTIONS
// ════════════════════════════════════════════════════════════════════════

export function fmtSigma(v) {
  if (v == null || !Number.isFinite(v)) return '—';
  return (v > 0 ? '+' : '') + v.toFixed(1) + 'σ';
}

export function fmtNominal(factorId, sigma) {
  const b = FACTOR_BASELINES[factorId];
  if (!b || sigma == null || !Number.isFinite(sigma)) return '';
  const v = b.mean + sigma * b.std;
  return b.fmt(v);
}

// Convert today's per-indicator reading into a sigma starting point. The
// slider sits at where the factor sits in real life right now, so a custom
// shock shocks FROM reality, not from a synthetic zero.
export function getCurrentReadings(indicatorHistory) {
  const out = {};
  FACTOR_IDS.forEach((fid) => {
    const histKey = FACTOR_HISTORY_KEYS[fid];
    const baseline = FACTOR_BASELINES[fid];
    if (!histKey || !baseline || !indicatorHistory || !indicatorHistory[histKey]) {
      out[fid] = 0;
      return;
    }
    const points = indicatorHistory[histKey].points;
    if (!points || !points.length) { out[fid] = 0; return; }
    const lastValue = points[points.length - 1][1];
    if (typeof lastValue !== 'number' || !Number.isFinite(lastValue) || !baseline.std) {
      out[fid] = 0;
      return;
    }
    out[fid] = (lastValue - baseline.mean) / baseline.std;
  });
  return out;
}

// Correlated propagation: move one driver factor by driverZ, derive every
// other factor's implied move from the correlation matrix.
export function propagateRealistic(driverId, driverZ) {
  const out = {};
  FACTOR_IDS.forEach((f) => { out[f] = driverZ * getCorr(driverId, f); });
  return out;
}

// Per-sector expected return % given a 12-factor shock vector and a horizon
// key ('1mo' / '3mo' / '6mo'). The -1.4 × beta scaling matches the legacy
// engine; horizon multipliers (0.5 / 1.0 / 1.55) compound the monthly move
// to the requested window.
export function sectorReturns(shocks, horizonKey = '3mo') {
  const horizonMult = horizonKey === '1mo' ? 0.5 : horizonKey === '6mo' ? 1.55 : 1.0;
  const out = {};
  SECTORS.forEach((s) => {
    let total = 0;
    Object.entries(s.loadings).forEach(([f, l]) => { total += l * (shocks[f] || 0); });
    out[s.id] = -1.4 * s.beta * total * horizonMult;
  });
  return out;
}

// Custom-shock regime severity: MOVE z-score percentile cutoff. z ≥ 1.0364
// is the 85th percentile (Risk Off); z ≥ 0.6745 is the 75th (Watch).
export function customRegime(shocks) {
  const m = shocks.move || 0;
  if (m >= 1.0364) return 'Risk Off';
  if (m >= 0.6745) return 'Watch';
  return 'Risk On';
}

// Custom-shock yield direction: real-rates z-score percentile cutoff.
// z ≥ 0.5244 → Inflationary (70th); z ≤ -0.5244 → Deflationary (30th).
export function customYieldDir(shocks) {
  const r = shocks.real_rates || 0;
  if (r >= 0.5244) return 'Inflationary';
  if (r <= -0.5244) return 'Deflationary';
  return 'Neutral';
}

// Custom-shock { spy, engine } drawdown depths. Used to populate the
// Strategy Allocations table when the user picks a bespoke shock that has
// no historical match. Mirrors the legacy _customReturns derivation.
//
// spy        = S&P-weighted sum of equity sector stresses (current weights
//              used as an approximation of S&P weights — fine for v1).
// engine     = de-risked equity (95% of S&P via sector tilt) + sleeve return
//              under the shock.
export function customReturns(shocks, horizonKey = '3mo') {
  const pcts = sectorReturns(shocks, horizonKey);

  // S&P 500 return: weight each equity sector by current allocation, sum.
  let spy = 0;
  let spyWtSum = 0;
  SECTORS.forEach((s) => {
    if (s.assetClass !== 'Equity') return;
    const w = s.current / 100;
    if (pcts[s.id] != null && Number.isFinite(pcts[s.id])) {
      spy += w * pcts[s.id];
      spyWtSum += w;
    }
  });
  if (spyWtSum > 0 && spyWtSum < 0.98) spy = spy / spyWtSum;

  // Engine return: de-risk equity, add defensive sleeve.
  const sev = customRegime(shocks);
  const eqFrac = sev === 'Risk Off' ? 0.50 : sev === 'Watch' ? 0.80 : 1.00;
  const defFrac = 1 - eqFrac;
  const yieldDir = customYieldDir(shocks);
  const sleeve = STRAT_SLEEVES[yieldDir] || STRAT_SLEEVES.Neutral;
  const gldStress = pcts.GLD || 0;
  const tltStress = pcts.TLT || 0;
  const defReturn = sleeve.gld * gldStress + sleeve.tlt * tltStress;
  const engine = eqFrac * (spy * 0.95) + defFrac * defReturn;

  return { spy, engine, regime: { severity: sev, yieldDir } };
}

// Per-sector stress for the Asset Tilt sector list, given an active scenario
// id or a custom shock vector. Returns { id, name, code, stressPct, beta }
// sorted by the engine's expected stress depth.
export function sectorStressMatrix({ scenarioStressKey, customShocks, horizonKey = '3mo', limit = null }) {
  const shocks =
    scenarioStressKey && SCENARIOS[scenarioStressKey]
      ? SCENARIOS[scenarioStressKey].factors
      : customShocks || {};
  const pcts = sectorReturns(shocks, horizonKey);
  const rows = SECTORS.filter((s) => s.assetClass === 'Equity').map((s) => ({
    id: s.id,
    name: s.name,
    code: s.id,
    stressPct: pcts[s.id] != null && Number.isFinite(pcts[s.id]) ? pcts[s.id] : null,
    beta: s.beta,
  }));
  rows.sort((a, b) => (a.stressPct ?? 0) - (b.stressPct ?? 0));
  return limit ? rows.slice(0, limit) : rows;
}
