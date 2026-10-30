/* tradeSchedule — the ONE statement of a published call's dates and status,
   shown identically on the homepage Trade Idea card, at the top of the full
   note, and on the Macro Scorecard row.

   2026-10-29 audit: the SPY put read "Thu, Oct 22" on the homepage, "Opened
   Oct 21 · Planned close Nov 11" on the Scorecard, "closed by Nov 12" in the
   note's text and "Nov 13 expiry" in the trade block — four dates, no labels
   saying which was which. They are four different facts:

     published    the day the note went out (idea.date / published_at)
     entry        the close the call is marked from — the last settled close
                  BEFORE publication, the price a reader was looking at
                  (scorer: entry_date)
     planned      the planned close: entry + the stated horizon (scorer:
                  target_date) — the date the Scorecard closes the call
     expiry       for an option, the contract's expiry, which can fall after
                  the planned close

   Every value comes from the scorer's own output (public/trade_idea_scores
   .json), never re-derived on a page, so the three surfaces cannot disagree
   (LESSONS 4.5). */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function parts(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return { y: +m[1], mo: +m[2], d: +m[3], dow: DOW[d.getUTCDay()] };
}
export function dayShort(iso) {
  const p = parts(iso);
  return p ? `${MONTHS[p.mo - 1]} ${p.d}` : null;
}
export function dayWithWeekday(iso) {
  const p = parts(iso);
  return p ? `${p.dow}, ${MONTHS[p.mo - 1]} ${p.d}` : null;
}

const STATUS_WORD = { open: 'Open', closed: 'Closed', pending_entry: 'Awaiting its entry close', unscoreable: null };

/* score: the call's row in trade_idea_scores.json (may be null while it
   loads or before the scorer has run). */
export function tradeSchedule(idea, score) {
  if (!idea) return null;
  const option = score?.option || null;
  const expiry = option?.expiry || score?.event?.expiry || null;
  const closed = score?.status === 'closed';
  return {
    published: idea.date || null,
    entry: score?.entry_date || null,
    planned: score?.target_date || null,
    closedOn: closed ? (score?.close_date || score?.mark_date || null) : null,
    expiry,
    status: score ? (STATUS_WORD[score.status] ?? null) : null,
    isOption: !!option,
  };
}

/* The line itself, as plain parts so each surface can lay it out. */
export function scheduleParts(s) {
  if (!s) return [];
  return [
    s.status ? { k: 'status', t: s.status } : null,
    s.entry ? { k: 'entry', t: `marked from the ${dayShort(s.entry)} close` } : null,
    s.closedOn ? { k: 'closed', t: `closed ${dayShort(s.closedOn)}` }
      : (s.planned ? { k: 'planned', t: `planned close ${dayShort(s.planned)}` } : null),
    s.expiry ? { k: 'expiry', t: `${s.isOption ? 'option expires' : 'expires'} ${dayShort(s.expiry)}` } : null,
  ].filter(Boolean);
}
