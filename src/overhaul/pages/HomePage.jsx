/* HomePage — the editorial front page (2026-10-28 redesign, from Joe's
   approved "MacroTilt Redesign" canvas: Main / Dark / Mobile boards).

   A newspaper front page: two rows, each split two-thirds and one-third,
   with a rule between the columns.
     Row 1 — Morning Brief (lead) | The Engine
     Row 2 — Trade Idea            | This Week's Data
   On a phone the sections stack Brief, Engine, Trade Idea, Data as white
   bands with an 8px gap.

   VISUAL REBUILD ONLY. Every feed, hook, link, modal and number is the one
   the cockpit used (2026-08-13 → 2026-10-27): the brief and its full-brief
   modal, the engine regime and its two meters (bands 116 / 124 and the
   3-month change in the 10-year, from the engine hook — never the brief's
   prose), the Trade Idea with its four-field block (Joe's standing rule,
   LESSONS 1.7), the release calendar with its detail and all-releases
   modals, and the indicator drill that opens in place (LESSONS 9.16).
   Nothing is hard-coded; a feed that has not loaded renders its honest empty
   state (LESSONS 4.9). Styling lives in styles/redesign.css. */

import { publishedLabel } from '../lib/publishedAt';
import React, { useMemo, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import useEngineRegime from '../lib/useEngineRegime';
import { stressGaugePct, yieldGaugePct, stressMessage } from '../lib/engineGauges';
import IndicatorDrillModal from '../components/IndicatorDrillModal';
import DetailModal from '../components/DetailModal';
import EngineTrackRecord from '../components/EngineTrackRecord';
import useMarketLevels from '../lib/useMarketLevels';
import ReleaseDetailModal from '../components/ReleaseDetailModal';
import useScrollLock from '../lib/useScrollLock';
import useModalEscape from '../lib/useModalEscape';
import ReleaseCalendarModal from '../components/ReleaseCalendarModal';
import ImpactMark from '../components/ImpactMark';
import useEconReleaseHistory from '../lib/useEconReleaseHistory';
import { nowET, isReleased, releaseResult } from '../lib/releaseStatus';
import useDailyBrief, { pickEdition, sameDayEditions, editionLabel } from '../lib/useDailyBrief';
import useEconCalendar from '../lib/useEconCalendar';
import useTradeIdea from '../lib/useTradeIdea';
import useTradeScores from '../lib/useTradeScores';
import { tradeSchedule, scheduleParts } from '../lib/tradeSchedule';
import useIndicatorSeries from '../lib/useIndicatorSeries';
import IdeaChart from '../components/IdeaChart';
import TradeIdeaNoteModal from '../components/TradeIdeaNote';
import { STRESS_THRESH, YIELD_THRESH } from '../lib/useEngineRegime';
// The modals keep the cockpit's own sheets (they carry the .home-v12 scope on
// their veil), so those sheets stay loaded here.
import '../styles/cream-system.css';
import '../styles/v13.css';
import '../styles/pages-v13.css';

/* ── format helpers (unchanged from the cockpit) ─────────────────────── */
function fmt(v, dec) {
  if (v == null || !Number.isFinite(v)) return '—';
  return v.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}
function Html({ html, tag = 'span', className }) {
  const T = tag;
  return <T className={className} dangerouslySetInnerHTML={{ __html: html || '' }} />;
}
function weekdayDate(iso) {
  if (!iso) return '';
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
}
/* The brief's label is fixed copy plus the time it was written, never a
   session word. The writer used to supply "Monday pre-market", and that label
   stayed on the page all day — at 9:42 on 2026-11-02 the tile still read
   PRE-MARKET with the market open, next to a 5am Brent quote the reader could
   not reconcile with Friday's close in the ticker. "written 5:41 am ET" is a
   fact that stays true after the open and tells the reader when every number
   in the brief was observed. A brief without a timestamp (written before this
   field existed) says only that it was written before the open, which every
   brief is.
   The first word is the edition's own name (2026-11-03): "Morning Brief" for
   daily_brief.json, otherwise the label the Midday Update or Market Close
   file carries — never "Morning Brief" over a later edition. */
function writtenAt(edition) {
  const ts = edition?.written_at ? new Date(edition.written_at) : null;
  if (!ts || !Number.isFinite(ts.getTime())) return '';
  const t = ts.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }).toLowerCase();
  return `written ${t} ET`;
}
function briefLabel(label, edition, briefDate, briefStale) {
  const written = writtenAt(edition) || 'written before the open';
  return `${label}${briefDate ? ` · ${briefDate}` : ''} · ${written}${briefStale ? ' · last session' : ''}`;
}
/* The tile's fact strip is scannable, not prose. The contract deliberately
   requires a FULL invalidation sentence (it has to be checkable), so the tile
   shows its first clause and the modal shows all of it. Never truncates
   mid-word, never adds an ellipsis to text that was already short enough. */
function firstClause(s, max = 82) {
  const t = String(s || '').trim();
  if (!t) return '';
  const stop = t.search(/(?<=\S)\s+[—–]\s+|\.\s/);
  const head = stop > 0 ? t.slice(0, stop).trim() : t;
  if (head.length <= max) return head;
  const cut = head.slice(0, max);
  return `${cut.slice(0, cut.lastIndexOf(' '))}…`;
}
/* One line from a long claim: cut at the first full stop, colon, semicolon or
   spaced dash. The full text lives in the modal (Joe, 2026-09-14). */
function tileLine(s, max = 150) {
  const t = String(s || '').trim();
  if (!t) return '';
  const stop = t.search(/(?<=\S)\s+[—–]\s+|[.:;](?=\s)/);
  const head = stop > 0 ? t.slice(0, stop).trim() : t;
  if (head.length > max) {
    const cut = head.slice(0, max);
    return `${cut.slice(0, cut.lastIndexOf(' '))}…`;
  }
  return head === t ? head : `${head}.`;
}

/* Modal pieces shared by the editions: a titled head/body list (the
   headlines, this afternoon, after the close, tomorrow) and the three
   section write-ups, rendered the same way whichever edition carries them. */
function HeadList({ title, items }) {
  if (!Array.isArray(items) || items.length === 0) return null;
  return (
    <>
      <p className="briefmodal-sec">{title}</p>
      <ul>{items.map((n, i) => (
        <li key={i}><b><Html html={n.head} /></b> — <Html html={n.body} /></li>
      ))}</ul>
    </>
  );
}
function BriefSections({ sections, go }) {
  return (sections || []).map((sec, i) => (
    <div key={i}>
      <p className="briefmodal-sec">{sec.title}</p>
      {Array.isArray(sec.bullets) && sec.bullets.length > 0
        ? <ul>{sec.bullets.map((bt, jx) => <li key={jx}><Html html={bt} /></li>)}</ul>
        : <Html tag="p" html={sec.prose} />}
      {sec.positioning && <p><b>Positioning</b> — {sec.positioning}</p>}
      {sec.single_name && (
        <p><b>Single name</b> — <a className="tklink" href={`/ticker/${sec.single_name.ticker}`} onClick={go(`/ticker/${sec.single_name.ticker}`)}>{sec.single_name.ticker} ↗</a> <Html html={sec.single_name.note} /></p>
      )}
    </div>
  ));
}

/* The two faint background blobs (Joe's board). One setting turns them off,
   kept in the same place the theme is kept. */
const AMBIENT_KEY = 'mt.overhaul.ambient';
function readAmbient() {
  try { return window.localStorage.getItem(AMBIENT_KEY) !== 'off'; } catch { return true; }
}

/* The number of stories on the front page. The mockup carries four; the full
   list, the stance, implications and what to watch are one tap away. */
const FRONT_PAGE_STORIES = 4;

export default function HomePage() {
  const navigate = useNavigate();
  const go = (path) => (e) => { e.preventDefault(); navigate(path); };

  const [drillInd, setDrillInd] = useState(null);
  const regime = useEngineRegime();
  // The engine's track record, opened in place. Its weekly history is only
  // fetched when the reader asks for it; the S&P 500 line is the same stored
  // series the market banner already loaded (one shared fetch).
  const [trackOpen, setTrackOpen] = useState(false);
  const { hist: levelsHist } = useMarketLevels();
  const [engWeeks, setEngWeeks] = useState(null);
  useEffect(() => {
    if (!trackOpen || engWeeks) return undefined;
    let c = false;
    fetch('/macrotilt_engine_history.json', { cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!c) setEngWeeks(d?.weekly || []); })
      .catch(() => { if (!c) setEngWeeks([]); });
    return () => { c = true; };
  }, [trackOpen, engWeeks]);
  const { brief, loading: briefLoading, editions, gates } = useDailyBrief();
  // The edition on the page: the latest of morning, midday and close.
  const shown = useMemo(() => pickEdition(brief, editions), [brief, editions]);
  const edition = shown.data;
  const isMorning = shown.kind === 'morning';
  const shownLabel = editionLabel(shown.kind, edition);
  const earlierToday = useMemo(() => sameDayEditions(shown, brief, editions), [shown, brief, editions]);
  const { days: calDays, all: calAll, meta: calMeta, todayISO, failed: calFailed, loading: calLoading } = useEconCalendar({ maxTier: 2, limit: 5 });
  const [calOpen, setCalOpen] = useState(false);
  const { data: relHist } = useEconReleaseHistory(true);
  // New York clock, re-read each minute, so a row turns "released" at its
  // time without a reload.
  const [nowEt, setNowEt] = useState(nowET);
  useEffect(() => {
    const t = setInterval(() => setNowEt(nowET()), 60 * 1000);
    return () => clearInterval(t);
  }, []);
  const impactOf = (name) => relHist?.series?.[name]?.impact || null;
  const [openRelease, setOpenRelease] = useState(null);
  // A release opened from the calendar list REPLACES the list rather than
  // stacking on it (2026-11-02: two pop-ups, two × buttons). The detail
  // carries a way back to the list; closing it from the tile just closes it.
  const [releaseFromCal, setReleaseFromCal] = useState(false);
  const { idea, error: ideaError, loading: ideaLoading } = useTradeIdea();
  const { byId: scoreById } = useTradeScores(!!idea);
  const ideaSchedule = scheduleParts(tradeSchedule(idea, idea ? scoreById.get(idea.id) : null));

  // Charts are declarative: the note names series that already exist in
  // indicator_history.json and the site draws them.
  const chartKeys = useMemo(() => (idea?.charts || []).map((c) => c.series), [idea]);
  const { series: chartSeries } = useIndicatorSeries(chartKeys);

  const [ambient, setAmbient] = useState(readAmbient);
  const flipAmbient = () => {
    setAmbient((v) => { try { window.localStorage.setItem(AMBIENT_KEY, v ? 'off' : 'on'); } catch {} return !v; });
  };

  const stressMk = stressGaugePct(regime.move);
  const yieldMk = yieldGaugePct(regime.yieldDeltaBp);
  const stressZone = regime.stressZone;
  const stressMsg = stressMessage(stressZone, regime.move);
  const yReg = regime.yieldRegime;
  const yDelta = regime.yieldDeltaBp;
  /* One plain sentence under the yield meter, stating the distance to the
     nearest line the way stressMessage does — the words can never outrun the
     number. */
  const yMsg = (() => {
    if (yReg === 'Inflationary') return 'Inflationary — the Fed is back in play.';
    if (yReg === 'Deflationary') return 'Deflationary — a growth scare.';
    if (yReg === 'Neutral' && yDelta != null && Number.isFinite(yDelta)) {
      const toInfl = Math.round(YIELD_THRESH.inflBp - yDelta);
      const toDefl = Math.round(yDelta - YIELD_THRESH.deflBp);
      const bp = (n) => `${n} basis point${n === 1 ? '' : 's'}`;
      return toInfl <= toDefl
        ? `Neutral — ${bp(Math.max(1, toInfl))} short of the inflationary line.`
        : `Neutral — ${bp(Math.max(1, toDefl))} above the deflationary line.`;
    }
    return yReg ? `${yReg}.` : '—';
  })();
  const verdictParts = (regime.regimeLabel || '—').split('·').map((s) => s.trim());

  // The numbered list: the morning's news, or a later edition's company items.
  const allNews = (isMorning ? brief?.news : edition?.items) || [];
  const briefNews = allNews.slice(0, FRONT_PAGE_STORIES);
  const briefHidden = Math.max(0, allNews.length - briefNews.length);
  const [openStory, setOpenStory] = useState(null);

  const [briefOpen, setBriefOpen] = useState(false);
  const [ideaOpen, setIdeaOpen] = useState(false);
  // The brief modal registers for Escape like every other pop-up (top layer
  // only); the trade note handles its own (TradeIdeaNoteModal).
  useModalEscape(briefOpen, () => setBriefOpen(false));
  useScrollLock(briefOpen);
  const modalTarget = (typeof document !== 'undefined' && (document.querySelector('.mt-overhaul') || document.body)) || null;

  /* "This Week's Data": the remaining days of the current week (through
     Sunday). Late in the week, when fewer than two days are left, the list
     runs on into next week so the tile never shows a lone row; every day
     carries its own date, so nothing is implied that is not printed. */
  const weekDays = useMemo(() => {
    if (!todayISO) return calDays;
    const t = new Date(`${todayISO}T00:00:00Z`);
    const dow = t.getUTCDay() || 7;            // Mon=1 … Sun=7
    const end = new Date(t); end.setUTCDate(t.getUTCDate() + (7 - dow));
    const endISO = end.toISOString().slice(0, 10);
    const inWeek = calDays.filter((d) => d.date <= endISO);
    return inWeek.length >= 2 ? inWeek : calDays.slice(0, 4);
  }, [calDays, todayISO]);

  const heroChart = idea?.charts?.[0];
  const briefDate = edition?.date ? weekdayDate(edition.date) : '';
  const briefStale = edition?.date && todayISO && edition.date < todayISO;
  /* A quiet day says so: the 11:30 gate check ran today and nothing fired,
     so no Midday Update is coming and the Morning Brief stands. */
  const quietDay = isMorning && gates?.date === todayISO && gates?.fired === false;
  const hasBody = isMorning
    ? (brief?.stance || brief?.implications?.length > 0 || brief?.watch?.length > 0 || brief?.sections?.length > 0 || allNews.length > 0)
    : (edition?.stance || edition?.scorecard?.length > 0 || edition?.bullets?.length > 0 || edition?.sections?.length > 0 || edition?.watch?.length > 0 || allNews.length > 0);

  return (
    <div className="ed-home" data-ambient={ambient ? 'on' : 'off'}>
      {ambient && (
        <div className="ed-amb" aria-hidden="true">
          <div className="ed-blob ed-blob-1" />
          <div className="ed-blob ed-blob-2" />
        </div>
      )}

      <main className="ed-main">
        <div className="ed-row ed-row-1">

          {/* ── Morning Brief (lead) ──────────────────────────────────── */}
          <article className="ed-brief rd-rise d2" aria-label={shownLabel}>
            <div className="ed-label ed-label--accent">
              {briefLabel(shownLabel, edition, briefDate, briefStale)}
            </div>
            {quietDay && <div className="ed-brief-quiet">No midday update · nothing tripped at 11:30</div>}
            {/* Loading is a skeleton, never a sentence that reads like news
                (2026-10-29); a brief that did not arrive says so plainly. */}
            {briefLoading ? (
              <div aria-busy="true" aria-label="Loading the brief">
                <span className="rd-skel rd-skel--head" />
                <span className="rd-skel rd-skel--line" />
                <span className="rd-skel rd-skel--line is-short" />
              </div>
            ) : edition?.headline ? (
              <h1 className="ed-brief-h">{edition.headline}</h1>
            ) : (
              <p className="ed-empty">The morning brief did not load — refresh to try again.</p>
            )}
            {edition?.stance && <Html tag="p" className="ed-brief-sum" html={edition.stance} />}
            {briefNews.length > 0 && (
              <ol className="ed-news">
                {briefNews.map((n, i) => (
                  <li key={i} className={`ed-news-li${openStory === i ? ' is-open' : ''}`}>
                    <button type="button" className="ed-news-btn" onClick={() => setOpenStory(openStory === i ? null : i)} aria-expanded={openStory === i}>
                      <span className="ed-news-n rd-num">{String(i + 1).padStart(2, '0')}</span>
                      <span className="ed-news-t"><Html html={n.head} /></span>
                    </button>
                    {openStory === i && <div className="ed-news-body"><Html html={n.body} /></div>}
                  </li>
                ))}
              </ol>
            )}
            {hasBody && (
              <button type="button" className="ed-link" onClick={() => setBriefOpen(true)}>
                Read the full brief{briefHidden > 0 ? ` · ${briefHidden} more ${briefHidden === 1 ? 'story' : 'stories'}` : ''} →
              </button>
            )}
          </article>

          {/* ── The Engine ──────────────────────────────────────────── */}
          <aside className="ed-engine rd-rise d3" aria-label="The Engine">
            <div className="ed-label">The Engine · Today's Regime</div>
            <div className="ed-engine-h">{verdictParts[0]}</div>
            <div className="ed-engine-y">Yield regime: <b>{verdictParts[1] || '—'}</b></div>
            <p className="ed-engine-so">Bond volatility called S&amp;P 500 drawdowns better than fifteen other stress gauges since 2006.</p>

            <button type="button" className="ed-meter" onClick={() => setDrillInd('move')} style={{ '--mk': `${stressMk ?? 0}%` }}>
              <div className="ed-meter-head"><span>Stress signal · MOVE index</span><b className="rd-num">{fmt(regime.move, 0)}</b></div>
              <div className="ed-meter-track" aria-hidden="true">
                <span className="ed-zone ed-zone--calm" />
                <span className="ed-zone ed-zone--watch" />
                <span className="ed-zone ed-zone--off" />
                {stressMk != null && <span className="ed-pin" />}
              </div>
              <div className="ed-meter-scale rd-num"><span>Risk on ≤{STRESS_THRESH.watch}</span><span>Watch</span><span>Risk off ≥{STRESS_THRESH.riskOff}</span></div>
              <div className="ed-meter-read">{stressMsg}</div>
            </button>

            <button type="button" className="ed-meter" onClick={() => setDrillInd('ust_10y')} style={{ '--mk': `${yieldMk ?? 0}%` }}>
              <div className="ed-meter-head"><span>Yield regime · 3-month change in 10Y</span><b className="rd-num">{yDelta == null ? '—' : `${yDelta >= 0 ? '+' : '−'}${Math.abs(Math.round(yDelta))}bp`}</b></div>
              <div className="ed-meter-track" aria-hidden="true">
                <span className="ed-zone ed-zone--defl" />
                <span className="ed-zone ed-zone--neutral" />
                <span className="ed-zone ed-zone--watch" />
                {yieldMk != null && <span className="ed-pin" />}
              </div>
              <div className="ed-meter-scale rd-num"><span>Deflationary ≤{YIELD_THRESH.deflBp}</span><span>Neutral</span><span>Inflationary ≥+{YIELD_THRESH.inflBp}</span></div>
              <div className="ed-meter-read">{yMsg}</div>
            </button>

            {/* Opens the engine's record in place (2026-10-29). It used to go to
                Macro Landscape, which has no track-record section — the record
                is a pop-up there too. */}
            <button type="button" className="ed-link" onClick={() => setTrackOpen(true)}>See the track record →</button>
          </aside>
        </div>

        <div className="ed-row ed-row-2">

          {/* ── Trade Idea ──────────────────────────────────────────── */}
          <article className="ed-idea rd-rise d3" aria-label="Trade Idea">
            {/* The publication date is the headline date, and it says so
                (2026-10-29); the schedule line under the trade block carries
                the scorer's own entry, planned close and expiry. */}
            <div className="ed-label ed-label--accent">Trade Idea{idea?.date ? ` · Published ${publishedLabel(idea, { weekday: true, fallback: weekdayDate(idea.date) })}` : ''}</div>
            {idea ? (
              <>
                <h2 className="ed-idea-h">{idea.title}</h2>
                {idea.call && <p className="ed-idea-call">{tileLine(idea.call)}</p>}

                {/* Exactly four fields, one vehicle (Joe, 2026-10-22 — LESSONS 1.7). */}
                {idea.the_trade && (
                  <dl className="ed-trade">
                    <div className="ed-trade-f"><dt>Buy</dt><dd>{idea.the_trade.buy ? (idea.the_trade.buy_line || firstClause(idea.the_trade.buy, 64)) : 'N/A'}</dd></div>
                    <div className="ed-trade-f"><dt>Sell short</dt><dd>{idea.the_trade.short ? (idea.the_trade.short_line || firstClause(idea.the_trade.short, 64)) : 'N/A'}</dd></div>
                    <div className="ed-trade-f"><dt>Time horizon</dt><dd>{firstClause(idea.horizon, 64) || '—'}</dd></div>
                    <div className="ed-trade-f"><dt>Exit trigger</dt><dd className="rd-num">{firstClause(idea.levels?.invalidation) || '—'}</dd></div>
                  </dl>
                )}

                {ideaSchedule.length > 0 && (
                  <p className="ed-idea-sched rd-num">{ideaSchedule.map((x) => x.t).join(' · ')}</p>
                )}

                {heroChart && (
                  <div className="ed-idea-chart">
                    <IdeaChart spec={heroChart} series={chartSeries?.[heroChart.series]} asOf={idea.date} accentFrom={idea.date} width={720} height={200} compact animate />
                  </div>
                )}

                <button type="button" className="ed-link" onClick={() => setIdeaOpen(true)}>
                  Read the full note{idea.charts?.length > 1 ? ` · ${idea.charts.length} charts` : ''} →
                </button>
              </>
            ) : ideaLoading ? (
              <div aria-busy="true" aria-label="Loading the trade idea">
                <span className="rd-skel rd-skel--head" />
                <span className="rd-skel rd-skel--line" />
                <span className="rd-skel rd-skel--line is-short" />
              </div>
            ) : ideaError ? (
              /* A failed fetch is an error, not an empty archive (LESSONS 4.9). */
              <p className="ed-empty">Couldn&rsquo;t load the trade idea just now — refresh to try again.</p>
            ) : (
              <p className="ed-empty">
                No note published yet. The research runs every morning before the US open;
                the best ideas publish — at most two a week.
              </p>
            )}
          </article>

          {/* ── This Week's Data ────────────────────────────────────── */}
          <aside className="ed-data rd-rise d4" aria-label="This week's data">
            <div className="ed-data-head">
              <span className="ed-label">This Week's Data</span>
              <span className="ed-legend"><span className="ed-dot" aria-hidden="true" />Market-moving</span>
            </div>
            {weekDays.map((d, di) => (
              <div key={d.date} className={`ed-day${d.isToday ? ' is-today' : ''}${di === 0 ? ' is-first' : ''}`}>
                <div className="ed-day-h">{d.isToday ? 'Today' : weekdayDate(d.date)}</div>
                {d.events.slice().sort((a, b) => a.tier - b.tier).map((e) => {
                  /* Once its time has passed a release shows what it said —
                     the actual figure or the bank's decision — or "Released"
                     when the feed does not hold it yet (2026-10-29). */
                  const done = isReleased(e, nowEt);
                  const res = done ? releaseResult(e, relHist) : null;
                  return (
                    <button key={e.name} type="button" className={`ed-ev${e.tier === 1 ? ' is-major' : ''}${done ? ' is-done' : ''}`} onClick={() => { setReleaseFromCal(false); setOpenRelease(e); }}
                            aria-label={done ? `${e.name}, released${res ? `: ${res.text}` : ''}` : undefined}>
                      <span className="ed-ev-n">{e.tier === 1 && <span className="ed-dot" aria-hidden="true" />}{e.name}</span>
                      <span className="ed-ev-t rd-num">
                        {done
                          ? (res
                            ? <>{res.kind === 'print' && <span className="ed-ev-out">actual </span>}<b className="ed-ev-act">{res.short}</b></>
                            : <span className="ed-ev-out">Released</span>)
                          : e.time_et}
                        <ImpactMark impact={impactOf(e.name)} />
                      </span>
                    </button>
                  );
                })}
              </div>
            ))}
            {calLoading && (
              <div aria-busy="true" aria-label="Loading this week's releases">
                <span className="rd-skel rd-skel--line" />
                <span className="rd-skel rd-skel--line" />
                <span className="rd-skel rd-skel--line is-short" />
              </div>
            )}
            {weekDays.length === 0 && !calFailed && !calLoading && (
              <p className="ed-empty">No major releases scheduled in the next ten weeks.</p>
            )}
            {calFailed && (
              <p className="ed-empty">The release calendar did not load. It rebuilds each morning from the agencies&rsquo; published schedules.</p>
            )}
            {calMeta?.counts?.total > 0 && (
              <button type="button" className="ed-link" onClick={() => setCalOpen(true)}>All releases →</button>
            )}
          </aside>
        </div>

        <div className="ed-ambient-row">
          <button type="button" className="ed-ambient-btn" onClick={flipAmbient} aria-pressed={ambient}>
            Background motion: {ambient ? 'on' : 'off'}
          </button>
        </div>
      </main>

      {/* full-brief modal — portals to the app root so the page never reflows */}
      {briefOpen && modalTarget && createPortal(
        <div onClick={() => setBriefOpen(false)} className="home-v12 briefmodal-veil">
          <div onClick={(e) => e.stopPropagation()} className="briefmodal">
            <button type="button" className="briefmodal-x" onClick={() => setBriefOpen(false)} aria-label="Close">×</button>
            <div className="eyebrow2"><span className="dot" />{briefLabel(shownLabel, edition, briefDate, false)}</div>
            <h2 className="briefmodal-h">The full brief</h2>
            <div className="briefmodal-body">
              {isMorning ? (
                <>
                  {brief?.stance && <p><Html html={brief.stance} /></p>}
                  <HeadList title="The headlines" items={allNews} />
                  {brief?.implications?.length > 0 && (
                    <ul>{brief.implications.map((t, i) => <li key={i}><Html html={t} /></li>)}</ul>
                  )}
                  {(brief?.watch || []).map((w, i) => (
                    <p key={i}><b><Html html={w.head} /></b> — <Html html={w.body} /></p>
                  ))}
                  <BriefSections sections={brief?.sections} go={go} />
                </>
              ) : (
                <>
                  {edition?.stance && <p><Html html={edition.stance} /></p>}
                  {/* Midday: why it posted — the gate that fired at 11:30. */}
                  {shown.kind === 'midday' && edition?.trigger?.gate && (
                    <p><b>Why this posted</b> — {edition.trigger.gate}{edition.trigger.detail ? `: ${edition.trigger.detail}` : ''}</p>
                  )}
                  {edition?.scorecard?.length > 0 && (
                    <>
                      <p className="briefmodal-sec">Scorecard</p>
                      {edition.scorecard.map((row, i) => (
                        <p key={i}><b><Html html={row.call} /></b> — <Html html={row.actual} /></p>
                      ))}
                    </>
                  )}
                  {shown.kind === 'midday' && edition?.bullets?.length > 0 && (
                    <ul>{edition.bullets.map((t, i) => <li key={i}><Html html={t} /></li>)}</ul>
                  )}
                  {shown.kind === 'close' && <BriefSections sections={edition?.sections} go={go} />}
                  <HeadList title={shown.kind === 'close' ? 'After the close' : 'The headlines'} items={allNews} />
                  <HeadList title={shown.kind === 'close' ? 'Tomorrow' : 'This afternoon'} items={edition?.watch} />
                </>
              )}
              {/* Every other edition of the same day, newest first: label,
                  time, headline and stance — the day's thread in one place. */}
              {earlierToday.length > 0 && (
                <>
                  <p className="briefmodal-sec">Earlier today</p>
                  {earlierToday.map((e) => (
                    <div key={e.kind}>
                      <p className="briefmodal-when">{editionLabel(e.kind, e.data)}{writtenAt(e.data) ? ` · ${writtenAt(e.data)}` : ''}</p>
                      {e.data.headline && <p><b>{e.data.headline}</b></p>}
                      {e.data.stance && <p><Html html={e.data.stance} /></p>}
                    </div>
                  ))}
                </>
              )}
            </div>
          </div>
        </div>,
        modalTarget,
      )}

      {trackOpen && (
        <DetailModal onClose={() => setTrackOpen(false)}>
          <EngineTrackRecord weeks={engWeeks || []} spx={levelsHist?.spx_index?.points || []} />
        </DetailModal>
      )}

      {/* Indicator drill — opens over Home, never navigates away (2026-08-18). */}
      <IndicatorDrillModal indId={drillInd} onClose={() => setDrillInd(null)} />
      <ReleaseCalendarModal open={calOpen} events={calAll} todayISO={todayISO} meta={calMeta} impactOf={impactOf} relHist={relHist} nowEt={nowEt}
                            onClose={() => setCalOpen(false)}
                            onPick={(e) => { setCalOpen(false); setReleaseFromCal(true); setOpenRelease(e); }} />
      <ReleaseDetailModal event={openRelease}
                          onClose={() => { setOpenRelease(null); setReleaseFromCal(false); }}
                          onBack={releaseFromCal ? () => { setOpenRelease(null); setReleaseFromCal(false); setCalOpen(true); } : null} />

      {ideaOpen && idea && (
        <TradeIdeaNoteModal idea={idea} chartSeries={chartSeries} onClose={() => setIdeaOpen(false)} />
      )}
    </div>
  );
}
