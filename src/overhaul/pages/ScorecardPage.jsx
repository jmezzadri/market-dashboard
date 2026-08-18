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

function Row({ r, idea, onOpenNote }) {
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
          {/* The CALL first — before any number this page computed. The title
              is a hook; this is what was actually claimed, in the words it was
              published in. */}
          {idea?.call && <p className="sc-call">{idea.call}</p>}

          {idea && (
            <div className="sc-trade">
              {[['Buy', idea.the_trade?.buy], ['Sell to pay for it', idea.the_trade?.sell],
                ['Sell short', idea.the_trade?.short], ['Funded by', idea.the_trade?.funded_by],
                ['Why it was not obvious', idea.variant],
                ['The edge', idea.edge?.summary],
                ['Measured against', idea.edge?.backtest?.baseline]]
                .filter(([, v]) => v).map(([k, v]) => (
                  <div className="sc-tradefact" key={k}><span className="k">{k}</span><span className="v">{v}</span></div>
                ))}
            </div>
          )}

          {(r.status === 'pending_entry' || r.status === 'unscoreable') && (
            <p className="sc-reason">{r.reason}</p>
          )}

          {showMark && (
            <>
              {/* What the thing we said to BUY did, what the thing we said to
                  SELL did, and the net — Joe 2026-08-18: "We should show the
                  return of what we're saying to buy and what we're saying to
                  sell and the net return." Before this the page printed one
                  number off a pre-computed ratio and there was no way to see
                  which side was working. */}
              {r.legs?.length > 0 && (
                <table className="sc-legs">
                  <thead>
                    <tr><th>Leg</th><th className="num">Its own return</th><th className="num">Contribution</th></tr>
                  </thead>
                  <tbody>
                    {r.legs.map((l) => (
                      <tr key={l.series}>
                        <td>
                          <b>{l.side === 'short' ? 'Sell' : 'Buy'}</b> {l.label}
                          {l.measure === 'bond_return' && (
                            <span className="sc-dim"> · {l.maturity_years}y duration-priced</span>
                          )}
                        </td>
                        <td className={`num sc-${toneOf(l.return_pct)}`}>{fmt(l.return_pct, '%')}</td>
                        <td className={`num sc-${toneOf(l.contribution_pct)}`}>{fmt(l.contribution_pct, '%')}</td>
                      </tr>
                    ))}
                    <tr className="sc-legs-net">
                      <td>
                        Net at {r.sizing?.multiple != null ? `${Number(r.sizing.multiple).toFixed(2)}×` : '1×'}
                        {r.net_unlevered_pct != null && (
                          <span className="sc-dim"> · {fmt(r.net_unlevered_pct, '%')} unlevered</span>
                        )}
                      </td>
                      <td />
                      <td className={`num sc-${toneOf(r.mark)}`}>{fmt(r.mark, r.unit)}</td>
                    </tr>
                    {r.benchmark && (
                      <tr className="sc-legs-bm">
                        <td>{r.benchmark.label} <span className="sc-dim">· same window, passive</span></td>
                        <td className={`num sc-${toneOf(r.benchmark.move)}`}>{fmt(r.benchmark.move, '%')}</td>
                        <td className={`num sc-${toneOf(r.benchmark.difference)}`}>
                          {fmt(r.benchmark.difference, '%')}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              )}
              {r.single_leg_note && <p className="sc-legnote">{r.single_leg_note}</p>}
              {r.benchmark?.note && <p className="sc-legnote">{r.benchmark.note}</p>}

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
                <div>
                  <dt>Size</dt>
                  <dd>
                    {r.sizing?.multiple != null ? `${Number(r.sizing.multiple).toFixed(2)}×` : '—'}
                    {r.sizing?.spread_vol_pct != null && (
                      <span className="sc-dim">
                        {' '}· spread ran at {Number(r.sizing.spread_vol_pct).toFixed(1)}% vol,
                        sized to {Number(r.sizing.target_vol_pct).toFixed(0)}%
                      </span>
                    )}
                    {r.sizing?.reason && <span className="sc-dim"> · {r.sizing.reason}</span>}
                    {r.sizing?.clamp_reason && <span className="sc-dim"> · {r.sizing.clamp_reason}</span>}
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

          {idea ? (
            <p className="sc-readnote">
              <button type="button" className="sc-notebtn" onClick={() => onOpenNote(idea)}>
                Read the full note{idea.charts?.length ? ` · ${idea.charts.length} charts` : ''} &rarr;
              </button>
            </p>
          ) : (
            <p className="sc-reason">
              The published note for this call is no longer in trade_ideas.json, so the analysis behind it
              cannot be shown. The mark stands; the reasoning is missing.
            </p>
          )}
        </div>
      )}
    </div>
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
        {rows.map((r) => (
          <Row key={r.id || r.date} r={r} idea={noteById.get(r.id)} onOpenNote={setOpenNote} />
        ))}
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
