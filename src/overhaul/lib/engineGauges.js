/* Engine gauges — ONE computation for the Home and Macro tiles (LESSONS 4.5).

   2026-09-30: the marker used a straight 40–160 scale while the three labels
   under the bar sit at left / centre / right. MOVE 107 therefore landed at 56%
   — dead centre, directly over the word "Watch" — while the caption (correctly)
   read "Calm". Joe read the bar, not the caption: "It's watch status!".

   The bar is now three equal zones, one per label, with the engine thresholds
   as the zone edges. A marker can only sit over the label of the zone the
   engine is actually in. Display only — no engine number changes. */
import { STRESS_THRESH, YIELD_THRESH } from './useEngineRegime';

const THIRD = 100 / 3;
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

/* Map v onto three equal zones: [lo,a) · [a,b) · [b,hi]. */
function zonePct(v, lo, a, b, hi) {
  if (v == null || !Number.isFinite(v)) return null;
  if (v < a) return clamp(((v - lo) / (a - lo)) * THIRD, 0, THIRD);
  if (v < b) return THIRD + ((v - a) / (b - a)) * THIRD;
  return clamp(2 * THIRD + ((v - b) / (hi - b)) * THIRD, 2 * THIRD, 100);
}

const MOVE_LO = 40, MOVE_HI = 160;
const YIELD_LO = -40, YIELD_HI = 60;

export function stressGaugePct(move) {
  return zonePct(move, MOVE_LO, STRESS_THRESH.watch, STRESS_THRESH.riskOff, MOVE_HI);
}

/* Deflationary is "≤ −11", so −11 itself belongs to the left zone: nudge the
   lower edge so an exact −11 does not draw inside Neutral. */
export function yieldGaugePct(bp) {
  if (bp != null && bp <= YIELD_THRESH.deflBp) {
    return zonePct(bp, YIELD_LO, YIELD_THRESH.deflBp + 1e-9, YIELD_THRESH.inflBp, YIELD_HI);
  }
  return zonePct(bp, YIELD_LO, YIELD_THRESH.deflBp, YIELD_THRESH.inflBp, YIELD_HI);
}

/* Caption under the MOVE gauge. States the distance to the next line instead
   of an adjective ("far"), so the words can never outrun the number. */
export function stressMessage(zone, move) {
  const ok = move != null && Number.isFinite(move);
  const pts = (n) => `${n} point${n === 1 ? '' : 's'}`;
  if (zone === 'Risk On') {
    if (!ok) return 'Calm — below the watch line.';
    return `Calm — ${pts(Math.max(1, Math.round(STRESS_THRESH.watch - move)))} below the ${STRESS_THRESH.watch} watch line.`;
  }
  if (zone === 'Watch') {
    if (!ok) return 'Watch — approaching the de-risk line.';
    return `Watch — ${pts(Math.max(1, Math.round(STRESS_THRESH.riskOff - move)))} below the ${STRESS_THRESH.riskOff} de-risk line.`;
  }
  if (zone === 'Risk Off') return 'Risk off — the de-risk line is breached.';
  return '—';
}
