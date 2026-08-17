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

// The CREAM design system supplies the palette tokens; scorecard-v12 binds them
// into the .sc-wrap scope. Both are required — scorecard-v12 alone leaves every
// token undefined and the page renders on fallbacks.
import '../styles/cream-system.css';
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

function Row({ r }) {
  const [open, setOpen] = useState(false);
  const closed = String(r.status || '').startsWith('closed');
  const showMark = r.status === 'open' || closed;

  return (
    <div className={`sc-row sc-row--${r.status}`}>
      <button type="button" className="sc-rowhead" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className="sc-date">{r.date}</span>
        <span className="sc-kind">{r.kind}</span>
        <span className="sc-title">{r.title}</span>
        <span className={`sc-status sc-status--${r.status}`}>{STATUS_LABEL[r.status] || r.status}</span>
        <span className={`sc-mark sc-mark--${toneOf(showMark ? r.mark : null)}`}>
          {showMark ? fmt(r.mark, r.unit) : '—'}
        </span>
        <span className="sc-toggle" aria-hidden="true">{open ? '−' : '+'}</span>
      </button>

      {open && (
        <div className="sc-detail">
          {(r.status === 'pending_entry' || r.status === 'unscoreable') && (
            <p className="sc-reason">{r.reason}</p>
          )}

          {showMark && (
            <>
              <dl className="sc-facts">
                <div><dt>Position</dt><dd>{r.instrument}</dd></div>
                <div><dt>Type</dt><dd>{r.position_type}</dd></div>
                <div>
                  <dt>Entry</dt>
                  <dd>
                    {r.legs?.map((l) => (
                      <span key={l.series} className="sc-leg">
                        {l.side === 'short' ? 'Short ' : 'Long '}{l.label} at{' '}
                        {Number(l.entry_value).toLocaleString(undefined, { maximumFractionDigits: 4 })}
                      </span>
                    ))}
                    <span className="sc-dim"> · close of {r.entry_date}</span>
                  </dd>
                </div>
                <div><dt>Horizon</dt><dd>{r.horizon_months} months, to {r.target_date}</dd></div>
                <div>
                  <dt>Best point</dt>
                  <dd className={`sc-${toneOf(r.max_favourable?.value)}`}>
                    {fmt(r.max_favourable?.value, r.unit)} <span className="sc-dim">on {r.max_favourable?.date}</span>
                  </dd>
                </div>
                <div>
                  <dt>Worst point</dt>
                  <dd className={`sc-${toneOf(r.max_adverse?.value)}`}>
                    {fmt(r.max_adverse?.value, r.unit)} <span className="sc-dim">on {r.max_adverse?.date}</span>
                  </dd>
                </div>
                {r.benchmark && (
                  <div>
                    <dt>Vs benchmark</dt>
                    <dd className={`sc-${toneOf(r.benchmark.excess)}`}>
                      {fmt(r.benchmark.excess, r.unit)}
                      <span className="sc-dim"> ({r.benchmark.series} {fmt(r.benchmark.move, '%')})</span>
                    </dd>
                  </div>
                )}
                <div><dt>Sessions held</dt><dd>{r.sessions_held}</dd></div>
              </dl>

              {r.invalidation && (
                <p className={`sc-inval ${r.invalidation.date ? 'sc-inval--hit' : ''}`}>
                  <strong>{r.invalidation.date ? 'Invalidation hit' : 'Invalidation'}:</strong>{' '}
                  {r.invalidation.rule}
                  {r.invalidation.date
                    ? ` — printed ${r.invalidation.date} at ${r.invalidation.value}. The call was closed there.`
                    : ' — not hit.'}
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default function ScorecardPage() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let dead = false;
    fetch('/trade_idea_scores.json', { cache: 'no-cache' })
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((d) => { if (!dead) setData(d); })
      .catch((e) => { if (!dead) setErr(String(e.message || e)); });
    return () => { dead = true; };
  }, []);

  const s = data?.summary;
  const rows = useMemo(() => (Array.isArray(data?.scores) ? data.scores : []), [data]);

  return (
    /* `home-v12` is required, not decorative: cream-system.css declares the
       palette on that class, not on :root, so without it every token here
       falls back and the page renders off-brand. Same convention as
       DataFlowPage (`home-v12 data-v12`) and the other converted pages. */
    <main className="mt-main-wrap home-v12 sc-wrap">
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

          {s.stats_withheld ? (
            <p className="sc-withheld">
              <strong>No hit rate yet.</strong> {s.stats_withheld_reason}
            </p>
          ) : (
            <div className="sc-tiles">
              <div className="sc-tile"><span className="sc-tile-n">{s.hit_rate}%</span><span className="sc-tile-l">Hit rate</span></div>
              <div className="sc-tile"><span className="sc-tile-n">{fmt(s.mean_result, '%')}</span><span className="sc-tile-l">Mean result</span></div>
              <div className="sc-tile"><span className="sc-tile-n">{fmt(s.median_result, '%')}</span><span className="sc-tile-l">Median result</span></div>
              <div className="sc-tile"><span className="sc-tile-n">{s.closed_by_invalidation}</span><span className="sc-tile-l">Stopped out</span></div>
            </div>
          )}
        </>
      )}

      <section className="sc-list">
        {rows.map((r) => <Row key={r.id || r.date} r={r} />)}
        {data && !rows.length && <p className="sc-dim">No notes published yet.</p>}
      </section>

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
