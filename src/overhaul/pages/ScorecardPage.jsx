/* ScorecardPage — "Macro Scorecard": how every published trade call has done,
   held together as one portfolio.

   Joe, 2026-08-17: "Can we somehow track our trade ideas and how they
   performed? I'd like to start collecting historical data on our calls."

   Joe, 2026-10-09: "I want to know performance of our calls overall ... whats
   the performance of closed trades (i.e., realized gain/loss) and whats the
   performance of open trades (unrealized) ... we need to somehow show
   annualized returns ... I dont even know what the total return is." And on
   the look: "Should be professional asset manager..."

   So the page is laid out like a fund performance page, designed with the UX
   Designer and the Senior Quant:
     1. key facts (as of, inception, benchmark, positions)
     2. performance: portfolio / benchmark / excess, since inception and annualized
     3. attribution: realized + unrealized = total return
     4. cumulative performance chart
     5. open positions, 6. closed positions, 7. methodology

   WORDS (Joe, same day): standard finance terms, used exactly — Total return,
   Annualized, Since inception, Realized, Unrealized, Benchmark, Excess return.
   Not paraphrases of them ("at a yearly pace"), and not internal shorthand
   either ("invalidated", "thesis broken", "marked to").

   This component RENDERS public/trade_idea_scores.json and computes nothing.
   Every figure is produced by scripts/score_trade_ideas.py: the portfolio in
   `summary.portfolio`, its daily line in `portfolio_line`, and each row's
   figures on the portfolio's as-of date in `scores[].book`. The page only
   formats. A page that did its own arithmetic could quietly disagree with the
   scorer, and then there would be two records.

   Still true from earlier rounds: every call is listed, a stopped call stays
   at its stop, no hit rate is shown (the scorer withholds it below 10 closed
   calls), and the note behind every row opens from the row. */

import React, { useEffect, useMemo, useRef, useState } from 'react';

// The SAME note reader the Home tile uses, so the scorecard never carries a
// second version of a note that could drift from the published one.
import TradeIdeaNoteModal from '../components/TradeIdeaNote';
import useIndicatorSeries from '../lib/useIndicatorSeries';

// cream-system supplies the palette on .home-v12; scorecard-v12 binds it into
// .sc-wrap; v13 + pages-v13 are the site-wide v13 layer; scorecard-v13 is this
// page's own layout and is loaded last.
import '../styles/cream-system.css';
import '../styles/scorecard-v12.css';
import '../styles/v13.css';
import '../styles/pages-v13.css';
import '../styles/scorecard-v13.css';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function parts(iso) { const [y, m, d] = String(iso || '').slice(0, 10).split('-').map(Number); return y && m && d ? { y, m, d } : null; }
/* "Sep 21, 2026" in tables, "September 21, 2026" in the key facts. */
function dShort(iso) { const p = parts(iso); return p ? `${MONTHS[p.m - 1].slice(0, 3)} ${p.d}, ${p.y}` : '—'; }
function dLong(iso) { const p = parts(iso); return p ? `${MONTHS[p.m - 1]} ${p.d}, ${p.y}` : '—'; }
function dTick(iso) { const p = parts(iso); return p ? `${MONTHS[p.m - 1].slice(0, 3)} ${p.d}` : ''; }

/* THE number format: one decimal, explicit + on gains, a true minus sign
   (U+2212) on losses, no sign on zero, percent sign attached. */
function pct(v) {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return '—';
  const a = Math.abs(Number(v)).toFixed(1);
  return `${a === '0.0' ? '' : Number(v) > 0 ? '+' : '−'}${a}%`;
}
function tone(v) {
  if (v === null || v === undefined || Math.abs(Number(v)) < 0.05) return 'sc-flat';
  return Number(v) > 0 ? 'sc-up' : 'sc-down';
}

const KIND_LABEL = {
  equity: 'Equities', 'single-name': 'Equities', rates: 'Fixed income', credit: 'Credit',
  fx: 'Currencies', commodity: 'Commodities', macro: 'Macro', 'cross-asset': 'Cross-asset',
};
/* The weekly review's verdict, in the reader's words. */
const VERDICT_LABEL = { intact: 'On track', weakened: 'Weakened', broken: 'No longer holds' };

/* Width AND height of the chart box in real pixels, so one SVG unit is one
   CSS pixel and the type inside the chart stays on the type scale (9.20). */
function useBox() {
  const ref = useRef(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const set = () => { const r = el.getBoundingClientRect(); setBox({ w: Math.round(r.width), h: Math.round(r.height) }); };
    set();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, box];
}

/* Cumulative total return, portfolio against benchmark. Rows of `line` are
   [date, portfolio %, benchmark %, positions open], authored by the scorer. */
function PerformanceChart({ line, benchmarkLabel }) {
  const [ref, { w: W, h: H }] = useBox();
  const [hov, setHov] = useState(null);
  const n = line.length;
  const last = line[n - 1];
  const padL = 44; const padR = 58; const padT = 10; const padB = 26;
  let body = null;
  let tip = null;
  if (W > 0 && H > 0 && n > 1) {
    const vals = line.flatMap((r) => [r[1], r[2]]);
    const lo = Math.min(-1, Math.floor(Math.min(...vals)));
    const hi = Math.max(1, Math.ceil(Math.max(...vals)));
    const step = Math.max(1, Math.ceil((hi - lo) / 8));
    const x = (i) => padL + (i / (n - 1)) * (W - padL - padR);
    const y = (v) => padT + (1 - (v - lo) / (hi - lo)) * (H - padT - padB);
    const path = (k) => line.map((r, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(r[k]).toFixed(1)}`).join('');
    const grid = [];
    for (let t = Math.ceil(lo / step) * step; t <= hi; t += step) grid.push(t);
    // x ticks: first day, the first trading day of each month, last day. A
    // month tick too close to either end is dropped so labels never collide.
    let ticks = [];
    for (let i = 1; i < n - 1; i += 1) if (line[i][0].slice(5, 7) !== line[i - 1][0].slice(5, 7)) ticks.push(i);
    const room = Math.max(1, Math.floor((W - padL - padR) / 90));
    if (ticks.length > room) { const every = Math.ceil(ticks.length / room); ticks = ticks.filter((_, j) => j % every === 0); }
    ticks = ticks.filter((i) => x(i) - x(0) >= 84 && x(n - 1) - x(i) >= 84);
    const allTicks = [0, ...ticks, n - 1];
    // end labels, kept at least 16px apart
    let yp = y(last[1]); let yb = y(last[2]);
    if (Math.abs(yp - yb) < 16) { const mid = (yp + yb) / 2; const up = yp <= yb ? -1 : 1; yp = mid + up * 8; yb = mid - up * 8; }
    body = (
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-hidden="true">
        {grid.map((t) => (
          <g key={t}>
            <line className={t === 0 ? 'sc-zero' : 'sc-grid'} x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} />
            <text x={padL - 8} y={y(t) + 4} textAnchor="end">{t === 0 ? '0%' : `${t > 0 ? '+' : '−'}${Math.abs(t)}%`}</text>
          </g>
        ))}
        {allTicks.map((i, j) => (
          <text key={i} x={x(i)} y={H - 6} textAnchor={j === 0 ? 'start' : j === allTicks.length - 1 ? 'end' : 'middle'}>{dTick(line[i][0])}</text>
        ))}
        <path className="sc-l-bench" d={path(2)} />
        <path className="sc-l-port" d={path(1)} />
        <text className="sc-end" x={W - padR + 8} y={yp + 4} style={{ fill: 'var(--gold-deep)' }}>{pct(last[1])}</text>
        <text className="sc-end" x={W - padR + 8} y={yb + 4} style={{ fill: 'var(--ink-soft)' }}>{pct(last[2])}</text>
        {hov != null && (
          <g>
            <line x1={x(hov)} x2={x(hov)} y1={padT} y2={H - padB} stroke="var(--v13-ink-3)" strokeWidth="1" />
            <circle cx={x(hov)} cy={y(line[hov][2])} r="4" fill="var(--ink-soft)" stroke="var(--lg-panel-on)" strokeWidth="2" />
            <circle cx={x(hov)} cy={y(line[hov][1])} r="4" fill="var(--gold-deep)" stroke="var(--lg-panel-on)" strokeWidth="2" />
          </g>
        )}
      </svg>
    );
    if (hov != null) {
      const r = line[hov]; const leftPct = (x(hov) / W) * 100; const flip = leftPct > 55;
      tip = (
        <div className="sc-tip" style={flip ? { right: `calc(${100 - leftPct}% + 12px)` } : { left: `calc(${leftPct}% + 12px)` }}>
          <div className="d">{dShort(r[0])} · {r[3]} {r[3] === 1 ? 'position' : 'positions'} open</div>
          <div className="r"><i className="sc-key sc-key--port" /><span>Portfolio</span><b className="num">{pct(r[1])}</b></div>
          <div className="r"><i className="sc-key sc-key--bench" /><span>{benchmarkLabel}</span><b className="num">{pct(r[2])}</b></div>
        </div>
      );
    }
  }
  const idx = (e) => {
    const r = ref.current.getBoundingClientRect();
    return Math.max(0, Math.min(n - 1, Math.round(((e.clientX - r.left - padL) / (W - padL - padR)) * (n - 1))));
  };
  const onKey = (e) => {
    if (e.key === 'ArrowLeft') { setHov((h) => Math.max(0, (h ?? n - 1) - 1)); e.preventDefault(); }
    if (e.key === 'ArrowRight') { setHov((h) => Math.min(n - 1, (h ?? 0) + 1)); e.preventDefault(); }
    if (e.key === 'Escape') setHov(null);
  };
  return (
    <div
      className="sc-chart"
      ref={ref}
      tabIndex={0}
      role="img"
      aria-label={`Line chart of cumulative total return since inception. Portfolio ends at ${pct(last[1])}. ${benchmarkLabel} ends at ${pct(last[2])}.`}
      onPointerMove={(e) => { if (W > 0) setHov(idx(e)); }}
      onPointerLeave={() => setHov(null)}
      onKeyDown={onKey}
    >
      {body}
      {tip}
    </div>
  );
}

/* One position, one row. On a phone the row keeps trade / return / benchmark /
   excess and folds everything else into the line under the trade name. */
function PositionRow({ r, idea, review, isOpen, onOpenNote }) {
  const b = r.book || {};
  const ret = b.return_pct ?? r.mark;
  const bench = b.benchmark_pct ?? r.benchmark?.move ?? null;
  const exc = b.excess_pct ?? r.benchmark?.difference ?? null;
  const ctb = b.contribution_pct ?? null;
  const days = b.days_held ?? r.days_held ?? null;
  const second = isOpen ? r.target_date : (r.close_date || r.mark_date);
  const kind = KIND_LABEL[r.kind] || r.kind || '—';
  const reviewTxt = review
    ? `${VERDICT_LABEL[review.verdict] || review.verdict} · ${dShort(review.review_date)}`
    : 'Not yet reviewed';
  const why = isOpen ? reviewTxt : (r.close_reason || '—');
  const open = () => { if (idea) onOpenNote(idea); };
  return (
    <tr className="sc-trow" onClick={open}>
      <td className="sc-tradecell">{r.trade_label || r.instrument || '—'}</td>
      <td className="sc-class hide-sm hide-md">{kind}</td>
      <td className="sc-date hide-sm">{dShort(r.entry_date)}</td>
      <td className="sc-date hide-sm">{dShort(second)}</td>
      <td className="num hide-sm hide-md">{days ?? '—'}</td>
      <td className={`num ${tone(ret)}`}>{pct(ret)}</td>
      <td className="num sc-bench">{pct(bench)}</td>
      <td className={`num ${tone(exc)}`}>{pct(exc)}</td>
      <td className={`num sc-ctb hide-sm ${tone(ctb)}`}>{pct(ctb)}</td>
      <td className="sc-reviewcell hide-sm">{why}</td>
      <td className="hide-sm">
        {idea && (
          <button type="button" className="sc-notebtn" onClick={(e) => { e.stopPropagation(); onOpenNote(idea); }}>Note</button>
        )}
      </td>
      <td className="sc-mcell">
        {kind} · {dShort(r.entry_date)} to {dShort(second)} · {days ?? '—'} days held<br />
        Contribution <span className={`num ${tone(ctb)}`}>{pct(ctb)}</span> · {isOpen ? `Last review: ${reviewTxt}` : `Reason closed: ${String(why).toLowerCase()}`}
        {idea && (<><br /><a href="#note" onClick={(e) => { e.preventDefault(); e.stopPropagation(); onOpenNote(idea); }}>View note</a></>)}
      </td>
    </tr>
  );
}

function PositionsTable({ rows, isOpen, noteById, reviewById, onOpenNote }) {
  return (
    <table className="sc-table">
      <thead>
        <tr>
          <th>Trade</th>
          <th className="c-class hide-sm hide-md">Asset class</th>
          <th className="c-date hide-sm">Opened</th>
          <th className="c-date hide-sm">{isOpen ? 'Planned close' : 'Closed'}</th>
          <th className="num c-days hide-sm hide-md">Days held</th>
          <th className="num c-num">Return</th>
          <th className="num c-num">S&amp;P 500</th>
          <th className="num c-exc">Excess return</th>
          <th className="num c-ctb hide-sm">Contribution</th>
          <th className="c-why hide-sm">{isOpen ? 'Last review' : 'Reason closed'}</th>
          <th className="c-note hide-sm"><span aria-label="Note" /></th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <PositionRow
            key={r.id || r.date}
            r={r}
            idea={noteById.get(r.id)}
            review={reviewById.get(r.id)}
            isOpen={isOpen}
            onOpenNote={onOpenNote}
          />
        ))}
      </tbody>
    </table>
  );
}

export default function ScorecardPage() {
  const [data, setData] = useState(null);
  const [notes, setNotes] = useState(null);
  const [reviews, setReviews] = useState(null);
  const [openNote, setOpenNote] = useState(null);
  const [err, setErr] = useState(null);
  // The hook only loads the keys it is asked for, so gather every series any
  // note charts; otherwise every chart in a reopened note renders empty.
  const [chartKeys, setChartKeys] = useState([]);
  const { series: chartSeries } = useIndicatorSeries(chartKeys);

  useEffect(() => {
    let dead = false;
    fetch('/trade_idea_scores.json', { cache: 'no-cache' })
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((d) => { if (!dead) setData(d); })
      .catch((e) => { if (!dead) setErr(String(e.message || e)); });
    // The weekly review record. Optional: the page renders without it.
    fetch('/thesis_reviews.json', { cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!dead) setReviews(d); })
      .catch(() => { if (!dead) setReviews(null); });
    // The notes themselves — a separate fetch on purpose: the scorer knows
    // nothing about prose, and trade_ideas.json stays the one source of the
    // published text. The join happens here, by id.
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
  const p = s?.portfolio || null;
  const line = Array.isArray(data?.portfolio_line) ? data.portfolio_line : [];
  const rows = useMemo(() => (Array.isArray(data?.scores) ? data.scores : []), [data]);
  const openRows = useMemo(() => rows.filter((r) => r.status === 'open')
    .sort((a, b) => String(b.entry_date).localeCompare(String(a.entry_date))), [rows]);
  const closedRows = useMemo(() => rows.filter((r) => String(r.status || '').startsWith('closed'))
    .sort((a, b) => String(b.close_date || b.mark_date).localeCompare(String(a.close_date || a.mark_date))), [rows]);
  const otherRows = useMemo(() => rows.filter((r) => r.status === 'pending_entry' || r.status === 'unscoreable'), [rows]);
  const noteById = useMemo(() => {
    const m = new Map();
    (notes || []).forEach((n) => { if (n?.id) m.set(n.id, n); });
    return m;
  }, [notes]);
  // Latest verdict per note. The latest block covers the open calls; a call
  // closed by a broken verdict keeps that verdict from history.
  const reviewById = useMemo(() => {
    const m = new Map();
    const L = reviews?.latest;
    (reviews?.history || []).forEach((h) => (h.calls || []).forEach((c) => {
      if (c?.id && c.verdict === 'broken' && !m.has(c.id)) m.set(c.id, { ...c, review_date: h.review_date });
    }));
    (L?.calls || []).forEach((c) => { if (c?.id) m.set(c.id, { ...c, review_date: L.review_date }); });
    return m;
  }, [reviews]);

  const bench = p?.benchmark_label || 'S&P 500';
  const shortRecord = p ? p.calendar_days < 365 : false;

  return (
    /* `home-v12` is required: cream-system.css declares the palette on that
       class, so without it every token falls back and the page renders
       off-brand. `sc-pro` scopes this layout's stylesheet. */
    <main className="mt-main-wrap home-v12 v13 sc-wrap sc-pro">
      <header className="sc-head">
        <h1>Macro Scorecard</h1>
        <p className="sc-sub">Performance of every trade call MacroTilt has published, held together as one portfolio.</p>
        {p && (
          <dl className="sc-keyfacts">
            <div><dt>As of</dt><dd>{dLong(p.as_of)} close</dd></div>
            <div><dt>Inception</dt><dd>{dLong(p.inception)}</dd></div>
            <div><dt>Benchmark</dt><dd>{bench}</dd></div>
            <div><dt>Positions</dt><dd>{p.positions_open} open, {p.positions_closed} closed</dd></div>
          </dl>
        )}
      </header>

      {err && <p className="sc-err">Could not load the scorecard ({err}).</p>}
      {!data && !err && <p className="sc-dim">Loading…</p>}

      {p && (
        <div className="sc-top">
          <section className="sc-card" aria-labelledby="sc-h-perf">
            <div className="sc-cardhead"><h2 id="sc-h-perf">Performance</h2><span className="meta">Total return, %</span></div>
            <table className="sc-sum">
              <thead>
                <tr>
                  <th aria-label="Series" />
                  <th>Since inception<small>{dShort(p.inception)}</small></th>
                  <th>Annualized{shortRecord && <sup>1</sup>}<small>&nbsp;</small></th>
                </tr>
              </thead>
              <tbody>
                <tr className="sc-lead">
                  <td>Portfolio</td>
                  <td className={`num ${tone(p.total_return_pct)}`}>{pct(p.total_return_pct)}</td>
                  <td className={`num ${tone(p.annualized_pct)}`}>{pct(p.annualized_pct)}</td>
                </tr>
                <tr className="sc-bench">
                  <td>Benchmark <span style={{ whiteSpace: 'nowrap' }}>({bench})</span></td>
                  <td className="num">{pct(p.benchmark_total_pct)}</td>
                  <td className="num">{pct(p.benchmark_annualized_pct)}</td>
                </tr>
                <tr className="sc-total">
                  <td>Excess return</td>
                  <td className={`num ${tone(p.excess_total_pct)}`}>{pct(p.excess_total_pct)}</td>
                  <td className={`num ${tone(p.excess_annualized_pct)}`}>{pct(p.excess_annualized_pct)}</td>
                </tr>
              </tbody>
            </table>
            {shortRecord && (
              <p className="sc-fn">
                <sup>1</sup>{' '}
                {p.annualized_pct == null
                  ? p.annualized_withheld_reason
                  : `Annualized from ${p.history_weeks} weeks of history. Figures for periods shorter than one year are indicative only and will change materially.`}
              </p>
            )}

            <div className="sc-cardhead"><h2>Attribution of total return</h2><span className="meta">Since inception</span></div>
            <table className="sc-sum">
              <thead><tr><th aria-label="Source" /><th>Positions</th><th>Contribution</th></tr></thead>
              <tbody>
                <tr>
                  <td>Realized <span className="q" style={{ whiteSpace: 'nowrap' }}>(closed positions)</span></td>
                  <td className="num">{p.positions_closed}</td>
                  <td className={`num ${tone(p.realized_contribution_pct)}`}>{pct(p.realized_contribution_pct)}</td>
                </tr>
                <tr>
                  <td>Unrealized <span className="q" style={{ whiteSpace: 'nowrap' }}>(open positions)</span></td>
                  <td className="num">{p.positions_open}</td>
                  <td className={`num ${tone(p.unrealized_contribution_pct)}`}>{pct(p.unrealized_contribution_pct)}</td>
                </tr>
                <tr className="sc-total">
                  <td>Total return</td>
                  <td className="num">{p.positions_open + p.positions_closed}</td>
                  <td className={`num ${tone(p.total_return_pct)}`}>{pct(p.total_return_pct)}</td>
                </tr>
              </tbody>
            </table>
          </section>

          {line.length > 1 && (
            <section className="sc-card" aria-labelledby="sc-h-chart">
              <div className="sc-cardhead">
                <h2 id="sc-h-chart">Cumulative performance</h2>
                <span className="meta">{dShort(p.inception)} – {dShort(p.as_of)} · daily closes</span>
              </div>
              <PerformanceChart line={line} benchmarkLabel={bench} />
              <div className="sc-legend">
                <span><i className="sc-key sc-key--port" />Portfolio</span>
                <span><i className="sc-key sc-key--bench" />Benchmark ({bench})</span>
              </div>
              <p className="sc-fn">Cumulative total return since inception, in percent. The portfolio is divided equally among the positions open each day.</p>
            </section>
          )}
        </div>
      )}

      {openRows.length > 0 && (
        <section className="sc-card" aria-labelledby="sc-h-open">
          <div className="sc-cardhead">
            <h2 id="sc-h-open">Open positions</h2>
            <span className="meta">{openRows.length} {openRows.length === 1 ? 'position' : 'positions'} · unrealized · returns will change</span>
          </div>
          <PositionsTable rows={openRows} isOpen noteById={noteById} reviewById={reviewById} onOpenNote={setOpenNote} />
        </section>
      )}

      {closedRows.length > 0 && (
        <section className="sc-card" aria-labelledby="sc-h-closed">
          <div className="sc-cardhead">
            <h2 id="sc-h-closed">Closed positions</h2>
            <span className="meta">{closedRows.length} {closedRows.length === 1 ? 'position' : 'positions'} · realized · returns are final</span>
          </div>
          <PositionsTable rows={closedRows} isOpen={false} noteById={noteById} reviewById={reviewById} onOpenNote={setOpenNote} />
        </section>
      )}

      {otherRows.length > 0 && (
        <section className="sc-card" aria-labelledby="sc-h-other">
          <div className="sc-cardhead"><h2 id="sc-h-other">Not yet in the portfolio</h2></div>
          {otherRows.map((r) => (
            <p className="sc-pending" key={r.id || r.date}>
              <strong>{r.title || r.instrument}</strong> ({dShort(r.date)}): {r.status === 'pending_entry' ? 'waiting for its first closing price.' : 'cannot be priced.'} {r.reason}
            </p>
          ))}
        </section>
      )}

      {data && !rows.length && <p className="sc-dim">No trade calls published yet.</p>}

      {p && (
        <section className="sc-notes" aria-labelledby="sc-h-notes">
          <h2 id="sc-h-notes">Methodology and disclosures</h2>
          <dl>
            <div>
              <dt>Portfolio</dt>
              <dd>A model portfolio that holds every published trade call from the day it is opened until the day it is closed. Each day the portfolio is divided equally among the positions open that day, which has been between {p.min_positions_held} and {p.max_positions_held}. It is not an account and no money is invested in it.</dd>
            </div>
            <div>
              <dt>Returns</dt>
              <dd>All returns are price returns in percent. They exclude dividends, interest, transaction costs and financing costs.</dd>
            </div>
            <div>
              <dt>Benchmark and excess return</dt>
              <dd>The benchmark is the {bench} price index. In the positions tables it is measured over the same days each position was held. Excess return is the return minus the benchmark return, calculated before rounding.</dd>
            </div>
            <div>
              <dt>Realized, unrealized and contribution</dt>
              <dd>Contribution is the part of the portfolio&rsquo;s total return that came from one position. Realized is the sum for closed positions and is final. Unrealized is the sum for open positions and will change. Contributions may not add up exactly because of rounding.</dd>
            </div>
            <div>
              <dt>Reason closed</dt>
              <dd>A position is closed when it reaches its planned close date, when the price reaches the exit level stated in the note, or when the weekly review finds that the reason for the trade no longer holds.</dd>
            </div>
            <div>
              <dt>Last review</dt>
              <dd>Every open position is reviewed once a week against the reasons given in its note. The table shows the latest result and its date.</dd>
            </div>
          </dl>
        </section>
      )}

      {openNote && (
        <TradeIdeaNoteModal idea={openNote} chartSeries={chartSeries} review={reviewById.get(openNote.id)} onClose={() => setOpenNote(null)} />
      )}
    </main>
  );
}
