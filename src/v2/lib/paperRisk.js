/* paperRisk.js — the Paper Portfolio cockpit's display-side helpers.

   2026-10-21: the risk MATHEMATICS left this file. Every figure the page shows
   (10-day VaR, risk share, the market/style/specific split, shock scenarios,
   alerts) is now computed once after each close by paper_portfolio/qt/risk.py
   and stored in qt_risk_daily; the page reads the row. One computation, one
   place (LESSONS 4.5), re-derived and checked in
   paper_portfolio/qt/research/risk_cockpit_2026-10-20/. What remains here is
   the labelling the page needs to render that row. */

/* The alert thresholds the producer applies — kept here so the ledger can
   colour a cell the same way the alert log flags it. Mirror of RULES in
   paper_portfolio/qt/risk.py; change both or neither. */
export const ALERT_RULES = {
  concentration: 2.0,   // risk share / weight share
  drift: 1.5,           // × target weight
  drawdown: -0.10,
  liquidityDays: 1.0,
  leverage: 1.05,       // gross exposure / equity; a few hundred dollars of margin debit is not a risk
};

/* Which style factor a holding leans on most, from its z-scores. Size is
   signed so that "small" is the tilt (the book is mid-cap against a mega-cap
   baseline); value likewise reads as "cheap". A name with no z above 0.5
   on any factor is reported as having no dominant tilt. */
export const FACTOR_LABEL = { momentum: 'Momentum', quality: 'Quality', buybacks: 'Buybacks', size: 'Small size', value: 'Value' };
export function primaryFactor(zs) {
  if (!zs) return null;
  let best = null;
  for (const [k, z] of Object.entries(zs)) {
    if (z == null) continue;
    const v = k === 'size' ? -z : z;
    if (best == null || v > best.v) best = { k, v };
  }
  if (!best || best.v < 0.5) return { key: null, label: 'None dominant', z: best ? best.v : null };
  return { key: best.k, label: FACTOR_LABEL[best.k], z: best.v };
}
