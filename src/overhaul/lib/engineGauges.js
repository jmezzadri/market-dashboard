/* Engine gauges — ONE computation for the Home and Macro tiles (LESSONS 4.5).

   2026-09-30: the marker used a straight 40–160 scale while the three labels
   under the bar sit at left / centre / right. MOVE 107 therefore landed at 56%
   — dead centre, directly over the word "Watch" — while the caption (correctly)
   read "Calm". Joe read the bar, not the caption: "It's watch status!".

   The bar is now three equal zones, one per label, with the engine thresholds
   as the zone edges. A marker can only sit over the label of the zone the
   engine is actually in. Display only — no engine number changes.

   2026-11-17: every function takes the lines it draws (regime.stressThresholds /
   regime.yieldThresholds, read from the Engine file); the constants are only
   the fallback. */
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

export function stressGaugePct(move, t = STRESS_THRESH) {
  return zonePct(move, MOVE_LO, t.watch, t.riskOff, MOVE_HI);
}

/* Deflationary is "≤ <line>", so the line itself belongs to the left zone: nudge the
   lower edge so an exact −11 does not draw inside Neutral. */
export function yieldGaugePct(bp, t = YIELD_THRESH) {
  if (bp != null && bp <= t.deflBp) {
    return zonePct(bp, YIELD_LO, t.deflBp + 1e-9, t.inflBp, YIELD_HI);
  }
  return zonePct(bp, YIELD_LO, t.deflBp, t.inflBp, YIELD_HI);
}

/* Caption under the MOVE gauge. States the distance to the next line instead
   of an adjective ("far"), so the words can never outrun the number. */
export function stressMessage(zone, move, t = STRESS_THRESH) {
  const ok = move != null && Number.isFinite(move);
  const pts = (n) => `${n} point${n === 1 ? '' : 's'}`;
  if (zone === 'Risk On') {
    if (!ok) return 'Calm — below the watch line.';
    return `Calm — ${pts(Math.max(1, Math.round(t.watch - move)))} below the ${t.watch} watch line.`;
  }
  if (zone === 'Watch') {
    if (!ok) return 'Watch — approaching the de-risk line.';
    return `Watch — ${pts(Math.max(1, Math.round(t.riskOff - move)))} below the ${t.riskOff} de-risk line.`;
  }
  if (zone === 'Risk Off') return 'Risk off — the de-risk line is breached.';
  return '—';
}
