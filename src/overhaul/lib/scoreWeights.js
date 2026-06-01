/* MacroTilt scanner score model — single source of truth.

   IMPORTANT (2026-06-01 rebuild): the scanner score is NOT a weighted
   average of six factors. The nightly engine (trading-scanner
   run_screener.py) builds it as a simple SUM of point values:

       score = insider_pts + sma200_pts + rsi_pts
                            + dark_pool_pts + options_pts        (capped at 10)

   So the honest composition is additive — each component contributes its
   own points, and the points sum to the headline score exactly. There are
   no fixed percentage weights. The earlier six-factor weighted model
   (Technicals/Insider/Analyst/Options/Congress/Dark-pool) overstated what
   the engine computes: Analyst and Congress are not scored by this engine
   at all, and on a typical day dark-pool and options contribute 0.

   We group the five raw point fields into the FOUR components the engine
   actually scores (Joe directive 2026-06-01 — "show the 4 real inputs
   only"):

     Technicals   = sma200_pts + rsi_pts
     Insider      = insider_pts
     Options flow = options_pts
     Dark pool    = dark_pool_pts

   componentPoints(row) returns these four, in display order, and they sum
   to row.score. The drill-down and the "How the score is built" cards both
   read from here so they can never disagree. */

export const SCORE_COMPONENTS = [
  {
    key: 'Insider',
    why: 'C-suite Form-4 buys (rules A/B/C), weight decays with signal age',
    fields: ['insider_pts'],
  },
  {
    key: 'Technicals',
    why: 'Trades above its 200-day line; penalty if RSI runs hot',
    fields: ['sma200_pts', 'rsi_pts'],
  },
  {
    key: 'Options flow',
    why: 'Unusual options-volume shock (not yet backtested)',
    fields: ['options_pts'],
  },
  {
    key: 'Dark pool',
    why: 'Block prints anchored near VWAP (not yet backtested)',
    fields: ['dark_pool_pts'],
  },
];

/* Sum the raw point fields for one component on a scan row. Missing fields
   count as 0, so the four component totals always sum to the row score. */
export function componentPoints(row, comp) {
  return comp.fields.reduce((acc, f) => {
    const v = Number(row?.[f]);
    return acc + (Number.isFinite(v) ? v : 0);
  }, 0);
}

/* Build the full additive breakdown for a row: one entry per component with
   its points, plus the reconciled total. */
export function buildScanBreakdown(row) {
  const items = SCORE_COMPONENTS.map((comp) => ({
    key: comp.key,
    why: comp.why,
    points: componentPoints(row, comp),
  }));
  const total = items.reduce((s, x) => s + x.points, 0);
  return { items, total };
}

export default SCORE_COMPONENTS;
