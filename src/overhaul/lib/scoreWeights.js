/* MacroTilt scanner score model — single source of truth.

   IMPORTANT (2026-06-01 rebuild): the scanner score is NOT a weighted
   average of six factors. The nightly engine (trading-scanner
   run_screener.py) builds it as a simple SUM of point values:

       score = insider_pts + sma200_pts + rsi_pts               (capped at 5)

   2026-07-07 Conviction-Insider rebuild: dark_pool_pts and options_pts are
   SHELVED from the score (unvalidated — only weeks of history). They still
   arrive on the row but are INFORMATIONAL CONTEXT only; the ceiling dropped
   from 10 to 5 when they came out.

   So the honest composition is additive — each component contributes its
   own points, and the points sum to the headline score exactly. There are
   no fixed percentage weights. The earlier six-factor weighted model
   (Technicals/Insider/Analyst/Options/Congress/Dark-pool) overstated what
   the engine computes: Analyst and Congress are not scored by this engine
   at all, and on a typical day dark-pool and options contribute 0.

   The engine now scores TWO components (2026-07-07 Conviction-Insider
   rebuild — dark-pool and options shelved as unvalidated):

     Insider     = insider_pts               (up to +4)
     Technicals  = sma200_pts + rsi_pts       (+1 above 200-day, −2 below / −2 hot RSI)

   componentPoints(row) returns these two, in display order, and they sum to
   row.score. Dark-pool and options points still arrive on the row but are
   INFORMATIONAL CONTEXT only (see CONTEXT_SIGNALS) — never summed into the
   score. The drill-down and the "How the score is built" cards read from here
   so they can never disagree. */

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
];

/* Dark-pool + options were SHELVED from the score on 2026-07-07 (unvalidated —
   see the rebuild note above). They still arrive on the scan row and surface as
   informational context, never summed into the headline score. */
export const CONTEXT_SIGNALS = [
  { key: 'Options shock', why: 'Unusual options-volume shock (informational, not scored)', fields: ['options_pts'] },
  { key: 'Dark pool',     why: 'Block prints anchored near VWAP (informational, not scored)', fields: ['dark_pool_pts'] },
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
