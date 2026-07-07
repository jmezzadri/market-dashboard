/* HomePage — the Daily-Brief home, rebuilt on the Liquid-Glass design system
   approved 2026-06-23 (Homepage_Redesign_v11_DailyBrief). Layout: top ribbon
   of live levels, a left editorial column carrying the morning brief, and a
   right data rail (The Engine, prior-session movers, macro indicators,
   positioning, the scanner, upcoming data).

   Design rules honored (these caused the rework):
     • Engine data wins — the stress signal is MOVE (bands 116 / 124) and the
       yield regime is the 3-month change in the 10-year, both from the engine
       hook, never the brief's prose. No invented thresholds.
     • Lead with the day-over-day CHANGE on every level.
     • Durable daily slots only — the brief, the movers, the scan all refresh.
     • Prices are prior-close, labeled "close".
     • Everything links to its detail route. */

import React, { useMemo, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTweaks } from '../tweaks/TweaksContext';
import useEngineRegime from '../lib/useEngineRegime';
import useMarketLevels from '../lib/useMarketLevels';
import usePositioning from '../lib/usePositioning';
import useDailyBrief from '../lib/useDailyBrief';
import useTradingOppsTop from '../../hooks/useTradingOppsTop';
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
  { key: 'move', label: 'MOVE', dec: 0, suffix: '', route: '/indicators?ind=move' },
  { key: 'ust_10y', label: '10Y', dec: 2, suffix: '%', route: '/indicators?ind=ust_10y' },
  { key: 'vix', label: 'VIX', dec: 1, suffix: '', route: '/indicators?ind=vix' },
  { key: 'fx_jpy', label: '¥/$', dec: 1, suffix: '', route: '/indicators?ind=fx_jpy' },
  { key: 'hy_ig', label: 'HY OAS', dec: 0, suffix: '', route: '/indicators?ind=hy_ig' },
  { key: 'cmdty_copper', label: 'Copper', dec: 2, suffix: '', route: '/indicators?ind=cmdty_copper' },
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
  const { rows: scanRows, bandCounts } = useTradingOppsTop(20);

  const todayISO = new Date().toISOString().slice(0, 10);
  const weeks = useMemo(() => getWeekGrid(todayISO, 6), [todayISO]);

  // Header: market open/closed + honest "data as of" (newest displayed level).
  const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const dow = nowET.getDay();
  const mins = nowET.getHours() * 60 + nowET.getMinutes();
  const marketOpen = dow >= 1 && dow <= 5 && mins >= 570 && mins < 960;
  const todayLabel = nowET.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  const newestAsOf = useMemo(() => {
    const ds = RIBBON.map((r) => level(r.key)?.asOf).filter(Boolean).sort();
    return ds.length ? ds[ds.length - 1] : null;
  }, [level]);

  // Top scanner names (cleared the gate), top 3 by score.
  const topScan = useMemo(
    () => (scanRows || []).filter((r) => (r.band ?? 0) >= 4).slice(0, 3),
    [scanRows],
  );

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

  // Only show movers that carry a real, non-zero percentage change — a stale or
  // not-yet-written brief leaves these blank, and we never want to render a row
  // of all-red bars sitting at 0% (which reads as a broken tile).
  const validMovers = useMemo(
    () => (brief?.movers || []).filter((m) => Number.isFinite(m.pct) && m.pct !== 0),
    [brief],
  );
  const moversMax = useMemo(() => {
    const a = validMovers.map((m) => Math.abs(m.pct));
    return a.length ? Math.max(...a) : 1;
  }, [validMovers]);


  // Notable indicators — Joe's rule (2026-07-07): extremes + outsized moves.
  const { rows: notable, moreCount } = useNotableIndicators();

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

  return (
    <div className="home-v12">

      {/* hero */}
      <div className="hero wrap">
        <div className="coin" style={{ width: 64, height: 64, left: '6%', top: '30%', animationDelay: '-2s' }} />
        <div className="coin" style={{ width: 38, height: 38, left: '14%', top: '64%', animationDelay: '-5s' }} />
        <div className="coin" style={{ width: 52, height: 52, right: '7%', top: '26%', animationDelay: '-1s' }} />
        <div className="coin" style={{ width: 30, height: 30, right: '15%', top: '60%', animationDelay: '-6.5s' }} />
        <Reveal className="eyebrow"><span className="dot" />{todayLabel} · {marketOpen ? 'Market open' : 'Market pre-open'}</Reveal>
        <Reveal as="h1" className="hero-h1">{verdictParts[0]}.{verdictParts[1] && <><br /><em>{verdictParts[1]}.</em></>}</Reveal>
        <Reveal as="p" className="sub">
          {regime.sleeveMix ? 'Defensive sleeve engaged.' : '100% equity, defensive on standby.'}{' '}
          Stress: {stressZone === 'Risk On' ? 'calm' : stressZone === 'Watch' ? 'watch' : stressZone === 'Risk Off' ? 'breached' : '—'} at MOVE {fmt(regime.move, 0)}.
          Yield regime: {(yReg || '—').toLowerCase()}{regime.yieldDeltaBp != null ? ` at ${regime.yieldDeltaBp >= 0 ? '+' : ''}${Math.round(regime.yieldDeltaBp)} bp` : ''}.
        </Reveal>
      </div>

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

      {/* morning brief */}
      <section className="wrap" id="brief">
        <Reveal className="brief-card" onClick={(e) => { const a = e.target.closest && e.target.closest('a[data-route]'); if (a) { e.preventDefault(); navigate(a.getAttribute('data-route')); } }}>
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
                <button type="button" onClick={toggleNi}>
                  <span className="hl"><b>The full brief</b> <span>— stance, implications, what to watch, and the detail</span></span>
                  <span className="plus">+</span>
                </button>
                <div className="body"><div>
                  {brief?.stance && <p><Html html={brief.stance} /></p>}
                  {brief?.implications?.length > 0 && (
                    <ul>{brief.implications.map((t, i) => <li key={i}><Html html={t} /></li>)}</ul>
                  )}
                  {(brief?.watch || []).map((w, i) => (
                    <p key={i}><b><Html html={w.head} /></b> — <Html html={w.body} /></p>
                  ))}
                  {(brief?.sections || []).map((sec, i) => (
                    <div key={i}>
                      <p style={{ letterSpacing: '.1em', textTransform: 'uppercase', fontSize: 12, fontWeight: 700 }}>{sec.title}</p>
                      {Array.isArray(sec.bullets) && sec.bullets.length > 0
                        ? <ul>{sec.bullets.map((bt, jx) => <li key={jx}><Html html={bt} /></li>)}</ul>
                        : <Html tag="p" html={sec.prose} />}
                      {sec.positioning && <p><b>Positioning</b> — {sec.positioning}</p>}
                      {sec.single_name && (
                        <p><b>Single name</b> — <a className="tklink" href={`/ticker/${sec.single_name.ticker}`} onClick={go(`/ticker/${sec.single_name.ticker}`)}>{sec.single_name.ticker} ↗</a> <Html html={sec.single_name.note} /></p>
                      )}
                    </div>
                  ))}
                </div></div>
              </div>
            )}
          </div>
        </Reveal>
      </section>

      {/* the engine */}
      <section className="wrap">
        <Reveal className="engine-card">
          <div>
            <div className="eyebrow2"><span className="dot" />The Engine</div>
            <h2>{verdictParts[0]}{verdictParts[1] && <em> · {verdictParts[1].toLowerCase()}.</em>}</h2>
            <p className="so">{regime.sleeveMix ? 'Defensive sleeve engaged.' : '100% equity, defensive on standby.'} <a href="/macro" onClick={go('/macro')} style={{ color: 'inherit', fontWeight: 600 }}>Macro Overview ↗</a></p>
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
      </section>

      {/* notable indicators */}
      <section className="wrap">
        <Reveal className="sechead">
          <div className="eyebrow2"><span className="dot" />Macro indicators · at extremes or after big moves</div>
          <a href="/indicators" onClick={go('/indicators')}>All indicators →</a>
        </Reveal>
        <Reveal className="ind">
          {notable.map((row) => {
            const c = chgParts(row.lastChg, row.decimals, row.freq);
            return (
              <a key={row.id} className="ir" href={`/indicators?ind=${row.id}`} onClick={go(`/indicators?ind=${row.id}`)}>
                <span className="k">{row.family}</span>
                <span className="n">{row.name}</span>
                <span className="why">{row.why}</span>
                <span className="v">{fmt(row.value, Math.min(row.decimals ?? 2, 2))}{row.unit === '%' ? '%' : ''}</span>
                <span className={`d ${c.cls}`}>{c.txt}<small>{c.cad}</small></span>
              </a>
            );
          })}
          {notable.length === 0 && <div className="secnote">Nothing is stretched right now — no indicator sits at a 3-year extreme or just made an outsized move.</div>}
        </Reveal>
        <Reveal as="p" className="ind-note">
          Everything at a 3-year extreme or after an unusually large move for its own print schedule — daily, weekly, or monthly.
          {moreCount > 0 && <> The {notable.length} most stretched are shown. <a href="/indicators" onClick={go('/indicators')}>{moreCount} more at extremes →</a></>}
        </Reveal>
      </section>

      {/* positioning */}
      <section className="wrap">
        <Reveal className="gold-card">
          <div className="eyebrow2"><span className="dot" />Positioning · COT extremes</div>
          <h2>Markets at a speculative-positioning extreme this week: {(posRows || []).length}.</h2>
          <div className="cotgrid">
            {(posRows || []).map((p2, i) => (
              <a key={i} className="cot-row" href={`/macro?pos=${encodeURIComponent(p2.rawMarket || p2.market)}`} onClick={go(`/macro?pos=${encodeURIComponent(p2.rawMarket || p2.market)}`)}>
                <span className="nm">{p2.market}</span>
                <span className="tag">{p2.label}</span>
              </a>
            ))}
            {posRows && posRows.length === 0 && <div className="secnote">No positioning extremes right now.</div>}
          </div>
          <p className="note">Weekly CFTC futures data. Every market currently at a 3-year positioning extreme is listed — lows read as a contrarian floor, highs as a contrarian warning. The list changes weekly.</p>
        </Reveal>
      </section>

      {/* movers */}
      <section className="wrap">
        <Reveal className="sechead">
          <div className="eyebrow2"><span className="dot" />Biggest movers · prior session</div>
          <a href="/scanner" onClick={go('/scanner')}>Trading scanner →</a>
        </Reveal>
        <Reveal className="mvgrid">
          {validMovers.slice(0, 6).map((m) => (
            <a key={m.ticker} className="mvt" href={`/ticker/${m.ticker}`} onClick={go(`/ticker/${m.ticker}`)}>
              <span className="mtk">{m.ticker}</span>
              <span className={`mpc ${m.pct > 0 ? 'up' : 'dn'}`}>{m.pct > 0 ? '+' : '−'}{Math.abs(m.pct)}%</span>
            </a>
          ))}
          {validMovers.length === 0 && <div className="mvt">Movers refresh after the next cash session.</div>}
        </Reveal>
      </section>

      {/* scanner + upcoming */}
      <section className="wrap">
        <Reveal className="sechead">
          <div className="eyebrow2"><span className="dot" />Trading scanner · top conviction</div>
          <a href="/scanner" onClick={go('/scanner')}>Full scanner →</a>
        </Reveal>
        <Reveal className="rows2">
          {topScan.map((r) => (
            <a key={r.ticker} className="srow" href={`/ticker/${r.ticker}`} onClick={go(`/ticker/${r.ticker}`)}>
              <span className="tk">{r.ticker}</span>
              <span className="sc">{fmt(r.score, 1)}</span>
            </a>
          ))}
        </Reveal>
        {bandCounts && <p className="secnote">{bandCounts.total} longs cleared · {bandCounts.score5} top conviction.</p>}
      </section>

      <section className="wrap">
        <Reveal className="sechead">
          <div className="eyebrow2"><span className="dot" />Upcoming data</div>
          <a href="/macro" onClick={go('/macro')}>Macro Overview →</a>
        </Reveal>
        <Reveal className="rows2">
          {upcoming.map((u, i) => (
            <a key={i} className="srow" href="/macro" onClick={go('/macro')}>
              <span className="when">{weekdayDate(u.iso)}</span>
              <span className="what">{u.names.join(' · ')}</span>
            </a>
          ))}
          {upcoming.length === 0 && <div className="secnote">No scheduled releases coming up.</div>}
        </Reveal>
      </section>

      <footer>
        <div className="micro">
          MacroTilt · data through {newestAsOf || '—'} · {marketOpen ? 'market open' : 'market closed'} ·{' '}
          <button type="button" onClick={flip} style={{ background: 'none', border: 'none', color: 'inherit', font: 'inherit', letterSpacing: 'inherit', cursor: 'pointer', textTransform: 'inherit' }}>
            switch to {isDark ? 'light' : 'dark'} theme
          </button>
        </div>
      </footer>
    </div>
  );
}
