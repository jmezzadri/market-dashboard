/* HomePage — the MacroTilt cockpit.

   2026-08-13 rework (Joe): the home page is FOUR reads, nothing else —
     1 Morning Brief   · what happened, fact-based
     2 The Engine      · where volatility and the yield regime sit
     3 Trade Idea      · the proprietary editorial call (new)
     4 Upcoming data   · what prints next, from the agencies' real calendars

   Two tiles were deleted in this pass, not moved: "Macro indicators · at
   extremes" and "Positioning · COT extremes". Both already render on the
   Macro Overview page, so Home was carrying a second copy of a read that
   lives elsewhere. (Joe: "The other two are already on MACRO. Just delete
   them from Home.")

   Grid: a real 2x2. Left column (span 7) holds the two READING tiles — the
   brief and the trade idea; right column (span 5) holds the two SCANNING
   tiles — the engine gauges and the calendar. Row heights stretch together.

   Design rules honored (these caused earlier reworks):
     • Engine data wins — the stress signal is MOVE (bands 116 / 124) and the
       yield regime is the 3-month change in the 10-year, both from the engine
       hook, never the brief's prose. No invented thresholds.
     • Ink is reserved for exactly ONE card, The Engine. The Trade Idea tile is
       the same putty surface with a gold editorial rule — it must not compete
       with the engine for the eye.
     • Lead with the day-over-day CHANGE on every level.
     • Prices are prior-close, labeled "close".
     • Everything links to its detail route. */

import React, { useMemo, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useTweaks } from '../tweaks/TweaksContext';
import useEngineRegime from '../lib/useEngineRegime';
import useMarketLevels from '../lib/useMarketLevels';
import useDailyBrief from '../lib/useDailyBrief';
import useEconCalendar from '../lib/useEconCalendar';
import useTradeIdea from '../lib/useTradeIdea';
import '../styles/cream-system.css';

/* ── format helpers ─────────────────────────────────────────────────────── */
function fmt(v, dec) {
  if (v == null || !Number.isFinite(v)) return '—';
  return v.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}
function ddParts(dd, dec) {
  if (dd == null || !Number.isFinite(dd)) return { arrow: '', txt: '', cls: '' };
  const d = Math.min(dec, 2);
  // Round to the displayed precision first, so a change that rounds to zero
  // (e.g. a monthly series unchanged since its last print) shows nothing
  // rather than a spurious "-0.0".
  const r = Number(dd.toFixed(d));
  if (r === 0) return { arrow: '', txt: '', cls: '' };
  const a = Math.abs(r).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  return r > 0 ? { arrow: '▲', txt: a, cls: 'up' } : { arrow: '▼', txt: a, cls: 'down' };
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
function longDate(iso) {
  if (!iso) return '';
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });
}
/* The tile's fact columns are a scannable strip, not prose — Joe's standing
   rule is that rows carry the fact and the explanation lives elsewhere. The
   contract deliberately requires a FULL invalidation sentence (it has to be
   checkable), so the tile shows its first clause and the modal shows all of
   it. Never truncates mid-word, and never adds an ellipsis to text that was
   already short enough. */
/* Same reasoning for the counter-argument: the contract demands a substantial
   one (a hedge clause is rejected), which is right for the note and too long
   for the tile. Tile gets the opening two sentences, modal gets all of it. */
function twoSentences(s, n = 2) {
  const t = String(s || '').trim();
  const parts = t.match(/[^.!?]+[.!?]+(\s|$)/g);
  if (!parts || parts.length <= n) return t;
  return `${parts.slice(0, n).join('').trim()} …`;
}
function firstClause(s, max = 96) {
  const t = String(s || '').trim();
  if (!t) return '';
  const stop = t.search(/(?<=\S)\s+[—–]\s+|\.\s/);
  const head = stop > 0 ? t.slice(0, stop).trim() : t;
  if (head.length <= max) return head;
  const cut = head.slice(0, max);
  return `${cut.slice(0, cut.lastIndexOf(' '))}…`;
}

const RIBBON = [
  { key: 'spx_index', label: 'S&P', dec: 0, suffix: '', route: '/ticker/SPY' },
  { key: 'move', label: 'MOVE', dec: 0, suffix: '', route: '/macro?ind=move' },
  { key: 'ust_10y', label: '10Y', dec: 2, suffix: '%', route: '/macro?ind=ust_10y' },
  { key: 'vix', label: 'VIX', dec: 1, suffix: '', route: '/macro?ind=vix' },
  { key: 'fx_jpy', label: '¥/$', dec: 1, suffix: '', route: '/macro?ind=fx_jpy' },
  { key: 'hy_ig', label: 'HY OAS', dec: 0, suffix: '', route: '/macro?ind=hy_ig' },
  { key: 'cmdty_copper', label: 'Copper', dec: 2, suffix: '', route: '/macro?ind=cmdty_copper' },
];

/* ── engine gauge math (linear scales; bands = engine thresholds) ───────── */
const clampPct = (x) => Math.max(0, Math.min(100, x));
function stressGauge(move) {
  const MIN = 40, MAX = 160, R = MAX - MIN; // sensible MOVE range
  const on = ((116 - MIN) / R) * 100;
  const watch = ((124 - 116) / R) * 100;
  const off = ((MAX - 124) / R) * 100;
  const mk = move == null ? null : clampPct(((move - MIN) / R) * 100);
  return { on, watch, off, mk };
}
function yieldGauge(bp) {
  const MIN = -40, MAX = 60, R = MAX - MIN;
  const defl = ((-11 - MIN) / R) * 100;
  const neutral = ((32 - -11) / R) * 100;
  const infl = ((MAX - 32) / R) * 100;
  const mk = bp == null ? null : clampPct(((bp - MIN) / R) * 100);
  return { defl, neutral, infl, mk };
}

/* Reveal — scroll-reveal wrapper. Replays in BOTH directions (Joe 2026-07-07).
   State lives in React so data-poll re-renders preserve the revealed class. */
function Reveal({ as: Tag = 'div', className = '', children, ...rest }) {
  const ref = useRef(null);
  const [vis, setVis] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') { setVis(true); return undefined; }
    const io = new IntersectionObserver(([e]) => setVis(e.isIntersecting), { threshold: 0.12 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return <Tag ref={ref} className={`${className} rv${vis ? ' in' : ''}`} {...rest}>{children}</Tag>;
}

const KIND_LABEL = {
  macro: 'Macro',
  'cross-asset': 'Cross-asset',
  'single-name': 'Single name',
  rates: 'Rates',
  credit: 'Credit',
  fx: 'Currencies',
  commodity: 'Commodities',
  equity: 'Equities',
};

export default function HomePage() {
  const navigate = useNavigate();
  const go = (path) => (e) => { e.preventDefault(); navigate(path); };

  const { tweaks, setTweak } = useTweaks();
  const isDark = tweaks.theme !== 'light';
  const flip = () => setTweak('theme', isDark ? 'light' : 'navy');

  const { level } = useMarketLevels();
  const regime = useEngineRegime();
  const { brief } = useDailyBrief();
  const { days: calDays, meta: calMeta, todayISO, failed: calFailed } = useEconCalendar({ maxTier: 2, limit: 7 });
  const { idea, nextPublish } = useTradeIdea();

  // Footer: market open/closed + honest "data as of" (newest displayed level).
  const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const dow = nowET.getDay();
  const mins = nowET.getHours() * 60 + nowET.getMinutes();
  const marketOpen = dow >= 1 && dow <= 5 && mins >= 570 && mins < 960;
  const newestAsOf = useMemo(() => {
    const ds = RIBBON.map((r) => level(r.key)?.asOf).filter(Boolean).sort();
    return ds.length ? ds[ds.length - 1] : null;
  }, [level]);

  const stress = stressGauge(regime.move);
  const yld = yieldGauge(regime.yieldDeltaBp);
  const stressZone = regime.stressZone;
  const stressCls = stressZone === 'Risk On' ? 'up' : stressZone === 'Watch' ? 'amb' : stressZone === 'Risk Off' ? 'down' : '';
  const stressMsg = stressZone === 'Risk On' ? 'Calm — far from any de-risk line.'
    : stressZone === 'Watch' ? 'Watch — approaching the de-risk line.'
    : stressZone === 'Risk Off' ? 'Risk off — the de-risk line is breached.' : '—';
  const yReg = regime.yieldRegime;
  const nearInfl = yReg === 'Neutral' && regime.yieldDeltaBp != null && 32 - regime.yieldDeltaBp <= 8;
  const yCls = yReg === 'Inflationary' ? 'amb' : yReg === 'Deflationary' ? 'up' : nearInfl ? 'amb' : '';
  const yMsg = yReg === 'Inflationary' ? 'Inflationary — the Fed is back in play.'
    : yReg === 'Deflationary' ? 'Deflationary — a growth scare.'
    : nearInfl ? 'Neutral — nearing the inflationary edge.' : 'Neutral.';

  // Verdict split ("Risk On · Neutral" -> bold + small).
  const verdictParts = (regime.regimeLabel || '—').split('·').map((s) => s.trim());

  const toggleNi = (e) => { e.currentTarget.parentElement.classList.toggle('open'); };

  // Cockpit height budget (2026-08-13). The brief tile's height is data-driven
  // — one row per headline, and the writer regularly files seven. That made the
  // tile 891px against an Engine card of ~450px of content, and the grid row
  // stretched the Engine into a card with a hole in the middle. LESSONS 4.17
  // is precisely that failure ("a double-height Engine card full of dead
  // space"). So the TILE carries the top five headlines and the full-brief row
  // says how many it is holding back — nothing is lost, the modal already
  // renders every one of them, and the four tiles stay a cockpit rather than a
  // scroll. Never silently truncate: the count is in the copy.
  const BRIEF_TILE_HEADLINES = 5;
  const allNews = brief?.news || [];
  const briefNews = allNews.slice(0, BRIEF_TILE_HEADLINES);
  const briefHidden = Math.max(0, allNews.length - briefNews.length);

  // Portal modals (Joe 2026-07-22: expanding a tile in place jacked up the grid
  // spacing — detail opens in a portal modal instead).
  const [briefOpen, setBriefOpen] = useState(false);
  const [ideaOpen, setIdeaOpen] = useState(false);
  const anyModal = briefOpen || ideaOpen;
  useEffect(() => {
    if (!anyModal) return undefined;
    const k = (e) => { if (e.key === 'Escape') { setBriefOpen(false); setIdeaOpen(false); } };
    window.addEventListener('keydown', k);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', k); document.body.style.overflow = prev; };
  }, [anyModal]);
  const modalTarget = (typeof document !== 'undefined' && (document.querySelector('.mt-overhaul') || document.body)) || null;

  return (
    <div className="home-v12">

      {/* market tape */}
      <Reveal className="tape">
        <div className="wrap row">
          {RIBBON.map((r) => {
            const lv = level(r.key);
            const d = ddParts(lv?.dd, r.dec);
            return (
              <a key={r.key} className="t" href={r.route} onClick={go(r.route)}>
                <span className="tk">{r.label}</span>
                <span className="tv">{lv ? fmt(lv.value, r.dec) + r.suffix : '—'}</span>
                <span className={`td ${d.cls || 'fl'}`}>{d.txt ? `${d.arrow} ${d.txt.replace(/^[+−-]/, '')}` : '—'} <small>close</small></span>
              </a>
            );
          })}
        </div>
      </Reveal>

      {/* four-tile cockpit — row 1: Brief | Engine, row 2: Trade idea | Upcoming */}
      <section className="wrap">
        <div className="bgrid">

          {/* 1 · morning brief */}
          <Reveal className="tile brief-card sp7" onClick={(e) => { const a = e.target.closest && e.target.closest('a[data-route]'); if (a) { e.preventDefault(); navigate(a.getAttribute('data-route')); } }}>
            <div className="eyebrow2"><span className="dot" />{brief?.eyebrow || 'Morning Brief'}{brief?.date ? ` · ${weekdayDate(brief.date)}` : ''}{brief?.date && brief.date < todayISO ? ' · last session' : ''}</div>
            <h1>{brief?.headline || 'Reading the tape…'}</h1>
            <div className="newslist">
              {briefNews.map((n, i) => (
                <div className="ni" key={i}>
                  <button type="button" onClick={toggleNi}>
                    <span className="hl"><b><Html html={n.head} /></b> <span>— <Html html={n.body} /></span></span>
                    <span className="plus">+</span>
                  </button>
                  <div className="body"><div><Html html={n.body} /></div></div>
                </div>
              ))}
              {(brief?.stance || brief?.implications?.length > 0 || brief?.watch?.length > 0 || brief?.sections?.length > 0) && (
                <div className="ni fullbrief">
                  <button type="button" onClick={(e) => { e.stopPropagation(); setBriefOpen(true); }}>
                    <span className="hl"><b>The full brief</b> <span>— {briefHidden > 0 ? `${briefHidden} more ${briefHidden === 1 ? 'headline' : 'headlines'}, ` : ''}stance, implications, what to watch, and the detail</span></span>
                    <span className="plus">+</span>
                  </button>
                </div>
              )}
            </div>
          </Reveal>

          {/* 2 · the engine — the ONE ink card on the page */}
          <Reveal className="tile engine-card engine-tile sp5">
            <div>
              <div className="eyebrow2"><span className="dot" />The Engine</div>
              <h2>{verdictParts[0]}{verdictParts[1] && <em> · {verdictParts[1].toLowerCase()}.</em>}</h2>
              {/* Copy replaced 2026-07-29 — see the matching note on MacroPage.
                  Short form here; the full explanation and the track-record
                  chart live on the Macro Overview card. */}
              <p className="so">Bond volatility called S&amp;P 500 drawdowns better than fifteen other stress gauges since 2006. Above the watch line the 3-month change in the 10-year picks the hedge. <a href="/macro" onClick={go('/macro')} style={{ color: 'inherit', fontWeight: 600 }}>See the track record ↗</a></p>
            </div>
            <div>
              <a className="gauge" href="/macro?ind=move" onClick={go('/macro?ind=move')} style={{ '--w': `${stress.mk ?? 0}%` }}>
                <div className="gl"><span>Stress signal · MOVE</span><b>{fmt(regime.move, 0)} <i>d/d</i></b></div>
                <div className="track"><div className="fill" /><div className="pin" /></div>
                <div className="ends"><span>Risk on ≤116</span><span>Watch</span><span>Off ≥124</span></div>
                <div className={`read ${stressCls === 'up' ? 'ok' : stressCls === 'amb' ? 'warm' : stressCls ? 'bad' : ''}`}>{stressMsg}</div>
              </a>
              <a className="gauge" href="/macro?ind=ust_10y" onClick={go('/macro?ind=ust_10y')} style={{ '--w': `${yld.mk ?? 0}%` }}>
                <div className="gl"><span>Yield regime · 3M Δ 10Y</span><b>{regime.yieldDeltaBp == null ? '—' : `${regime.yieldDeltaBp >= 0 ? '+' : ''}${Math.round(regime.yieldDeltaBp)}`} <i>bp</i></b></div>
                <div className="track"><div className="fill" /><div className="pin" /></div>
                <div className="ends"><span>Defl ≤−11</span><span>Neutral</span><span>Infl ≥+32</span></div>
                <div className={`read ${yCls === 'amb' ? 'warm' : yCls === 'up' ? 'ok' : ''}`}>{yMsg}</div>
              </a>
            </div>
          </Reveal>

          {/* 3 · trade idea — the editorial call. Putty surface, gold rule:
              editorial weight without stealing ink from The Engine. */}
          <Reveal className="tile putty-card idea-tile sp7">
            <div className="tilehead">
              <div className="eyebrow2"><span className="dot dot--gold" />Trade idea{idea?.date ? ` · ${weekdayDate(idea.date)}` : ''}</div>
              {idea?.kind && <span className="idea-kind">{KIND_LABEL[idea.kind] || idea.kind}</span>}
            </div>

            {idea ? (
              <>
                <h2 className="idea-title">{idea.title}</h2>
                {idea.dek && <p className="idea-dek">{idea.dek}</p>}

                <div className="idea-facts">
                  <div className="idea-fact">
                    <span className="k">The trade</span>
                    <span className="v">{idea.instrument || '—'}</span>
                  </div>
                  <div className="idea-fact">
                    <span className="k">Horizon</span>
                    <span className="v">{idea.horizon || '—'}</span>
                  </div>
                  <div className="idea-fact">
                    <span className="k">What kills it</span>
                    <span className="v">{firstClause(idea.levels?.invalidation) || '—'}</span>
                  </div>
                </div>

                {idea.other_side && (
                  <p className="idea-other"><b>The other side</b> — {twoSentences(idea.other_side)}</p>
                )}

                <p className="tilenote">
                  <button type="button" className="idea-more" onClick={() => setIdeaOpen(true)}>Read the full note →</button>
                </p>
              </>
            ) : (
              <div className="idea-empty">
                <p className="secnote">
                  No note published yet. Trade ideas publish Sunday and Wednesday evenings
                  {nextPublish ? ` — next on ${longDate(nextPublish)}.` : '.'}
                </p>
              </div>
            )}
          </Reveal>

          {/* 4 · upcoming data — live from the agencies' own release calendars */}
          <Reveal className="tile putty-card cal-tile sp5">
            <div className="tilehead">
              <div className="eyebrow2"><span className="dot" />Upcoming data</div>
              <a href="/macro" onClick={go('/macro')}>Macro Overview →</a>
            </div>
            <div className="calrows">
              {calDays.map((d) => (
                <a key={d.date} className={`srow calrow${d.isToday ? ' calrow--today' : ''}`} href="/macro" onClick={go('/macro')}>
                  <span className="when">{d.isToday ? 'Today' : weekdayDate(d.date)}</span>
                  <span className="what">{d.events.map((e) => e.name).join(' · ')}</span>
                  <span className="cal-time">{d.time}</span>
                </a>
              ))}
              {calDays.length === 0 && !calFailed && (
                <div className="secnote">No major releases scheduled in the next ten weeks.</div>
              )}
              {calFailed && (
                <div className="secnote">The release calendar did not load. It rebuilds each morning from the agencies&rsquo; published schedules.</div>
              )}
            </div>
            {calMeta?.counts?.total > 0 && (
              <p className="tilenote">
                {calMeta.counts.total} releases scheduled through {weekdayDate(calMeta.window?.to)} — dates from the
                {' '}statistical agencies&rsquo; own calendars, times are Eastern.
              </p>
            )}
          </Reveal>

        </div>
      </section>

      <footer>
        <div className="micro">
          MacroTilt · data through {newestAsOf || '—'} · {marketOpen ? 'market open' : 'market closed'} ·{' '}
          <button type="button" onClick={flip} style={{ background: 'none', border: 'none', color: 'inherit', font: 'inherit', letterSpacing: 'inherit', cursor: 'pointer', textTransform: 'inherit' }}>
            switch to {isDark ? 'light' : 'dark'} theme
          </button>
        </div>
      </footer>

      {/* full-brief modal — portals to the app root so the tile grid never reflows */}
      {briefOpen && modalTarget && createPortal(
        <div onClick={() => setBriefOpen(false)} className="home-v12 briefmodal-veil">
          <div onClick={(e) => e.stopPropagation()} className="briefmodal">
            <button type="button" className="briefmodal-x" onClick={() => setBriefOpen(false)} aria-label="Close">×</button>
            <div className="eyebrow2"><span className="dot" />{brief?.eyebrow || 'Morning Brief'}{brief?.date ? ` · ${weekdayDate(brief.date)}` : ''}</div>
            <h2 className="briefmodal-h">The full brief</h2>
            <div className="briefmodal-body">
              {brief?.stance && <p><Html html={brief.stance} /></p>}
              {/* Every headline, including the ones the tile held back — the
                  tile's "N more headlines" line has to be true. */}
              {allNews.length > 0 && (
                <>
                  <p className="briefmodal-sec">The headlines</p>
                  <ul>{allNews.map((n, i) => (
                    <li key={i}><b><Html html={n.head} /></b> — <Html html={n.body} /></li>
                  ))}</ul>
                </>
              )}
              {brief?.implications?.length > 0 && (
                <ul>{brief.implications.map((t, i) => <li key={i}><Html html={t} /></li>)}</ul>
              )}
              {(brief?.watch || []).map((w, i) => (
                <p key={i}><b><Html html={w.head} /></b> — <Html html={w.body} /></p>
              ))}
              {(brief?.sections || []).map((sec, i) => (
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
              ))}
            </div>
          </div>
        </div>,
        modalTarget,
      )}

      {/* full trade-idea modal */}
      {ideaOpen && idea && modalTarget && createPortal(
        <div onClick={() => setIdeaOpen(false)} className="home-v12 briefmodal-veil">
          <div onClick={(e) => e.stopPropagation()} className="briefmodal">
            <button type="button" className="briefmodal-x" onClick={() => setIdeaOpen(false)} aria-label="Close">×</button>
            <div className="eyebrow2"><span className="dot dot--gold" />Trade idea · {longDate(idea.date)}{idea.kind ? ` · ${KIND_LABEL[idea.kind] || idea.kind}` : ''}</div>
            <h2 className="briefmodal-h">{idea.title}</h2>
            <div className="briefmodal-body">
              {idea.dek && <p className="idea-modal-dek">{idea.dek}</p>}

              <div className="idea-modal-facts">
                {[['The trade', idea.instrument], ['Horizon', idea.horizon],
                  ['Trigger', idea.levels?.trigger], ['Invalidation', idea.levels?.invalidation],
                  ['Where it goes if it works', idea.levels?.target]]
                  .filter(([, v]) => v).map(([k, v]) => (
                    <div className="idea-fact" key={k}><span className="k">{k}</span><span className="v">{v}</span></div>
                  ))}
              </div>

              {idea.thesis?.length > 0 && (
                <>
                  <p className="briefmodal-sec">The case</p>
                  <ul>{idea.thesis.map((t, i) => <li key={i}><Html html={t} /></li>)}</ul>
                </>
              )}

              {idea.evidence?.length > 0 && (
                <>
                  <p className="briefmodal-sec">What the data says</p>
                  <ul className="idea-evidence">
                    {idea.evidence.map((e, i) => (
                      <li key={i}>
                        <b>{e.value}</b> — {e.claim}{' '}
                        <span className="idea-src">{e.source}{e.as_of ? `, as of ${e.as_of}` : ''}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}

              {(idea.sections || []).map((sec, i) => (
                <div key={i}>
                  <p className="briefmodal-sec">{sec.title}</p>
                  {Array.isArray(sec.bullets) && sec.bullets.length > 0
                    ? <ul>{sec.bullets.map((bt, jx) => <li key={jx}><Html html={bt} /></li>)}</ul>
                    : <Html tag="p" html={sec.prose} />}
                </div>
              ))}

              {idea.other_side && (
                <>
                  <p className="briefmodal-sec">The other side</p>
                  <p><Html html={idea.other_side} /></p>
                </>
              )}

              {idea.risks?.length > 0 && (
                <>
                  <p className="briefmodal-sec">What would kill it</p>
                  <ul>{idea.risks.map((r, i) => <li key={i}><Html html={r} /></li>)}</ul>
                </>
              )}

              {idea.so_what && (
                <p className="idea-sowhat"><b>So what</b> — <Html html={idea.so_what} /></p>
              )}

              <p className="idea-disclaimer">
                MacroTilt research is published for information only. It is not investment advice and it is not a
                recommendation to buy or sell any security.
              </p>
            </div>
          </div>
        </div>,
        modalTarget,
      )}
    </div>
  );
}
