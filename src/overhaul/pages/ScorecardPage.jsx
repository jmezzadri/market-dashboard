/* ScorecardPage — every published Trade Idea and how it has actually done.

   Joe, 2026-08-17: "Can we somehow track our trade ideas and how they
   performed? I'd like to start collecting historical data on our calls."

   PUBLIC (Joe, 2026-08-17: "Public now is fine"). It was gated for exactly one
   commit on the theory that three calls is not a track record. Publishing it
   puts the weight on the marker instead of the door — the hit rate is withheld
   below 10 closed calls and the page says why, every call is listed win or
   lose, and a stopped-out call is marked at the stop. On a public page those
   rules are the product, not a caveat.

   This component RENDERS public/trade_idea_scores.json and computes nothing.
   Every figure on the page is produced by scripts/score_trade_ideas.py from
   the note's own scorecard block plus indicator_history.json. That separation
   is the point: a page that did its own arithmetic could quietly disagree with
   the marker, and then there would be two track records.

   The honest-by-construction bits, all of which come through from the marker:
     - notes awaiting their entry close are shown as such, not hidden
     - notes that cannot be scored are shown WITH the reason
     - the path (best and worst point) sits next to the current mark
     - no hit rate is displayed below the threshold, and the page says why */

import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

// The SAME note reader the Home tile uses. Joe, 2026-08-17: "I can't see what
// your call was on 8/14 ... You need a way to resurface the analysis and the
// call." A mark without the call beside it is a number about nothing, and a
// paraphrase written for this page would be a second version of the note that
// could drift from the published one. So the scorecard shows the call inline
// and opens the identical note.
import TradeIdeaNoteModal from '../components/TradeIdeaNote';
import useIndicatorSeries from '../lib/useIndicatorSeries';

// The CREAM design system supplies the palette tokens; scorecard-v12 binds them
// into the .sc-wrap scope. Both are required — scorecard-v12 alone leaves every
// token undefined and the page renders on fallbacks.
import '../styles/cream-system.css';
import '../styles/v13.css';
import '../styles/pages-v13.css';
import '../styles/scorecard-v12.css';

const STATUS_LABEL = {
  open: 'Open',
  pending_entry: 'Awaiting entry',
  closed_horizon: 'Closed · horizon',
  closed_invalidated: 'Closed · invalidated',
  unscoreable: 'Not scoreable',
};

function fmt(v, unit) {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  const s = v > 0 ? '+' : '';
  return `${s}${Number(v).toFixed(2)}${unit === 'pp' ? 'pp' : '%'}`;
}

function toneOf(v) {
  if (v === null || v === undefined) return 'flat';
  if (v > 0.05) return 'up';
  if (v < -0.05) return 'down';
  return 'flat';
}

const KIND_LABEL = { equity: 'Equity', rates: 'Rates', fx: 'FX', commodity: 'Commodity', credit: 'Credit' };

/* One call, one row. Joe, 2026-08-18:
     "Date Entered - Asset Class - Trade - Status - Target Close Date -
      Total Return - Return vs. Benchmark - Link to full Note. Simple table."

   Two things this fixes. The row used to carry the note's HEADLINE — "The
   volatility curve is at its steepest in five years" — which is written to make
   somebody read the note, not to say what the position is. It now carries the
   position: Long KBW / Short NASDAQ. And the numbers used to be hidden behind
   an expander, so comparing two calls meant opening both. Everything is on the
   row.

   One yardstick on every row — Joe, 2026-08-25: "yes lets put it all vs. S&P.
   How does anyone have a clue what we're measuring against?!" The column is
   the gap to the S&P 500 over the same days, for every call in every market.
   The header names it so nobody has to guess. */
function Row({ r, idea, onOpenNote }) {
  const closed = String(r.status || '').startsWith('closed');
  const showMark = r.status === 'open' || closed;
  const vs = r.benchmark ? r.benchmark.difference : null;
  return (
    <tr className={`sc-trow sc-trow--${r.status}`}>
      <td className="num">{r.entry_date || '—'}</td>
      <td>{KIND_LABEL[r.kind] || r.kind}</td>
      <td className="sc-tradecell">{r.trade_label || r.instrument || '—'}</td>
      <td><span className={`sc-status sc-status--${r.status}`}>{STATUS_LABEL[r.status] || r.status}</span></td>
      <td className="num">{r.target_date || '—'}</td>
      <td className={`num sc-${toneOf(showMark ? r.mark : null)}`}>{showMark ? fmt(r.mark, '%') : '—'}</td>
      <td className={`num sc-${toneOf(showMark ? vs : null)}`}>
        {showMark && vs != null ? fmt(vs, '%') : '—'}
      </td>
      <td className="sc-notecell">
        {idea
          ? <button type="button" className="sc-notebtn" onClick={() => onOpenNote(idea)}>Note &rarr;</button>
          : <span className="sc-dim">—</span>}
      </td>
    </tr>
  );
}

export default function ScorecardPage() {
  const [data, setData] = useState(null);
  const [notes, setNotes] = useState(null);
  const [openNote, setOpenNote] = useState(null);
  const [err, setErr] = useState(null);
  // The hook only loads the keys it is asked for, so gather every series any
  // note charts. Passing nothing returns {} and every chart in the reopened
  // note would render empty — which is the failure mode this whole change
  // exists to prevent.
  const [chartKeys, setChartKeys] = useState([]);
  const { series: chartSeries } = useIndicatorSeries(chartKeys);

  useEffect(() => {
    let dead = false;
    fetch('/trade_idea_scores.json', { cache: 'no-cache' })
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((d) => { if (!dead) setData(d); })
      .catch((e) => { if (!dead) setErr(String(e.message || e)); });
    // The notes themselves. Kept as a SEPARATE fetch rather than folded into
    // the scores file on purpose: score_trade_ideas.py stays a pure marker that
    // knows nothing about prose, and trade_ideas.json stays the single source
    // of the published text. The join happens here, at read time, by id.
    fetch('/trade_ideas.json', { cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (dead) return;
        const list = Array.isArray(d?.ideas) ? d.ideas : [];
        setNotes(list);
        setChartKeys([...new Set(list.flatMap((n) => (n.charts || []).map((c) => c.series)).filter(Boolean))]);
      })
      .catch(() => { if (!dead) setNotes([]); });
    return () => { dead = true; };
  }, []);

  const s = data?.summary;
  const rows = useMemo(() => (Array.isArray(data?.scores) ? data.scores : []), [data]);
  const noteById = useMemo(() => {
    const m = new Map();
    (notes || []).forEach((n) => { if (n?.id) m.set(n.id, n); });
    return m;
  }, [notes]);

  return (
    /* `home-v12` is required, not decorative: cream-system.css declares the
       palette on that class, not on :root, so without it every token here
       falls back and the page renders off-brand. Same convention as
       DataFlowPage (`home-v12 data-v12`) and the other converted pages. */
    <main className="mt-main-wrap home-v12 v13 sc-wrap">
      <header className="sc-head">
        <h1>Trade Idea scorecard</h1>
        <p className="sc-sub">
          Every note published on the Home tile, marked from the position it stated at the time.
          Nothing here is entered by hand.
        </p>
      </header>

      {err && <p className="sc-err">Could not load the scores ({err}). The marker may not have run yet.</p>}
      {!data && !err && <p className="sc-dim">Loading…</p>}

      {s && (
        <>
          <div className="sc-tiles">
            <div className="sc-tile"><span className="sc-tile-n">{s.published}</span><span className="sc-tile-l">Published</span></div>
            <div className="sc-tile"><span className="sc-tile-n">{s.open}</span><span className="sc-tile-l">Open</span></div>
            <div className="sc-tile"><span className="sc-tile-n">{s.closed}</span><span className="sc-tile-l">Closed</span></div>
            {s.pending_entry > 0 && (
              <div className="sc-tile"><span className="sc-tile-n">{s.pending_entry}</span><span className="sc-tile-l">Awaiting entry</span></div>
            )}
            {s.unscoreable > 0 && (
              <div className="sc-tile sc-tile--warn"><span className="sc-tile-n">{s.unscoreable}</span><span className="sc-tile-l">Not scoreable</span></div>
            )}
          </div>

          {/* The "no hit rate yet" banner is gone (Joe, 2026-08-18: "just remove
              that"). The DISCIPLINE is unchanged and still lives in the marker:
              below MIN_CLOSED_FOR_STATS closed calls it refuses to compute a
              hit rate, so there is nothing here to show — the page simply
              doesn't explain its own absence at the top of the screen. The
              reason still ships in the JSON for anyone reading the data. */}
          {!s.stats_withheld && (
            <div className="sc-tiles">
              <div className="sc-tile"><span className="sc-tile-n">{s.hit_rate}%</span><span className="sc-tile-l">Hit rate</span></div>
              <div className="sc-tile"><span className="sc-tile-n">{fmt(s.mean_result, '%')}</span><span className="sc-tile-l">Mean result</span></div>
              <div className="sc-tile"><span className="sc-tile-n">{fmt(s.median_result, '%')}</span><span className="sc-tile-l">Median result</span></div>
              <div className="sc-tile"><span className="sc-tile-n">{s.closed_by_invalidation}</span><span className="sc-tile-l">Stopped out</span></div>
            </div>
          )}
        </>
      )}

      {/* The book, stated as one position — Joe, 2026-08-25: "We need to be
          giving ideas on how to structure portfolios, rebalance, etc." The
          paragraph is authored in the newest note (book.stance) so the table
          below always has a reading of what its rows add up to. */}
      {(() => {
        const withBook = (notes || []).filter((n) => n?.book?.stance)
          .sort((a, b) => String(b.date).localeCompare(String(a.date)));
        const bk = withBook[0];
        if (!bk) return null;
        return (
          <section className="sc-book" style={{ margin: '18px 0 6px' }}>
            <p className="sc-tile-l" style={{ marginBottom: 6 }}>The book right now · as of {bk.date}</p>
            <p style={{ maxWidth: '72ch', lineHeight: 1.55 }}>{bk.book.stance}</p>
          </section>
        );
      })()}

      <section className="sc-list">
        {rows.length > 0 && (
          <div className="sc-tablewrap">
            <table className="sc-table">
              <thead>
                <tr>
                  <th>Date entered</th>
                  <th>Asset class</th>
                  <th>Trade</th>
                  <th>Status</th>
                  <th>Target close</th>
                  <th className="num">Total return</th>
                  <th className="num">vs. S&amp;P 500</th>
                  <th aria-label="Full note" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <Row key={r.id || r.date} r={r} idea={noteById.get(r.id)} onOpenNote={setOpenNote} />
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data && !rows.length && <p className="sc-dim">No notes published yet.</p>}
      </section>

      {openNote && (
        <TradeIdeaNoteModal idea={openNote} chartSeries={chartSeries} onClose={() => setOpenNote(null)} />
      )}

      {data && (
        <footer className="sc-method">
          <h2>How these marks are made</h2>
          <p>{data.method}</p>
          <p className="sc-disclaimer">{data.disclaimer}</p>
          <p className="sc-dim">
            Marked to {data.as_of}. Generated {data.generated_at}. The notes themselves are on the{' '}
            <Link to="/">Home</Link> tile.
          </p>
        </footer>
      )}
    </main>
  );
}
