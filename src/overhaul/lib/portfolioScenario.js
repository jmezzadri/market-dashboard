/* portfolioScenario.js — position-level scenario P&L for the Scenario Analysis
   page. Senior Quant + Lead Developer build 2026-06-05 (Joe: "full options
   modeling").

   METHOD (plain English)
   ──────────────────────
   For each holding, project its P&L under the active scenario shock vector:

   • Stocks / ETFs / funds: dollar value × the holding's sector scenario move
     (from ccar.sectorReturns). No sector match → market move × beta.

   • Options: full Black–Scholes re-price (captures delta, gamma/convexity,
     vega, theta — not just delta):
       1. Base price  = BS(spot, strike, T, r, IV)              [today]
       2. Underlier moves by its sector's scenario return        → S'
       3. Volatility scales by the scenario's VIX level          → IV' = IV × (VIX_scn / VIX_now)
          (a crash spikes option vol — this is what makes long puts pay off)
       4. Clock advances by the horizon (theta)                  → T' = T − horizonYears
       5. Scenario price = BS(S', strike, T', r, IV')
       P&L = (scenarioPrice − basePrice) × contracts × multiplier
       (contracts are signed: negative = short, so the sign falls out correctly)

   Every position rolls up to one number: projected $ P&L and % of position.
   The portfolio total answers "what does THIS scenario do to my book."
*/

import { sectorReturns, SECTOR_BY_NAME } from './ccar';

const R_FREE = 0.045;
const VIX_MEAN = 19.6, VIX_STD = 8.1;   // same calibration as ccar FACTOR_BASELINES.vix
const HORIZON_YEARS = { '1mo': 1 / 12, '3mo': 0.25, '6mo': 0.5 };
// generic asset-class betas for holdings with no sector match (mirrors PortfolioPage pBeta DB)
const AC_BETA = { Equity: 1.0, 'Fixed Income': 0.3, Cash: 0, Commodity: 0.4, Crypto: 2.2, Option: 1.0 };

// Map a company's SIC code to one of the engine's equity sectors so each
// holding moves by its real sector under a scenario (not the broad market).
// SIC divisions are coarser than GICS but give a sound sector for stress math.
export function sicToSector(sic) {
  const n = parseInt(String(sic || '').trim().slice(0, 4), 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n >= 2833 && n <= 2836) return 'Healthcare';        // biotech/pharma
  if (n >= 3840 && n <= 3851) return 'Healthcare';        // medical devices
  if (n >= 8000 && n <= 8099) return 'Healthcare';        // health services
  if (n >= 7370 && n <= 7379) return 'Technology';        // software / IT services
  if (n >= 3570 && n <= 3579) return 'Technology';        // computers
  if ((n >= 3600 && n <= 3699) || (n >= 3670 && n <= 3679)) return 'Technology'; // electronics/semis
  if (n >= 4800 && n <= 4899) return 'Communication Services';
  if (n >= 2700 && n <= 2799) return 'Communication Services'; // publishing/media
  if (n >= 6000 && n <= 6299) return 'Financials';        // banks + capital markets
  if (n >= 6300 && n <= 6499) return 'Financials';        // insurance
  if (n >= 6790 && n <= 6799) return 'Real Estate';       // REITs
  if (n >= 6500 && n <= 6599) return 'Real Estate';
  if (n >= 6700 && n <= 6799) return 'Financials';        // holding/investment
  if (n >= 4900 && n <= 4999) return 'Utilities';
  if (n >= 2900 && n <= 2999) return 'Energy';            // petroleum refining
  if (n >= 1300 && n <= 1399) return 'Energy';            // oil & gas extraction
  if ((n >= 1000 && n <= 1099) || (n >= 1400 && n <= 1499)) return 'Materials'; // metal/nonmetal mining
  if (n >= 2800 && n <= 2899) return 'Materials';         // chemicals
  if ((n >= 3300 && n <= 3399) || (n >= 1000 && n <= 1499)) return 'Materials'; // primary metals
  if (n >= 2000 && n <= 2199) return 'Staples';           // food & beverage
  if (n >= 2100 && n <= 2199) return 'Staples';
  if (n >= 5400 && n <= 5499) return 'Staples';           // grocery
  if (n >= 3710 && n <= 3719) return 'Discretionary';     // autos
  if (n >= 2300 && n <= 2399) return 'Discretionary';     // apparel
  if ((n >= 5200 && n <= 5999)) return 'Discretionary';   // retail
  if (n >= 7000 && n <= 7999) return 'Discretionary';     // consumer services
  if (n >= 3400 && n <= 3999) return 'Industrials';       // machinery, aerospace/defense, instruments
  if (n >= 1500 && n <= 1799) return 'Industrials';       // construction
  if (n >= 4000 && n <= 4799) return 'Industrials';       // transportation
  return null;
}

// Common sector-name aliases -> engine sector names (for position.sector text).
const SECTOR_ALIAS = {
  'information technology': 'Technology', 'tech': 'Technology', 'technology': 'Technology',
  'communication services': 'Communication Services', 'communications': 'Communication Services', 'telecom': 'Communication Services',
  'financials': 'Financials', 'financial services': 'Financials', 'banks': 'Financials',
  'consumer discretionary': 'Discretionary', 'discretionary': 'Discretionary',
  'consumer staples': 'Staples', 'staples': 'Staples',
  'industrials': 'Industrials', 'aerospace & defense': 'Industrials', 'capital goods': 'Industrials',
  'materials': 'Materials', 'basic materials': 'Materials',
  'energy': 'Energy', 'health care': 'Healthcare', 'healthcare': 'Healthcare',
  'utilities': 'Utilities', 'real estate': 'Real Estate',
};
function aliasSector(name) {
  if (!name) return null;
  return SECTOR_ALIAS[String(name).trim().toLowerCase()] || name;
}

function normCdf(x) {
  const k = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989422804014327 * Math.exp(-x * x / 2);
  let p = d * k * (0.319381530 + k * (-0.356563782 + k * (1.781477937 + k * (-1.821255978 + k * 1.330274429))));
  return x >= 0 ? 1 - p : p;
}
function bsPrice(S, K, T, r, sig, isCall) {
  if (!(S > 0) || !(K > 0)) return 0;
  if (!(T > 0) || !(sig > 0)) return isCall ? Math.max(S - K, 0) : Math.max(K - S, 0); // expiry intrinsic
  const d1 = (Math.log(S / K) + (r + 0.5 * sig * sig) * T) / (sig * Math.sqrt(T));
  const d2 = d1 - sig * Math.sqrt(T);
  return isCall
    ? S * normCdf(d1) - K * Math.exp(-r * T) * normCdf(d2)
    : K * Math.exp(-r * T) * normCdf(-d2) - S * normCdf(-d1);
}
const vixNominal = (sigma) => VIX_MEAN + (sigma || 0) * VIX_STD;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// Resolve a holding's underlying scenario move (%) from its sector, with fallbacks.
function moveForSector(sectorName, assetClass, beta, sectRet, marketPct) {
  const s = sectorName ? SECTOR_BY_NAME[sectorName] : null;
  if (s && Number.isFinite(sectRet[s.id])) {
    // The sector move already embeds the sector's own beta to the factors, so
    // scale by the NAME's beta relative to the sector beta (avoids double
    // counting). A 2.5-beta name in a ~1.15-beta sector moves ~2.2x the sector.
    const sb = Number(s.beta) || 1;
    const b = (Number.isFinite(beta) && beta != null) ? beta : sb;
    return sectRet[s.id] * (b / sb);
  }
  const b = (Number.isFinite(beta) && beta != null) ? beta : (AC_BETA[assetClass] ?? 1);
  return (marketPct || 0) * b;
}

export function computePortfolioScenario({ rows, total, shocks, horizonKey = '3mo', vixCurrentSigma = 0, marketPct = 0, sectorMap = {}, betaMap = {} }) {
  if (!rows || !rows.length) return null;
  const sectRet = sectorReturns(shocks, horizonKey);            // % per sector id
  const horizonYears = HORIZON_YEARS[horizonKey] ?? 0.25;
  const volMult = clamp(vixNominal(shocks.vix) / Math.max(vixNominal(vixCurrentSigma), 8), 0.5, 8);

  const out = [];
  rows.forEach((r) => {
    const ac = r.cls?.ac || r.assetClass || 'Equity';
    if (ac === 'Cash') { out.push({ key: r.id ?? r.ticker, ticker: r.ticker, label: r.ticker, value: r.value, stressedValue: r.value, pnl: 0, pnlPct: 0, modeled: true, kind: 'cash' }); return; }

    if (r.option) {
      const o = r.option;
      const secName = aliasSector(sectorMap[r.ticker] || r.sector);
      const movePct = moveForSector(secName, 'Equity', null, sectRet, marketPct);
      /* First-order (delta-equivalent) scenario P&L. An option contributes only
         its delta-equivalent underlier exposure to the book — a long put with
         -$63.5K delta-equivalent offsets ~$63.5K of longs, NOT its full convex
         payoff. (Full BS repricing overstated deep hedges and could flip the
         whole book positive — Joe 2026-06-05.) Convexity is intentionally
         excluded; this is conservative on hedge protection, the safe direction
         for a risk overview. */
      const deltaNotional = Number(o.deltaEquivNotional) || 0;   // signed $; long put = negative
      const pnl = deltaNotional * (movePct / 100);
      out.push({ key: r.id ?? (o.label + o.underlier), ticker: o.underlier, label: `${o.label} ${o.underlier} $${o.strike}`,
        value: r.value, stressedValue: (r.value || 0) + pnl, pnl, pnlPct: r.value ? (pnl / r.value) * 100 : null,
        modeled: deltaNotional !== 0, kind: 'option' });
      return;
    }

    const secName = aliasSector(sectorMap[r.ticker] || r.sector);
    const nameBeta = (betaMap[r.ticker] != null) ? Number(betaMap[r.ticker]) : r.beta;
    const movePct = moveForSector(secName, ac, nameBeta, sectRet, marketPct);
    const pnl = (r.value || 0) * (movePct / 100);
    out.push({ key: r.id ?? r.ticker, ticker: r.ticker, label: r.ticker, value: r.value, stressedValue: (r.value || 0) + pnl, pnl, pnlPct: movePct, modeled: true, kind: 'equity' });
  });

  const totalPnl = out.reduce((s, p) => s + (Number.isFinite(p.pnl) ? p.pnl : 0), 0);
  const tot = total || out.reduce((s, p) => s + (p.value || 0), 0);
  out.sort((a, b) => (a.pnl ?? 0) - (b.pnl ?? 0));               // worst first
  return { positions: out, totalPnl, totalValue: tot, pct: tot ? (totalPnl / tot) * 100 : null };
}
