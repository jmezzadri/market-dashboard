/* MacroTilt scanner score weights — single source of truth.

   Previously duplicated between ScannerPage.jsx and ScanDrill.jsx
   (catalog 2026-05-27, violation 3 of 3 on Scanner). Both surfaces
   read this constant now, so the score-math drill cannot disagree
   with the "How the score is built" cards on the same page.

   Weights sum to 1.0. Score scale is 0–5 (backend native, Joe
   directive 2026-05-27). Contribution = (score/5) × weight × 5,
   so Σ contribution always reconciles to the headline 0–5 score. */

export const SCORE_WEIGHTS = [
  { key: 'Technicals',  weight: 0.25, why: '200d trend, RSI, MACD, ATR' },
  { key: 'Insider',     weight: 0.20, why: 'C-suite buys/sells, 60d ratio' },
  { key: 'Analyst',     weight: 0.20, why: 'Upgrades, raised price targets' },
  { key: 'Options vol', weight: 0.15, why: 'Calls/puts, IV rank, sweeps' },
  { key: 'Congress',    weight: 0.10, why: 'Senate + House disclosures' },
  { key: 'Dark pool',   weight: 0.10, why: 'Block trades, VWAP anchor' },
];

export default SCORE_WEIGHTS;
