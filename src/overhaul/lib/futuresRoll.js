/* futuresRoll — which futures series' latest one-session change is a contract
   roll, not a market move (LESSONS 4.37).

   A continuous front-month series splices two contracts at every expiry, and
   the splice prints as a price change nobody traded. Two checks, both against
   WTI as the benchmark barrel:

   1. Brent vs WTI, every session: the same barrel with a slow freight-and-
      quality spread. When their moves differ by more than ROLL_MAX_GAP_PCT
      points, the larger leg is a roll gap or a bad tick.
   2. Gasoline (RBOB) and Diesel (ULSD) vs WTI, on the first session of a
      month only: both expire on the last business day of the month before
      delivery, so the front month always splices across a month boundary
      (2026-11-02: the Nov→Dec RBOB roll, including the switch to the cheaper
      winter grade, printed Gasoline −12.4% on a day WTI fell 7.4%). Limited
      to that session because product cracks legitimately diverge from crude
      on refinery news on any other day.

   An absent change is correct; a wrong one lies. Shared by the market tape
   and the Macro Landscape grid so the two can never disagree. */

export const ROLL_MAX_GAP_PCT = 3; // 2026-10-21: a 4.98-point WTI roll gap slipped under 5

const BENCH = 'cmdty_oil';
const PAIR = ['cmdty_oil', 'cmdty_brent'];
const MONTH_END_ROLLERS = ['cmdty_gasoline', 'cmdty_heatoil'];

function lastMove(points) {
  if (!Array.isArray(points) || points.length < 2) return null;
  const [d1, v1] = points[points.length - 1];
  const [d0, v0] = points[points.length - 2];
  const a = Number(v1), b = Number(v0);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= 0) return null;
  return { pct: (a / b - 1) * 100, date: String(d1), prevDate: String(d0) };
}

/* pointsOf(key) -> [[date, value], ...] | undefined. Returns a Set of keys
   whose latest change must not be shown. */
export function rollArtifacts(pointsOf) {
  const out = new Set();
  const [a, b] = PAIR.map((k) => lastMove(pointsOf(k)));
  if (a && b && Math.abs(a.pct - b.pct) > ROLL_MAX_GAP_PCT) {
    out.add(Math.abs(a.pct) > Math.abs(b.pct) ? PAIR[0] : PAIR[1]);
  }
  const w = lastMove(pointsOf(BENCH));
  if (w && !out.has(BENCH)) {
    MONTH_END_ROLLERS.forEach((k) => {
      const m = lastMove(pointsOf(k));
      if (!m || m.date !== w.date) return;
      if (m.date.slice(0, 7) === m.prevDate.slice(0, 7)) return; // not a roll session
      if (Math.abs(m.pct - w.pct) > ROLL_MAX_GAP_PCT && Math.abs(m.pct) > Math.abs(w.pct)) out.add(k);
    });
  }
  return out;
}
