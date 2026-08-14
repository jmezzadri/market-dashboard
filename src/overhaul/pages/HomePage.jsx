/* HomePage — the MacroTilt cockpit.

   2026-08-13 (Joe, second pass the same day): "We should have the Brief and
   Trade idea be the centerpieces. And the Engine and Data almost like
   supporting tiles somewhere. I dont like to have to scroll."

   So the page is now a HIERARCHY, not four equal tiles:
     Row 1 — Morning Brief | Trade Idea      the two reading surfaces, half each
     Row 2 — The Engine | Upcoming data      short supporting strip beneath them

   Everything that fights the no-scroll rule was cut rather than shrunk into
   illegibility: the hero margin above the grid, the brief's headline list (three
   on the tile, all of them in the modal), and the Engine's vertical stack (its
   two gauges now sit side by side in a short card). Nothing is hidden without
   the page saying so — the brief's "full brief" row states how many headlines it
   is holding back, and every chart in a note is reachable from the tile.

   Design rules honored (these caused earlier reworks):
     • Engine data wins — the stress signal is MOVE (bands 116 / 124) and the
       yield regime is the 3-month change in the 10-year, both from the engine
       hook, never the brief's prose. No invented thresholds.
     • Ink is reserved for exactly ONE card, The Engine. Gold is the editorial
       accent and appears on the Trade Idea and nowhere else.
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
import useIndicatorSeries from '../lib/useIndicatorSeries';
import IdeaChart from '../components/IdeaChart';
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
  const mk = move == null ? null : clampPct(((move - MIN) / R) * 100);
  return { mk };
}
function yieldGauge(bp) {
  const MIN = -40, MAX = 60, R = MAX - MIN;
  const mk = bp == null ? null : clampPct(((bp - MIN) / R) * 100);
  return { mk };
}

/* Reveal — scroll-reveal wrapper. Replays in BOTH directions (Joe 2026-07-07).
   State lives in React so data-poll re-renders preserve the revealed class. */
function Reveal({ as: Tag = 'div', className = '', children, ...rest }) {
  const ref = useRef(null);
  const [vis, setVis] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') { setVis(true); return undefined; }
    const io = new IntersectionObserver(([e]) => setVis(e.isIntersecting), { threshold: 0.05 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return <Tag ref={ref} className={`${className} rv${vis ? ' in' : ''}`} {...rest}>{children}</Tag>;
}

const KIND_LABEL = {
  macro: 'Macro', 'cross-asset': 'Cross-asset', 'single-name': 'Single name',
  rates: 'Rates', credit: 'Credit', fx: 'Currencies', commodity: 'Commodities', equity: 'Equities',
};
/* What the position IS, in one hover. The badge answers "am I shorting
   anything?" before the reader meets a single number — Joe, 2026-08-13. */
const POSITION_NOTE = {
  'allocation shift': 'Move money from one asset to another. Nothing sold short, no leverage.',
  'outright long': 'Buy and hold it. Nothing sold short.',
  'outright short': 'A short position — sold with the intention of buying it back lower.',
  'long/short spread': 'Long one thing and short the other, sized against each other.',
  hedge: 'Protection bought against something already owned.',
  'watch only': 'Not a position yet — the setup to watch and what would make it one.',
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
  const { days: calDays, meta: calMeta, todayISO, failed: calFailed } = useEconCalendar({ maxTier: 2, limit: 4 });
  const { idea, nextPublish } = useTradeIdea();

  // Charts are declarative: the note names series that already exist in
  // indicator_history.json and the site draws them. The 4.5 MB history file is
  // only fetched once a note is actually on screen asking for a chart.
  const chartKeys = useMemo(() => (idea?.charts || []).map((c) => c.series), [idea]);
  const { series: chartSeries } = useIndicatorSeries(chartKeys);

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
  const stressCls = stressZone === 'Risk On' ? 'ok' : stressZone === 'Watch' ? 'warm' : stressZone === 'Risk Off' ? 'bad' : '';
  const stressMsg = stressZone === 'Risk On' ? 'Calm — far from any de-risk line.'
    : stressZone === 'Watch' ? 'Watch — approaching the de-risk line.'
    : stressZone === 'Risk Off' ? 'Risk off — the de-risk line is breached.' : '—';
  const yReg = regime.yieldRegime;
  const nearInfl = yReg === 'Neutral' && regime.yieldDeltaBp != null && 32 - regime.yieldDeltaBp <= 8;
  const yCls = yReg === 'Inflationary' ? 'warm' : yReg === 'Deflationary' ? 'ok' : nearInfl ? 'warm' : '';
  const yMsg = yReg === 'Inflationary' ? 'Inflationary — the Fed is back in play.'
    : yReg === 'Deflationary' ? 'Deflationary — a growth scare.'
    : nearInfl ? 'Neutral — nearing the inflationary edge.' : 'Neutral.';

  const verdictParts = (regime.regimeLabel || '—').split('·').map((s) => s.trim());

  const toggleNi = (e) => { e.currentTarget.parentElement.classList.toggle('open'); };

  // Joe, 2026-08-13 (third pass): "On the Brief - WE can add more headlines.
  // There is so much dead space in that tile." Right — the brief shares a
  // stretched grid row with the Trade Idea, which is the taller card, so cutting
  // the brief to three headlines did not shorten the row at all. It only left a
  // hole. The tile now carries six; the full-brief row still names anything held
  // back and the modal renders every one, so the count stays true.
  const BRIEF_TILE_HEADLINES = 8;   // the writer files 6-7; the cap only guards a runaway day
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

  const heroChart = idea?.charts?.[0];

  return (
    <div className="home-v12 home-cockpit">

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

      <section className="wrap">
        <div className="bgrid">

          {/* ── centerpiece 1 · morning brief ─────────────────────────────── */}
          <Reveal className="tile brief-card sp6" onClick={(e) => { const a = e.target.closest && e.target.closest('a[data-route]'); if (a) { e.preventDefault(); navigate(a.getAttribute('data-route')); } }}>
            <div className="eyebrow2"><span className="dot" />{brief?.eyebrow || 'Morning Brief'}{brief?.date ? ` · ${weekdayDate(brief.date)}` : ''}{brief?.date && brief.date < todayISO ? ' · last session' : ''}</div>
            <h1>{brief?.headline || 'Reading the tape…'}</h1>
            {/* The brief's own stance line. It was modal-only while the tile sat
                200px short of its neighbour — the tile was hiding real content
                and showing whitespace instead. */}
            {brief?.stance && <Html tag="p" className="brief-stance" html={brief.stance} />}
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
              {(brief?.stance || brief?.implications?.length > 0 || brief?.watch?.length > 0 || brief?.sections?.length > 0 || allNews.length > 0) && (
                <div className="ni fullbrief">
                  <button type="button" onClick={(e) => { e.stopPropagation(); setBriefOpen(true); }}>
                    <span className="hl"><b>The full brief</b> <span>— {briefHidden > 0 ? `${briefHidden} more ${briefHidden === 1 ? 'headline' : 'headlines'}, ` : ''}stance, implications and what to watch</span></span>
                    <span className="plus">+</span>
                  </button>
                </div>
              )}
            </div>
          </Reveal>

          {/* ── centerpiece 2 · trade idea ────────────────────────────────── */}
          <Reveal className="tile putty-card idea-tile sp6">
            <div className="tilehead">
              <div className="eyebrow2"><span className="dot dot--gold" />Trade idea{idea?.date ? ` · ${weekdayDate(idea.date)}` : ''}</div>
              <div className="idea-badges">
                {idea?.edge?.source && <span className="idea-edge">{idea.edge.source}</span>}
                {idea?.position_type && (
                  <span className="idea-pos" title={POSITION_NOTE[idea.position_type] || ''}>{idea.position_type}</span>
                )}
                {idea?.kind && <span className="idea-kind">{KIND_LABEL[idea.kind] || idea.kind}</span>}
              </div>
            </div>

            {idea ? (
              <>
                <h2 className="idea-title">{idea.title}</h2>

                {/* The CALL leads — a claim with a horizon, not an instruction.
                    The first version of this line was an order ("Sell a slice of
                    your US large-company stocks and put the money into…") and
                    Joe's verdict was that it read as a terrible headline. A
                    research note states what is likely to happen and over what
                    period; the instruction lives in the fact strip below. */}
                {idea.call && <p className="idea-call">{idea.call}</p>}

                {idea.the_trade && (
                  <div className="idea-facts">
                    {idea.the_trade.buy && (
                      <div className="idea-fact"><span className="k">Buy</span><span className="v">{idea.the_trade.buy}</span></div>
                    )}
                    {idea.the_trade.sell && (
                      <div className="idea-fact"><span className="k">Sell to pay for it</span><span className="v">{idea.the_trade.sell}</span></div>
                    )}
                    {idea.the_trade.short && (
                      <div className="idea-fact"><span className="k">Sell short</span><span className="v">{idea.the_trade.short}</span></div>
                    )}
                    <div className="idea-fact"><span className="k">Horizon</span><span className="v">{idea.horizon || "—"}</span></div>
                    <div className="idea-fact"><span className="k">What kills it</span><span className="v">{firstClause(idea.levels?.invalidation) || '—'}</span></div>
                  </div>
                )}

                {heroChart && (
                  <div className="idea-herochart">
                    <IdeaChart spec={heroChart} series={chartSeries?.[heroChart.series]} width={560} height={104} compact />
                  </div>
                )}

                <p className="tilenote">
                  <button type="button" className="idea-more" onClick={() => setIdeaOpen(true)}>
                    Read the full note{idea.charts?.length > 1 ? ` · ${idea.charts.length} charts` : ''} →
                  </button>
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

          {/* ── supporting · the engine (short, gauges side by side) ───────── */}
          <Reveal className="tile engine-card engine-strip sp7">
            {/* Three columns across the wide card — verdict, then one gauge each
                — rather than a header stacked on two gauges crammed side by side
                in half the page width. Joe: "look at the engine tile... Youve
                got shit jammed up - it looks terrible." The card was the wrong
                shape for its contents; widening it to span 7 and letting the
                verdict take a column of its own is the fix, not smaller type. */}
            <div className="es-verdict">
              <div className="eyebrow2"><span className="dot" />The Engine</div>
              <h2>{verdictParts[0]}{verdictParts[1] && <em><br />{verdictParts[1].toLowerCase()}</em>}</h2>
              <p className="es-so">Bond volatility called S&amp;P 500 drawdowns better than fifteen other stress gauges since 2006.</p>
              <a className="es-link" href="/macro" onClick={go('/macro')}>See the track record ↗</a>
            </div>
            <div className="es-gauges">
              <a className="gauge" href="/macro?ind=move" onClick={go('/macro?ind=move')} style={{ '--w': `${stress.mk ?? 0}%` }}>
                <div className="gl"><span>Stress signal · MOVE</span><b>{fmt(regime.move, 0)}</b></div>
                <div className="track"><div className="fill" /><div className="pin" /></div>
                <div className="ends"><span>Risk on ≤116</span><span>Watch</span><span>Off ≥124</span></div>
                <div className={`read ${stressCls}`}>{stressMsg}</div>
              </a>
              <a className="gauge" href="/macro?ind=ust_10y" onClick={go('/macro?ind=ust_10y')} style={{ '--w': `${yld.mk ?? 0}%` }}>
                <div className="gl"><span>Yield regime · 3M Δ 10Y</span><b>{regime.yieldDeltaBp == null ? '—' : `${regime.yieldDeltaBp >= 0 ? '+' : ''}${Math.round(regime.yieldDeltaBp)}`}<i>bp</i></b></div>
                <div className="track"><div className="fill" /><div className="pin" /></div>
                <div className="ends"><span>Defl ≤−11</span><span>Neutral</span><span>Infl ≥+32</span></div>
                <div className={`read ${yCls}`}>{yMsg}</div>
              </a>
            </div>
          </Reveal>

          {/* ── supporting · upcoming data (short) ─────────────────────────── */}
          <Reveal className="tile putty-card cal-tile cal-strip sp5">
            <div className="tilehead">
              <div className="eyebrow2"><span className="dot" />Upcoming data</div>
              <a href="/macro" onClick={go('/macro')}>
                {calMeta?.counts?.total > 0 ? `All ${calMeta.counts.total} releases →` : 'Macro Overview →'}
              </a>
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

      {/* full trade-idea note */}
      {ideaOpen && idea && modalTarget && createPortal(
        <div onClick={() => setIdeaOpen(false)} className="home-v12 briefmodal-veil">
          <div onClick={(e) => e.stopPropagation()} className="briefmodal">
            <button type="button" className="briefmodal-x" onClick={() => setIdeaOpen(false)} aria-label="Close">×</button>
            <div className="eyebrow2"><span className="dot dot--gold" />Trade idea · {longDate(idea.date)}{idea.kind ? ` · ${KIND_LABEL[idea.kind] || idea.kind}` : ''}</div>
            <h2 className="briefmodal-h">{idea.title}</h2>
            <div className="briefmodal-body">
              {idea.call && <p className="idea-modal-call">{idea.call}</p>}
              {idea.position_type && (
                <p className="idea-modal-pos">
                  <span className="idea-pos">{idea.position_type}</span>
                  <span>{POSITION_NOTE[idea.position_type]}</span>
                </p>
              )}
              {idea.dek && <p className="idea-modal-dek">{idea.dek}</p>}

              <div className="idea-modal-facts">
                {[['Buy', idea.the_trade?.buy], ['Sell to pay for it', idea.the_trade?.sell],
                  ['Sell short', idea.the_trade?.short], ['How much', idea.the_trade?.sizing],
                  ['The technical version', idea.instrument], ['Horizon', idea.horizon],
                  ['Trigger', idea.levels?.trigger], ['Invalidation', idea.levels?.invalidation],
                  ['Where it goes if it works', idea.levels?.target]]
                  .filter(([, v]) => v).map(([k, v]) => (
                    <div className="idea-fact" key={k}><span className="k">{k}</span><span className="v">{v}</span></div>
                  ))}
              </div>

              {/* The two blocks that separate research from an observation: what
                  consensus believes, and the base rate the edge was measured
                  against. Joe, 2026-08-14: "You keep coming back to such basic
                  crap anyone can see." A hit rate with no unconditional baseline
                  beside it is a statistic, so the baseline renders too. */}
              {idea.variant && (
                <>
                  <p className="briefmodal-sec">Why this is not obvious</p>
                  <p><Html html={idea.variant} /></p>
                </>
              )}

              {idea.edge && (
                <>
                  <p className="briefmodal-sec">The edge, and how it was measured</p>
                  {idea.edge.summary && <p><Html html={idea.edge.summary} /></p>}
                  <div className="idea-backtest">
                    {[['Signal', idea.edge.source], ['Sample', idea.edge.backtest?.window],
                      ['Observations', idea.edge.backtest?.n],
                      ['What followed', idea.edge.backtest?.result],
                      ['Versus doing nothing', idea.edge.backtest?.baseline]]
                      .filter(([, v]) => v || v === 0).map(([k, v]) => (
                        <div className="idea-fact" key={k}><span className="k">{k}</span><span className="v">{v}</span></div>
                      ))}
                  </div>
                </>
              )}

              {idea.thesis?.length > 0 && (
                <>
                  <p className="briefmodal-sec">The case</p>
                  <ul>{idea.thesis.map((t, i) => <li key={i}><Html html={t} /></li>)}</ul>
                </>
              )}

              {/* every chart the note names, drawn from the same series the
                  evidence block cites — they cannot disagree */}
              {idea.charts?.length > 0 && (
                <>
                  <p className="briefmodal-sec">The picture</p>
                  <div className="idea-charts">
                    {idea.charts.map((c) => (
                      <IdeaChart key={c.series} spec={c} series={chartSeries?.[c.series]} width={640} height={230} />
                    ))}
                  </div>
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
