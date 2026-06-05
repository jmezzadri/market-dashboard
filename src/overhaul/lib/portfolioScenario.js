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
  if (s && Number.isFinite(sectRet[s.id])) return sectRet[s.id];
  const b = Number.isFinite(beta) && beta != null ? beta : (AC_BETA[assetClass] ?? 1);
  return (marketPct || 0) * b;
}

export function computePortfolioScenario({ rows, total, shocks, horizonKey = '3mo', vixCurrentSigma = 0, marketPct = 0 }) {
  if (!rows || !rows.length) return null;
  const sectRet = sectorReturns(shocks, horizonKey);            // % per sector id
  const horizonYears = HORIZON_YEARS[horizonKey] ?? 0.25;
  const volMult = clamp(vixNominal(shocks.vix) / Math.max(vixNominal(vixCurrentSigma), 8), 0.5, 8);

  const out = [];
  rows.forEach((r) => {
    const ac = r.cls?.ac || r.assetClass || 'Equity';
    if (ac === 'Cash') { out.push({ key: r.id ?? r.ticker, ticker: r.ticker, label: r.ticker, value: r.value, pnl: 0, pnlPct: 0, modeled: true, kind: 'cash' }); return; }

    if (r.option) {
      const o = r.option;
      const isCall = o.contractType === 'call';
      const mult = Number(r.multiplier) || 100;
      const qty = Number(r.quantity) || 0;                       // signed contracts
      const iv = o.iv > 0 ? o.iv : 0.35;                         // snapshot IV; fallback 35% if missing
      const T = o.T > 0 ? o.T : 0;
      const movePct = moveForSector(r.sector, 'Equity', null, sectRet, marketPct);
      const S2 = o.spot * (1 + movePct / 100);
      const iv2 = iv * volMult;
      const T2 = Math.max(0, T - horizonYears);
      const base = bsPrice(o.spot, o.strike, T, R_FREE, iv, isCall);
      const scn = bsPrice(S2, o.strike, T2, R_FREE, iv2, isCall);
      const pnl = (scn - base) * qty * mult;                     // qty signed → short flips sign
      const notional = Math.abs(base * qty * mult) || null;
      out.push({ key: r.id ?? (o.label + o.underlier), ticker: o.underlier, label: `${o.label} ${o.underlier} $${o.strike}`,
        value: r.value, pnl, pnlPct: notional ? (pnl / notional) * 100 : null, modeled: o.spot > 0, kind: 'option' });
      return;
    }

    const movePct = moveForSector(r.sector, ac, r.beta, sectRet, marketPct);
    const pnl = (r.value || 0) * (movePct / 100);
    out.push({ key: r.id ?? r.ticker, ticker: r.ticker, label: r.ticker, value: r.value, pnl, pnlPct: movePct, modeled: true, kind: 'equity' });
  });

  const totalPnl = out.reduce((s, p) => s + (Number.isFinite(p.pnl) ? p.pnl : 0), 0);
  const tot = total || out.reduce((s, p) => s + (p.value || 0), 0);
  out.sort((a, b) => (a.pnl ?? 0) - (b.pnl ?? 0));               // worst first
  return { positions: out, totalPnl, totalValue: tot, pct: tot ? (totalPnl / tot) * 100 : null };
}
