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
import useLseLive from '../../hooks/useLseLive';
import IndicatorDrillModal from '../components/IndicatorDrillModal';
import IndexDrillModal, { INDEX_DRILLS } from '../components/IndexDrillModal';
import useDailyBrief from '../lib/useDailyBrief';
import useEconCalendar from '../lib/useEconCalendar';
import useTradeIdea from '../lib/useTradeIdea';
import useIndicatorSeries from '../lib/useIndicatorSeries';
import IdeaChart from '../components/IdeaChart';
import TradeIdeaNoteModal, { KIND_LABEL, POSITION_NOTE } from '../components/TradeIdeaNote';
import { nyseMarketState } from '../chrome/PageHeader';
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

/* Market tape.
   `pct: true`  — an equity index, quoted the way equity indexes are quoted:
                  percent, not points (Joe 2026-08-18).
   `live`       — the quote symbol pulled through the shared live-quote path
                  (LSE primary, Yahoo fallback). Present only on the three
                  equity indexes: during the session they show the live level
                  and the live move; outside it, the last close. The remaining
                  tiles are macro series that only ever print daily, so they
                  stay on indicator_history and stay labelled "close".
   All three indexes already have stored daily history in indicator_history
   (spx_index / ndx_index / dji_index, ~5,200 sessions each — they back the
   "Add index to chart" overlays), so the live quote is the headline and the
   stored close is the fallback. An earlier version of this comment claimed we
   carried no Dow history; that was wrong and is corrected here rather than
   left to be re-read as fact.
   `ind`         — the registry indicator this tile drills into. Clicking opens
                  that indicator's full detail RIGHT HERE (Joe 2026-08-18:
                  "I just want to stay on home page"). Previously every tile
                  was an <a href="/macro?ind=…">, so one click both navigated
                  to Macro and popped a modal over it — the modal was the part
                  he wanted. Reading a level on the home page is not a reason
                  to leave the home page.
   `idx`         — the three equity indexes drill too, but into their OWN panel
                  (IndexDrillModal), not IndicatorDetail. They are levels, not
                  registry indicators: a percentile of the S&P's own level is
                  not a statistic, just a restatement of the fact that indexes
                  trend. Their panel shows what a level supports — trailing
                  returns, drawdown from the window high, the chart — with no
                  percentile bar and no amber/red bands. */
const RIBBON = [
  { key: 'spx_index', label: 'S&P', dec: 0, suffix: '', live: '^GSPC', pct: true, idx: 'spx_index' },
  { key: 'ndx_index', label: 'NASDAQ', dec: 0, suffix: '', live: '^IXIC', pct: true, idx: 'ndx_index' },
  { key: 'dji_index', label: 'DOW', dec: 0, suffix: '', live: '^DJI', pct: true, idx: 'dji_index' },
  { key: 'move', label: 'MOVE', dec: 0, suffix: '', ind: 'move' },
  { key: 'ust_10y', label: '10Y', dec: 2, suffix: '%', ind: 'ust_10y' },
  { key: 'vix', label: 'VIX', dec: 1, suffix: '', ind: 'vix' },
  { key: 'fx_jpy', label: '¥/$', dec: 1, suffix: '', ind: 'fx_jpy' },
  { key: 'hy_ig', label: 'HY OAS', dec: 0, suffix: '', ind: 'hy_ig' },
  { key: 'cmdty_copper', label: 'Copper', dec: 2, suffix: '', ind: 'cmdty_copper' },
];
const RIBBON_LIVE_SYMS = RIBBON.filter((r) => r.live).map((r) => r.live);

/* One tape tile's numbers, resolved once so the value, the change and the
   as-of label can never come from different observations. */
function tapeTile(r, lv, liveQ) {
  const live = r.live && liveQ && liveQ.covered && liveQ.price != null ? liveQ : null;
  if (live) {
    const base = live.prevClose != null && live.prevClose > 0 ? live.prevClose : null;
    return {
      value: live.price,
      pct: base != null ? ((live.price / base) - 1) * 100 : null,
      dd: base != null ? live.price - base : null,
      stamp: 'live',
    };
  }
  if (!lv) return null;
  const prev = lv.dd != null ? lv.value - lv.dd : null;
  return {
    value: lv.value,
    pct: prev > 0 && lv.dd != null ? (lv.dd / prev) * 100 : null,
    dd: lv.dd,
    stamp: 'close',
  };
}

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

/* What the position IS, in one hover. The badge answers "am I shorting
   anything?" before the reader meets a single number — Joe, 2026-08-13. */

export default function HomePage() {
  const navigate = useNavigate();
  const go = (path) => (e) => { e.preventDefault(); navigate(path); };

  const { tweaks, setTweak } = useTweaks();
  const isDark = tweaks.theme !== 'light';
  const flip = () => setTweak('theme', isDark ? 'light' : 'navy');

  const { level, hist: levelHist } = useMarketLevels();
  /* The equity indexes ride the same live-quote path as every other price on
     the site — one resolver, so the tape and a ticker page can never tell the
     user two different stories about the same session. */
  const ribbonLive = useLseLive(RIBBON_LIVE_SYMS);
  // Which indicator's drill is open, or null. One piece of state; the modal
  // resolves everything else itself.
  const [drillInd, setDrillInd] = useState(null);
  // Index levels get their own panel — see IndexDrillModal for why.
  const [drillIdx, setDrillIdx] = useState(null);
  const regime = useEngineRegime();
  const { brief } = useDailyBrief();
  const { days: calDays, meta: calMeta, todayISO, failed: calFailed } = useEconCalendar({ maxTier: 2, limit: 4 });
  const { idea, nextPublish } = useTradeIdea();

  // Charts are declarative: the note names series that already exist in
  // indicator_history.json and the site draws them. The 4.5 MB history file is
  // only fetched once a note is actually on screen asking for a chart.
  const chartKeys = useMemo(() => (idea?.charts || []).map((c) => c.series), [idea]);
  const { series: chartSeries } = useIndicatorSeries(chartKeys);

  // Footer: market state + honest "data as of" (newest displayed level).
  // 2026-08-18: this was a SECOND, private market clock — weekday plus
  // 9:30-16:00, no holiday table, two states where the header has four. It
  // disagreed with the header every weekday morning ("Market pre-open" up top,
  // "market closed" down here at the same instant) and on an NYSE holiday it
  // would have read "market open" outright. It now calls the same function the
  // header renders, lowercased to match this strip's voice.
  const marketLabel = nyseMarketState().label.toLowerCase();
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
            const t = tapeTile(r, level(r.key), ribbonLive.bySymbol?.[r.live]);
            // Equity indexes quote in percent; macro series quote in their own
            // native unit, where a point change is the meaningful number.
            const d = r.pct ? ddParts(t?.pct, 2) : ddParts(t?.dd, r.dec);
            const inner = (
              <>
                <span className="tk">{r.label}</span>
                <span className="tv">{t ? fmt(t.value, r.dec) + r.suffix : '—'}</span>
                <span className={`td ${d.cls || 'fl'}`}>
                  {d.txt ? `${d.arrow} ${d.txt.replace(/^[+−-]/, '')}${r.pct ? '%' : ''}` : '—'}{' '}
                  <small>{t?.stamp || 'close'}</small>
                </span>
              </>
            );
            // A tile with an indicator behind it opens that indicator's detail
            // in place. A tile without one is a quote, not a link — it must
            // not look clickable (LESSONS: an affordance that does nothing is
            // a bug report waiting to happen).
            const openDrill = r.ind
              ? () => setDrillInd(r.ind)
              : (r.idx && INDEX_DRILLS[r.idx] ? () => setDrillIdx(r.idx) : null);
            return openDrill ? (
              <button
                key={r.key}
                type="button"
                className="t t--drill"
                onClick={openDrill}
                title={`${r.label} — open detail`}
              >
                {inner}
              </button>
            ) : (
              <div key={r.key} className="t t--static">{inner}</div>
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
                    <IdeaChart spec={heroChart} series={chartSeries?.[heroChart.series]} asOf={idea?.date} width={560} height={104} compact />
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
              <button type="button" className="gauge" onClick={() => setDrillInd('move')} style={{ '--w': `${stress.mk ?? 0}%` }}>
                <div className="gl"><span>Stress signal · MOVE</span><b>{fmt(regime.move, 0)}</b></div>
                <div className="track"><div className="fill" /><div className="pin" /></div>
                <div className="ends"><span>Risk on ≤116</span><span>Watch</span><span>Off ≥124</span></div>
                <div className={`read ${stressCls}`}>{stressMsg}</div>
              </button>
              <button type="button" className="gauge" onClick={() => setDrillInd('ust_10y')} style={{ '--w': `${yld.mk ?? 0}%` }}>
                <div className="gl"><span>Yield regime · 3M Δ 10Y</span><b>{regime.yieldDeltaBp == null ? '—' : `${regime.yieldDeltaBp >= 0 ? '+' : ''}${Math.round(regime.yieldDeltaBp)}`}<i>bp</i></b></div>
                <div className="track"><div className="fill" /><div className="pin" /></div>
                <div className="ends"><span>Defl ≤−11</span><span>Neutral</span><span>Infl ≥+32</span></div>
                <div className={`read ${yCls}`}>{yMsg}</div>
              </button>
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
          MacroTilt · data through {newestAsOf || '—'} · {marketLabel} ·{' '}
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
      {/* Indicator drill — opens over Home, never navigates away (2026-08-18). */}
      <IndicatorDrillModal indId={drillInd} onClose={() => setDrillInd(null)} />
      <IndexDrillModal indexKey={drillIdx} hist={levelHist} onClose={() => setDrillIdx(null)} />

      {ideaOpen && idea && (
        <TradeIdeaNoteModal idea={idea} chartSeries={chartSeries} onClose={() => setIdeaOpen(false)} />
      )}
    </div>
  );
}
