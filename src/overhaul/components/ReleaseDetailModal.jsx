/* ReleaseDetailModal — what a release on the "Upcoming data" tile opens.

   Joe, 2026-09-10: clicking a release used to send the reader to the Macro
   Overview page — a generic destination that says nothing about the release
   they clicked. "It should open a modal that shows a chart of historical
   readings vs. expectations." So: the last three years of actual prints for
   the headline number the desk trades on release, and — where a free, public,
   NAMED forecaster covers it — that forecaster's nowcast for the print that
   has not landed yet, drawn one period to the right of the last print.

   Nothing here is street consensus (June 2026 decision: no paid vendor). A
   forecast is always labelled by its author — "Cleveland Fed nowcast",
   "Atlanta Fed GDPNow", "Fed funds futures" — never as "expectations".

   Same skin as the Brief and Trade Idea modals (.briefmodal): one look for
   everything Home opens in place. Drill-downs are not destinations (9.16). */

import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import IdeaChart from './IdeaChart';
import FreshnessChip from './FreshnessChip';
import useEconReleaseHistory from '../lib/useEconReleaseHistory';
import ImpactMark, { IMPACT_WORD } from './ImpactMark';

const HISTORY_ELEMENT = 'econ_release_history';

function fmtVal(v, dec) {
  if (v == null || !Number.isFinite(v)) return '—';
  return v.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}
function signed(v, dec) {
  if (v == null || !Number.isFinite(v)) return '—';
  const r = Number(v.toFixed(dec));
  return `${r > 0 ? '+' : r < 0 ? '−' : ''}${fmtVal(Math.abs(r), dec)}`;
}
function longDate(iso) {
  if (!iso) return '';
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00Z`);
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });
}
function shortDate(iso) {
  if (!iso) return '';
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00Z`);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}
/* Points are dated by the PERIOD they describe (FRED's convention), so the
   label names the period, not the day: "Jul 2026", "Q2 2026", the week ending
   date for a weekly series, the day itself for a daily one. */
function periodLabel(iso, freq) {
  if (!iso) return '';
  const d = new Date(`${iso}T00:00:00Z`);
  if (freq === 'M') return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
  if (freq === 'Q') return `Q${Math.floor(d.getUTCMonth() / 3) + 1} ${d.getUTCFullYear()}`;
  if (freq === 'W') return `week ending ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}`;
  return shortDate(iso);
}
/* Units: "%" and "K"/"M" sit tight against the figure; a currency unit gets a
   space ("−88.6 $bn"). A CHANGE in a percentage is quoted in percentage points. */
function unitSuffix(unit) {
  if (!unit) return '';
  return unit.startsWith('$') ? ` ${unit}` : unit;
}
function changeUnit(unit) {
  return unit.trim() === '%' ? 'pp' : unit;
}

function Stat({ k, v, sub }) {
  return (
    <div className="idea-fact">
      <span className="k">{k}</span>
      <span className="v">{v}</span>
      {sub && <span className="rel-sub">{sub}</span>}
    </div>
  );
}

function MeasurePanel({ measure }) {
  const pts = useMemo(
    () => (measure.points || []).filter((p) => Array.isArray(p) && Number.isFinite(Number(p[1]))).map((p) => [p[0], Number(p[1])]),
    [measure],
  );
  const dec = measure.decimals ?? 1;
  const unit = unitSuffix(measure.unit || '');
  const n = pts.length;
  const last = n ? pts[n - 1] : null;
  // For a daily series (the effective fed funds rate) the day-over-day change
  // is noise; the number that matters is the last MOVE — the most recent
  // observation that differs from today's by a step, and when it happened.
  const daily = measure.frequency === 'D';
  const [prev, movedOn] = useMemo(() => {
    if (n < 2) return [null, null];
    if (!daily) return [pts[n - 2], null];
    const lastV = pts[n - 1][1];
    for (let i = n - 2; i >= 0; i -= 1) {
      if (Math.abs(pts[i][1] - lastV) >= 0.1) return [pts[i], pts[i + 1][0]];   // the first day at the new level
    }
    return [pts[0], null];
  }, [pts, n, daily]);
  const change = last && prev ? last[1] - prev[1] : null;
  const vals = pts.map((p) => p[1]);
  const lo = n ? Math.min(...vals) : null;
  const hi = n ? Math.max(...vals) : null;
  // Share of the OTHER prints in the window that sit below the latest one —
  // a rank the reader can check against the table, not a model output.
  const below = last && n > 1 ? vals.slice(0, -1).filter((v) => v < last[1]).length / (n - 1) : null;
  const nc = measure.nowcast;
  const ncDetail = nc?.detail;

  if (n < 2) {
    return (
      <p className="secnote">
        The series behind this release did not load, so nothing is drawn rather than drawn wrong.
      </p>
    );
  }

  const spec = {
    title: measure.label,
    unit,   // already spaced for a currency unit
    decimals: dec,
    window: 'full',
    zero_rule: measure.transform !== 'level',
    source: `${measure.source || ''}${measure.as_of ? ` · series updated ${shortDate(measure.as_of)}` : ''}`,
  };
  const expected = nc ? { date: nc.period, value: nc.value, label: nc.short || 'forecast' } : null;

  return (
    <>
      <div className="rel-chart">
        <IdeaChart spec={spec} series={{ points: pts }} expected={expected} height={240} />
      </div>
      <div className="idea-modal-facts rel-facts">
        <Stat k="Last print" v={`${fmtVal(last[1], dec)}${unit}`} sub={periodLabel(last[0], measure.frequency)} />
        <Stat k={daily ? 'Last move' : 'Change from prior'} v={`${signed(change, dec)}${changeUnit(unit)}`}
              sub={daily
                ? `from ${fmtVal(prev[1], dec)}${unit}${movedOn ? `, on ${shortDate(movedOn)}` : ''}`
                : `prior ${fmtVal(prev[1], dec)}${unit}, ${periodLabel(prev[0], measure.frequency)}`} />
        <Stat k="Range, last 3 years" v={`${fmtVal(lo, dec)} to ${fmtVal(hi, dec)}${unit}`}
              sub={below != null ? `latest is above ${Math.round(below * 100)}% of ${n} ${daily ? 'readings' : 'prints'}` : null} />
        {nc ? (
          <Stat k={nc.label} v={`${fmtVal(nc.value, dec)}${unit}`}
                sub={ncDetail && Number.isFinite(ncDetail.priced_bp)
                  ? `${signed(ncDetail.priced_bp, 0)}bp priced vs the current ${fmtVal(ncDetail.effr, 2)}% · as of ${shortDate(nc.as_of)}`
                  : `for ${periodLabel(nc.period, measure.frequency)} · as of ${shortDate(nc.as_of)}`} />
        ) : (
          <Stat k="Forecast" v="—" sub="No free public forecaster covers this number; street consensus is not shown." />
        )}
      </div>
      {nc && (
        <p className="rel-ncsrc">{nc.source}</p>
      )}
    </>
  );
}

/* Market impact — an event study, shown as numbers the reader can check.
   For each market: the mean absolute one-day move on this release's sessions
   against an ordinary session, the ratio, and whether that ratio is
   distinguishable from luck. Then the textbook direction for the category —
   which is a definition, never a forecast. */
function ImpactPanel({ impact }) {
  const ms = Object.values(impact.markets || {});
  const fmtMove = (v, unit) => (v == null ? '—' : unit === 'bp' ? `${v.toFixed(1)}bp` : `${v.toFixed(2)}%`);
  return (
    <div className="rel-impact">
      <div className="briefmodal-sec rel-impact-head">
        <span>Market impact · {IMPACT_WORD[impact.rating]}</span>
        <ImpactMark impact={impact} />
      </div>
      {impact.rating === 'shared' ? (
        <p className="rel-impact-note">
          This report lands in the same session as {impact.shared_with} on {impact.n_all_days} of {impact.n_all_days} occasions in the last three years, so its own effect on markets cannot be separated from that release&rsquo;s.
        </p>
      ) : (
        <>
          <div className="idea-modal-facts rel-facts rel-impact-facts">
            {ms.map((m) => (
              <div className="idea-fact" key={m.label}>
                <span className="k">{m.label}</span>
                <span className="v">{m.ratio == null ? '—' : `${m.ratio.toFixed(2)}× an ordinary session`}</span>
                <span className="rel-sub">
                  {m.ratio == null
                    ? `too few sessions to measure (${m.n})`
                    : `${fmtMove(m.release_day, m.unit)} on release days vs ${fmtMove(m.typical_day, m.unit)} typical${m.significant ? '' : ' · not distinguishable from an ordinary day'}`}
                </span>
              </div>
            ))}
          </div>
          <p className="rel-impact-note">
            Measured over {impact.n_days} release sessions since {new Date(`${impact.window_from}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })}
            {impact.n_all_days > impact.n_days ? `, leaving out the ${impact.n_all_days - impact.n_days} that shared a session with a more important release` : ''}.
            Close-to-prior-close moves; a release after the bell is credited to the next session.
          </p>
        </>
      )}
      {impact.direction && <p className="rel-impact-dir"><b>Direction.</b> {impact.direction}</p>}
    </div>
  );
}

export default function ReleaseDetailModal({ event, onClose }) {
  const open = !!event;
  const { data, failed, loading } = useEconReleaseHistory(open);
  const [which, setWhich] = useState(0);

  useEffect(() => {
    const k = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', k);
    const prevOverflow = document.body.style.overflow;
    if (open) document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', k); document.body.style.overflow = prevOverflow; };
  }, [onClose, open]);
  useEffect(() => { setWhich(0); }, [event?.name]);

  const target = (typeof document !== 'undefined'
    && (document.querySelector('.mt-overhaul') || document.body)) || null;
  if (!event || !target) return null;

  const entry = data?.series?.[event.name] || null;
  const measures = entry?.measures || [];
  const measure = measures[Math.min(which, Math.max(0, measures.length - 1))] || null;

  return createPortal(
    <div onClick={onClose} className="home-v12 briefmodal-veil">
      <div onClick={(e) => e.stopPropagation()} className="briefmodal rel-modal" role="dialog" aria-label={event.name}>
        <button type="button" className="briefmodal-x" onClick={onClose} aria-label="Close">×</button>
        <div className="eyebrow2">
          <span className="dot" />
          {event.category || 'Release'} · {longDate(event.date)}{event.time_et ? ` · ${event.time_et} ET` : ''}
        </div>
        <h2 className="briefmodal-h">{event.name}</h2>
        {event.blurb && <p className="rel-blurb">{event.blurb}</p>}

        {measures.length > 1 && (
          <div className="rel-pills" role="tablist">
            {measures.map((m, i) => (
              <button key={m.label} type="button" role="tab" aria-selected={i === which}
                      className={`rel-pill${i === which ? ' is-on' : ''}`} onClick={() => setWhich(i)}>
                {m.label}
              </button>
            ))}
          </div>
        )}

        {loading && <p className="secnote">Loading three years of prints…</p>}
        {failed && <p className="secnote">The release history did not load. It rebuilds twice a day alongside the calendar.</p>}
        {data && !entry && (
          <p className="secnote">No history is held for this release yet.</p>
        )}
        {data && entry && measures.length === 0 && (
          <p className="secnote">
            No free public series describes this release&rsquo;s headline number, so no history is drawn for it.
          </p>
        )}
        {measure && <MeasurePanel measure={measure} />}
        {entry?.impact?.rating && <ImpactPanel impact={entry.impact} />}

        <p className="rel-foot">
          <span className="rel-footl">
            <FreshnessChip elementId={HISTORY_ELEMENT} variant="pill" label="Release history" />
          </span>
          <span className="rel-footr">
            Actual prints are the current published values, revisions included. No street consensus is shown; every forecast names its author.
          </span>
        </p>
      </div>
    </div>,
    target,
  );
}
