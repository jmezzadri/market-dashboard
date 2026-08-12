/* HomePage — the Daily-Brief home on the cream design system.
   2026-07-21 rework (Joe): the stacked full-width sections are replaced by
   a tile grid so every key read is visible without scrolling several pages —
   1 Morning Brief, 2 The Engine, 3 Macro indicators, 4 Positioning, 5 Upcoming
   data. Biggest Movers is retired; the Trading Scanner tile went 2026-08-12
   with the /scanner page (both were surfaces on retired scanners). Hero, tape, scroll-reveal and hover
   animations are kept.

   Second pass (Joe, same day): deliberate tile color SYSTEM, not inherited
   section colors — every data tile shares the neutral putty surface; ink is
   reserved for exactly one card, The Engine (the page's single most
   important read); gold is demoted from a tile background to micro-accents.
   The Engine is compact and stacks with Upcoming Data in the right column
   at similar heights (no double-height card). Positioning pills read
   Oversold / Overbought — the long contrarian phrasing is gone.

   Design rules honored (these caused the rework):
     • Engine data wins — the stress signal is MOVE (bands 116 / 124) and the
       yield regime is the 3-month change in the 10-year, both from the engine
       hook, never the brief's prose. No invented thresholds.
     • Lead with the day-over-day CHANGE on every level.
     • Durable daily slots only — the brief, the movers, the scan all refresh.
     • Prices are prior-close, labeled "close".
     • Everything links to its detail route. */

import React, { useMemo, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useTweaks } from '../tweaks/TweaksContext';
import useEngineRegime from '../lib/useEngineRegime';
import useMarketLevels from '../lib/useMarketLevels';
import usePositioning from '../lib/usePositioning';
import useDailyBrief from '../lib/useDailyBrief';
import { getWeekGrid } from '../lib/econCalendar';
import useNotableIndicators from '../lib/useNotableIndicators';
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
function shortDate(iso) {
  if (!iso) return '';
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}
function weekdayDate(iso) {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
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

const IND_ROWS = [
  { g: 'Rates', key: 'ust_10y', name: '10Y', dec: 2, suffix: '%' },
  { g: 'Credit', key: 'hy_ig', name: 'HY OAS', dec: 0, suffix: '' },
  { g: 'Equities', key: 'cape', name: 'CAPE', dec: 1, suffix: '' },
  { g: 'Commod.', key: 'cmdty_copper', name: 'Copper', dec: 2, suffix: '' },
  { g: 'FX', key: 'fx_jpy', name: 'USD/JPY', dec: 1, suffix: '' },
  { g: 'Econ', key: 'ism', name: 'ISM', dec: 1, suffix: '' },
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

export default function HomePage() {
  const navigate = useNavigate();
  const go = (path) => (e) => { e.preventDefault(); navigate(path); };

  const { tweaks, setTweak } = useTweaks();
  const isDark = tweaks.theme !== 'light';
  const flip = () => setTweak('theme', isDark ? 'light' : 'navy');

  const { level } = useMarketLevels();
  const regime = useEngineRegime();
  const { rows: posRows } = usePositioning();
  const { brief } = useDailyBrief();

  const todayISO = new Date().toISOString().slice(0, 10);
  const weeks = useMemo(() => getWeekGrid(todayISO, 6), [todayISO]);

  // Footer: market open/closed + honest "data as of" (newest displayed level).
  const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const dow = nowET.getDay();
  const mins = nowET.getHours() * 60 + nowET.getMinutes();
  const marketOpen = dow >= 1 && dow <= 5 && mins >= 570 && mins < 960;
  const newestAsOf = useMemo(() => {
    const ds = RIBBON.map((r) => level(r.key)?.asOf).filter(Boolean).sort();
    return ds.length ? ds[ds.length - 1] : null;
  }, [level]);

  // Upcoming releases — ONE row per date (all that date's releases combined),
  // next 5 dates. Skip dates whose only event is the weekly jobless claims so
  // the monthly majors fill the tile; claims still show if they share a date.
  const upcoming = useMemo(() => {
    const rows = [];
    weeks.flat().forEach((day) => {
      if (day.isPast || day.iso < todayISO) return;
      const evs = day.events || [];
      if (!evs.length) return;
      const hasMajor = evs.some((e) => !/jobless claims/i.test(e.name || e.short));
      if (!hasMajor) return;
      rows.push({ iso: day.iso, names: evs.map((e) => e.name || e.short) });
    });
    return rows.slice(0, 5);
  }, [weeks, todayISO]);

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


  // Notable indicators — Joe's rule (2026-07-07): extremes + outsized moves.
  // Tile shows the 6 most stretched; the rest fold into the "more" link.
  const { rows: notable, moreCount } = useNotableIndicators();
  const notableShown = notable.slice(0, 6);
  const notableMore = moreCount + Math.max(0, notable.length - 6);

  // Positioning tile — Joe (2026-07-21): list EVERY market at an extreme,
  // no count headline (a count that disagrees with the visible list reads
  // as a bug), and no "this week" claim — an extreme can persist for weeks;
  // the data is simply the latest weekly CFTC print.

  const fmtRoc = (v) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return '—';
    const a = Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
    return `${n < 0 ? '−' : '+'}${a}%`;
  };

  const CAD = { D: 'day', W: 'wk', M: 'mo' };
  const chgParts = (chg, dec, freq) => {
    if (chg == null || !Number.isFinite(chg)) return { cls: 'fl', txt: 'unch', cad: CAD[freq] || 'day' };
    const d = Math.min(dec ?? 2, 2);
    const r = Number(chg.toFixed(d));
    if (r === 0) return { cls: 'fl', txt: 'unch', cad: CAD[freq] || 'day' };
    const a = Math.abs(r).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
    return { cls: r > 0 ? 'up' : 'dn', txt: (r > 0 ? '\u25b2 ' : '\u25bc ') + a, cad: CAD[freq] || 'day' };
  };

  const toggleNi = (e) => { e.currentTarget.parentElement.classList.toggle('open'); };

  // Full-brief modal (Joe 2026-07-22: expanding the tile in place jacked up
  // the grid spacing — the detail now opens in a portal modal instead).
  const [briefOpen, setBriefOpen] = useState(false);
  useEffect(() => {
    if (!briefOpen) return undefined;
    const k = (e) => { if (e.key === 'Escape') setBriefOpen(false); };
    window.addEventListener('keydown', k);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', k); document.body.style.overflow = prev; };
  }, [briefOpen]);
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
                <span className={`td ${d.cls || 'fl'}`}>{d.txt ? `${d.arrow} ${d.txt.replace(/^[+\u2212-]/, '')}` : '—'} <small>close</small></span>
              </a>
            );
          })}
        </div>
      </Reveal>

      {/* six-tile grid — one surface system: putty data tiles, ink reserved
          for The Engine, gold demoted to accents. Row 1: Brief | (Engine +
          Upcoming, similar heights). Row 2: Indicators | Positioning.
          Row 3: Scanner full-width, both lists. */}
      <section className="wrap">
        <div className="bgrid">

          {/* 1 · morning brief */}
          <Reveal className="tile brief-card sp7" onClick={(e) => { const a = e.target.closest && e.target.closest('a[data-route]'); if (a) { e.preventDefault(); navigate(a.getAttribute('data-route')); } }}>
          <div className="eyebrow2"><span className="dot" />{brief?.eyebrow || 'Morning Brief'}{brief?.date ? ` · ${weekdayDate(brief.date)}` : ''}{brief?.date && brief.date < todayISO ? ' · last session' : ''}</div>
          <h1>{brief?.headline || 'Reading the tape…'}</h1>
          <div className="newslist">
            {(brief?.news || []).map((n, i) => (
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
                  <span className="hl"><b>The full brief</b> <span>— stance, implications, what to watch, and the detail</span></span>
                  <span className="plus">+</span>
                </button>
              </div>
            )}
          </div>
        </Reveal>

          {/* right column — 2 · the engine (compact) + 6 · upcoming data */}
          <div className="bcol sp5">
            <Reveal className="tile engine-card engine-tile">
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

            <Reveal className="tile putty-card cal-tile">
              <div className="tilehead">
                <div className="eyebrow2"><span className="dot" />Upcoming data</div>
                <a href="/macro" onClick={go('/macro')}>Macro Overview →</a>
              </div>
              <div className="calrows">
                {upcoming.map((u, i) => (
                  <a key={i} className="srow" href="/macro" onClick={go('/macro')}>
                    <span className="when">{weekdayDate(u.iso)}</span>
                    <span className="what">{u.names.join(' · ')}</span>
                  </a>
                ))}
                {upcoming.length === 0 && <div className="secnote">No scheduled releases coming up.</div>}
              </div>
            </Reveal>
          </div>

          {/* 3 · macro indicators */}
          <Reveal className="tile putty-card sp7">
            <div className="tilehead">
              <div className="eyebrow2"><span className="dot" />Macro indicators · at extremes or after big moves</div>
              <a href="/macro" onClick={go('/macro')}>All indicators →</a>
            </div>
            <div className="ind ind--tile">
              {notableShown.map((row) => {
                const c = chgParts(row.lastChg, row.decimals, row.freq);
                return (
                  <a key={row.id} className="ir" href={`/macro?ind=${row.id}`} onClick={go(`/macro?ind=${row.id}`)}>
                    <span className="k">{row.family}</span>
                    <span className="n">{row.name}</span>
                    <span className="why">{row.why}</span>
                    <span className="v">{fmt(row.value, Math.min(row.decimals ?? 2, 2))}{row.unit === '%' ? '%' : ''}</span>
                    <span className={`d ${c.cls}`}>{c.txt}<small>{c.cad}</small></span>
                  </a>
                );
              })}
              {notableShown.length === 0 && <div className="secnote">Nothing is stretched right now — no indicator sits at a 3-year extreme or just made an outsized move.</div>}
            </div>
            {notableMore > 0 && <p className="tilenote"><a href="/macro" onClick={go('/macro')}>{notableMore} more at extremes →</a></p>}
          </Reveal>

          {/* 4 · positioning */}
          <Reveal className="tile putty-card sp5">
            <div className="tilehead">
              <div className="eyebrow2"><span className="dot" />Positioning · COT extremes</div>
              <a href="/macro" onClick={go('/macro')}>Macro Overview →</a>
            </div>
            <div className="posrows">
              {(posRows || []).map((p2, i) => (
                <a key={i} className="srow" href={`/macro?pos=${encodeURIComponent(p2.rawMarket || p2.market)}`} onClick={go(`/macro?pos=${encodeURIComponent(p2.rawMarket || p2.market)}`)}>
                  <span className="tk">{p2.market}</span>
                  <span className={`pos-tag ${p2.lean === 'wash' ? 'os' : 'ob'}`}>{p2.lean === 'wash' ? 'Oversold' : 'Overbought'}</span>
                </a>
              ))}
              {posRows && posRows.length === 0 && <div className="secnote">No positioning extremes right now.</div>}
            </div>
            <p className="tilenote">Every market whose speculative futures positioning sits at a 3-year extreme, per the latest weekly CFTC data.</p>
          </Reveal>

          {/* Tile 5 was the Trading Scanner cross-section (insider-conviction
              top names + the Power Trend list). Removed 2026-08-12 (Joe) with
              the /scanner page it linked to: both feeds are retired site
              surfaces, and a homepage tile pointing at nothing is worse than
              one tile fewer. The producing pipelines are untouched. */}

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
    </div>
  );
}
