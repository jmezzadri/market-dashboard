/* ConvictionEventsPanel — the Conviction Events desk: the whole body of the
   Scanner page (Joe 2026-08-11). The page used to sit three panels side by
   side as visual equals while only one of them fed the Paper book; the two
   idea scanners (Power Trend Momentum, RSI Divergence) were deleted from the
   site and this desk took the full width.

   Two panels, one question — what is the book seeing and doing today?

     1. TODAY'S EVENTS (hero) — every ce_events row for the latest filing
        date, ranked by buy total. The action the engine took renders as a
        plain-English chip and, for every skip, the reason renders INLINE
        beside it: the reject reasons are the most interesting content on
        the page, so they are never hidden behind a hover.
     2. RECENT EVENTS — the prior days' rows, grouped by filing date, newest
        first, capped so the desk shows the flow over time without becoming
        an archive.

   Data: ce_events via the shared useCeEvents hook — the SAME read the Paper
   page's event ledger uses, so the two surfaces can never disagree on an
   event (LESSONS 2026-06-12b). Reasons are translated to plain English by
   the shared ceReasonText (one translator, both surfaces).

   Degrade contract: ce_events will not resolve until the engine cutover —
   the read fails quietly and the desk renders "Awaiting today's events",
   never an error panel. When the feed resolves but no purchase cleared the
   $250,000 bar today, the desk says so in words rather than rendering an
   empty table. Anatomy is the existing cockpit vocabulary — .sc-tablecard
   shell, .sc-kicker / .sc-paneltitle / .sc-rule header, .sc-scanmeta chip
   line, the shared .sc-inset / .sc-insetscroll / .sc-table surface. Any
   tooltip is the instant CSS `data-tip` pattern, never the native title
   attribute (LESSONS 6.13). */

import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import FreshnessChip from './FreshnessChip';
import {
  useCeEvents,
  ceActionMeta,
  ceReasonText,
  ceInsiderNames,
} from '../../hooks/useCeEvents';

// How many prior-day rows the recent-history panel keeps. The desk shows the
// flow over time; the full ledger lives on the Paper page.
const HISTORY_MAX_ROWS = 30;

const MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtDay = (iso) => {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${MO[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}` : '—';
};
const fmtUsd = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  return `$${Math.round(n).toLocaleString('en-US')}`;
};

// Today in New York, as YYYY-MM-DD, computed at render — the filing dates in
// the ledger are exchange dates, and no date on this site is hardcoded
// (LESSONS 4.11).
function etTodayIso() {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date());
  } catch (e) {
    return new Date().toISOString().slice(0, 10);
  }
}

// The one sentence a reader needs for a skip. The engine's own reason wins;
// the generic lines below only fill in when the ledger left the column empty.
function reasonFor(r) {
  if (r.action === 'entered') return null;
  const written = ceReasonText(r.gate_fail_reason);
  if (written) return written;
  if (r.action === 'skipped_dup') return 'The book already held this name.';
  if (r.action === 'skipped_full') {
    return 'The book could not fund a full position when this event qualified, or was already at its 13-position ceiling.';
  }
  return null;
}

/* ── one event row — identical columns in both panels ─────────────────────── */

function EventRow({ row, onOpenTicker }) {
  const meta = ceActionMeta(row.action);
  const names = ceInsiderNames(row.insider_names);
  const n = row.n_insiders != null ? Number(row.n_insiders) : (names.length || null);
  const why = reasonFor(row);
  const whoLabel = names.length
    ? `${names[0]}${names.length > 1 ? ` +${names.length - 1}` : ''}`
    : '—';

  return (
    <tr className="sc-trow" onClick={() => onOpenTicker(row.ticker)}>
      <td>
        <button
          type="button"
          className="sc-tk"
          onClick={(e) => { e.stopPropagation(); onOpenTicker(row.ticker); }}
        >
          <b>{row.ticker}</b>
        </button>
      </td>
      <td className="ce-who">
        {names.length > 1
          ? <span className="ce-tip ce-name" data-tip={names.join(' · ')}>{whoLabel}</span>
          : <span className="ce-name">{whoLabel}</span>}
      </td>
      <td className="num">{fmtUsd(row.total_usd)}</td>
      <td className="num">{n == null ? '—' : n}</td>
      <td className="ce-act">
        <span className={`ce-chip ${meta.tone}`}>{meta.label}</span>
        {why ? <span className="ce-why">{why}</span> : null}
      </td>
    </tr>
  );
}

function EventHead() {
  return (
    <thead>
      <tr>
        <th>Ticker</th>
        <th>Insider who bought</th>
        <th className="num-h">Buy total</th>
        <th className="num-h">Insiders</th>
        <th>What the book did</th>
      </tr>
    </thead>
  );
}

/* ── Panel 1 · today's events ─────────────────────────────────────────────── */

function TodaysEvents({ rows, loading, latest, onOpenTicker, onMethodology }) {
  const today = etTodayIso();
  const isToday = latest === today;
  const dayRows = useMemo(() => {
    const day = rows.filter((r) => r.filing_date === latest);
    day.sort((a, b) => (Number(b.total_usd) || 0) - (Number(a.total_usd) || 0));
    return day;
  }, [rows, latest]);

  const entered = dayRows.filter((r) => r.action === 'entered').length;

  return (
    <section className="wrap ce-sec">
      <div className="sc-tablecard">
        <div className="sc-panelhead">
          <div>
            <div className="sc-kicker">
              {latest ? `${isToday ? 'Today' : 'Most recent filing day'} · ${fmtDay(latest)}` : 'Book feed · Daily events'}
            </div>
            <h2 className="sc-paneltitle">Today&rsquo;s events</h2>
            <div className="sc-rule">
              Every insider purchase that cleared $250,000 in one name on that day, ranked by the
              dollars bought — with the action the engine took on each, and the reason beside
              every one it did not buy.
            </div>
            <div className="sc-scanmeta">
              <FreshnessChip
                elementId="portfolio.ce-events-daily"
                variant="dot"
                fallback={{ asOfIso: latest, calendar: 'nyse-trading-day' }}
              />
              <span>
                {dayRows.length
                  ? `${dayRows.length} event${dayRows.length > 1 ? 's' : ''} · ${entered} bought`
                  : 'Awaiting today’s events'}
              </span>
              <button type="button" className="sc-metalink" onClick={onMethodology}>
                Methodology &rarr;
              </button>
            </div>
          </div>
        </div>

        {loading ? (
          <div className="sc-loading">Loading today&rsquo;s events…</div>
        ) : dayRows.length === 0 ? (
          <div className="sc-loading">
            Awaiting today&rsquo;s events — insider purchases appear here as the engine records
            them, with the action it took on each.
          </div>
        ) : (
          <>
            {!isToday && (
              <div className="ce-note">
                No insider purchase cleared $250,000 today. These are the events of the most recent
                day the engine recorded, {fmtDay(latest)}.
              </div>
            )}
            <div className="sc-inset">
              <div className="sc-insetscroll">
                <table className="sc-table ce-min">
                  <EventHead />
                  <tbody>
                    {dayRows.map((r, i) => (
                      <EventRow key={`${r.ticker}-${r.filing_date}-${i}`} row={r} onOpenTicker={onOpenTicker} />
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </section>
  );
}

/* ── Panel 2 · the prior days ─────────────────────────────────────────────── */

function RecentEvents({ rows, latest, onOpenTicker }) {
  const days = useMemo(() => {
    const prior = rows.filter((r) => r.filing_date !== latest).slice(0, HISTORY_MAX_ROWS);
    const out = [];
    for (const r of prior) {
      const last = out[out.length - 1];
      if (last && last.date === r.filing_date) last.rows.push(r);
      else out.push({ date: r.filing_date, rows: [r] });
    }
    for (const d of out) d.rows.sort((a, b) => (Number(b.total_usd) || 0) - (Number(a.total_usd) || 0));
    return out;
  }, [rows, latest]);

  if (!days.length) return null;
  const shown = days.reduce((n, d) => n + d.rows.length, 0);

  return (
    <section className="wrap ce-sec">
      <div className="sc-tablecard">
        <div className="sc-panelhead">
          <div>
            <div className="sc-kicker">Prior days</div>
            <h2 className="sc-paneltitle">Recent events</h2>
            <div className="sc-rule">
              The same columns, day by day, newest first — the flow the book has been seeing.
            </div>
            <div className="sc-scanmeta">
              <FreshnessChip
                elementId="portfolio.ce-events-daily"
                variant="dot"
                fallback={{ asOfIso: days[0].date, calendar: 'nyse-trading-day' }}
              />
              <span>{shown} event{shown > 1 ? 's' : ''} across {days.length} day{days.length > 1 ? 's' : ''}</span>
            </div>
          </div>
        </div>
        <div className="sc-inset">
          <div className="sc-insetscroll">
            <table className="sc-table ce-min">
              <EventHead />
              <tbody>
                {days.map((d) => (
                  <React.Fragment key={d.date}>
                    <tr className="ce-grouprow">
                      <td colSpan={5}>
                        {fmtDay(d.date)} · {d.rows.length} event{d.rows.length > 1 ? 's' : ''}
                      </td>
                    </tr>
                    {d.rows.map((r, i) => (
                      <EventRow key={`${r.ticker}-${r.filing_date}-${i}`} row={r} onOpenTicker={onOpenTicker} />
                    ))}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="sc-tilefoot">
          The {HISTORY_MAX_ROWS} most recent events before {fmtDay(latest)}. The full ledger, and
          what each entry did after it was bought, sit on the Paper page.
        </div>
      </div>
    </section>
  );
}

/* ── the desk ─────────────────────────────────────────────────────────────── */

export default function ConvictionEventsPanel() {
  const { rows, loading } = useCeEvents(60);
  const navigate = useNavigate();
  const latest = rows.length ? rows[0].filing_date : null;
  const openTicker = (t) => { if (t) navigate(`/ticker/${t}`); };

  return (
    <>
      <TodaysEvents
        rows={rows}
        loading={loading}
        latest={latest}
        onOpenTicker={openTicker}
        onMethodology={() => navigate('/methodology#scanner')}
      />
      {!loading && rows.length > 0 && (
        <RecentEvents rows={rows} latest={latest} onOpenTicker={openTicker} />
      )}
    </>
  );
}
