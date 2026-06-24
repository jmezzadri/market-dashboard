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

import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTweaks } from '../tweaks/TweaksContext';
import useEngineRegime from '../lib/useEngineRegime';
import useMarketLevels from '../lib/useMarketLevels';
import usePositioning from '../lib/usePositioning';
import useDailyBrief from '../lib/useDailyBrief';
import useTradingOppsTop from '../../hooks/useTradingOppsTop';
import { getWeekGrid } from '../lib/econCalendar';
import '../styles/home-system.css';

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
  { key: 'spx_index', label: 'S&P', dec: 0, suffix: '' },
  { key: 'move', label: 'MOVE', dec: 0, suffix: '' },
  { key: 'ust_10y', label: '10Y', dec: 2, suffix: '%' },
  { key: 'vix', label: 'VIX', dec: 1, suffix: '' },
  { key: 'fx_jpy', label: '¥/$', dec: 1, suffix: '' },
  { key: 'hy_ig', label: 'HY OAS', dec: 0, suffix: '' },
  { key: 'cmdty_copper', label: 'Copper', dec: 2, suffix: '' },
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
  const weeks = useMemo(() => getWeekGrid(todayISO, 3), [todayISO]);

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

  // Upcoming releases — next three dated events.
  const upcoming = useMemo(() => {
    const out = [];
    weeks.flat().forEach((day) => {
      if (day.isPast || day.iso < todayISO) return;
      (day.events || []).forEach((e) => out.push({ iso: day.iso, name: e.name || e.short, prior: e.prior }));
    });
    return out.slice(0, 3);
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

  const moversMax = useMemo(() => {
    const a = (brief?.movers || []).map((m) => Math.abs(m.pct || 0));
    return a.length ? Math.max(...a) : 1;
  }, [brief]);

  return (
    <div className="home-v11">
      <div className="shell">

        {/* ── header ── */}
        <div className="hdr">
          <div className="logo">Macro<i>Tilt</i></div>
          <div className="hdr-r">
            <span className="pill">Prior close{newestAsOf ? ` · ${shortDate(newestAsOf)}` : ''}</span>
            <span className="pill">Market {marketOpen ? 'open' : 'closed'} · {todayLabel}</span>
            <div className="toggle" onClick={flip} role="button" aria-label="Toggle light or dark theme">
              <span className="opt sun">☀</span><span className="opt moon">☾</span>
            </div>
          </div>
        </div>

        {/* ── ribbon ── */}
        <div className="ribbon glass">
          {RIBBON.map((r) => {
            const lv = level(r.key);
            const d = ddParts(lv?.dd, r.dec);
            return (
              <a key={r.key} className="rc" href="/indicators" onClick={go('/indicators')}>
                <span className="rk">{r.label}</span>
                <span className="rv num">{lv ? fmt(lv.value, r.dec) + r.suffix : '—'}</span>
                <span className={`rd ${d.cls}`}>{d.arrow}{d.txt} close</span>
              </a>
            );
          })}
        </div>

        <div className="layout">

          {/* ── LEFT: editorial ── */}
          <div className="glass editorial">
            <div className="ed-eyebrow">● {brief?.eyebrow || 'Morning Brief'}</div>
            <h1>{brief?.headline || 'Reading the tape…'}</h1>
            {brief?.stance && <Html tag="p" className="stance" html={brief.stance} />}

            {brief?.news?.length > 0 && (
              <div className="hl news">
                <h3>Key News &amp; Events</h3>
                {brief.news.map((n, i) => (
                  <div className="ni" key={i}><span className="d" /><div><b>{n.head}</b> — <Html html={n.body} /></div></div>
                ))}
              </div>
            )}

            {brief?.implications?.length > 0 && (
              <div className="hl">
                <h3>Implications</h3>
                <ul className="impl">{brief.implications.map((t, i) => <li key={i}><Html html={t} /></li>)}</ul>
              </div>
            )}

            {brief?.watch?.length > 0 && (
              <div className="hl watch">
                <h3>What to Watch Today</h3>
                {brief.watch.map((w, i) => (
                  <div className="wi" key={i}><span className="d" /><div><b>{w.head}</b> — <Html html={w.body} /></div></div>
                ))}
              </div>
            )}

            <div className="divider">The detail</div>

            {(brief?.sections || []).map((s, i) => (
              <div className="sec" key={i}>
                <div className="sh">{s.title}</div>
                <Html tag="p" html={s.prose} />
                <div className="tagline">
                  {s.positioning && (
                    <div className="tg pos"><span className="k">Positioning</span><span>{s.positioning}</span></div>
                  )}
                  {s.single_name && (
                    <div className="tg name"><span className="k">Single name</span><span>
                      <a className="tklink" style={{ fontWeight: 800 }} href={`/ticker/${s.single_name.ticker}`} onClick={go(`/ticker/${s.single_name.ticker}`)}>{s.single_name.ticker} ↗</a> {s.single_name.note}
                    </span></div>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* ── RIGHT: data rail ── */}
          <div className="rail">

            {/* Engine */}
            <div className="glass tile">
              <div className="th"><span className="label">The Engine</span>
                <a className="linkttl" style={{ fontSize: 10, fontWeight: 700 }} href="/macro" onClick={go('/macro')}>Macro Overview</a></div>
              <div className="verdict">{verdictParts[0]}{verdictParts[1] && <small> · {verdictParts[1]}</small>}</div>
              <div className="vsub">{regime.sleeveMix ? 'Defensive sleeve engaged.' : '100% equity, defensive on standby.'}</div>

              <div className="g">
                <div className="gtop"><span className="gname">Stress signal · MOVE</span>
                  <span className="gval num">{fmt(regime.move, 0)} <small>{(() => { const d = ddParts(level('move')?.dd, 0); return `${d.arrow}${d.txt} d/d`; })()}</small></span></div>
                <div className="gtrack">
                  <span className="z" style={{ width: `${stress.on}%`, background: 'var(--up)' }} />
                  <span className="z" style={{ width: `${stress.watch}%`, background: 'var(--amber)' }} />
                  <span className="z" style={{ width: `${stress.off}%`, background: 'var(--down)' }} />
                  {stress.mk != null && <span className="mk" style={{ left: `${stress.mk}%` }} />}
                </div>
                <div className="gbands"><span>Risk On ≤116</span><span>Watch</span><span>Off ≥124</span></div>
                <div className={`gstate ${stressCls}`}>● {stressMsg}</div>
              </div>

              <div className="g">
                <div className="gtop"><span className="gname">Yield regime · 3M Δ 10Y</span>
                  <span className="gval num">{regime.yieldDeltaBp == null ? '—' : `${regime.yieldDeltaBp >= 0 ? '+' : ''}${Math.round(regime.yieldDeltaBp)}`} <small>bp</small></span></div>
                <div className="gtrack">
                  <span className="z" style={{ width: `${yld.defl}%`, background: 'var(--up)' }} />
                  <span className="z" style={{ width: `${yld.neutral}%`, background: 'var(--track)' }} />
                  <span className="z" style={{ width: `${yld.infl}%`, background: 'var(--amber)' }} />
                  {yld.mk != null && <span className="mk" style={{ left: `${yld.mk}%` }} />}
                </div>
                <div className="gbands"><span>Defl ≤−11</span><span>Neutral</span><span>Infl ≥+32</span></div>
                <div className={`gstate ${yCls}`}>● {yMsg}</div>
              </div>
            </div>

            {/* Movers */}
            <div className="glass tile">
              <span className="label">Biggest movers · prior session</span>
              <div style={{ marginTop: 8 }}>
                {(brief?.movers || []).map((m) => {
                  const w = Math.round((Math.abs(m.pct) / moversMax) * 100);
                  const up = m.pct > 0;
                  const inner = (
                    <>
                      <span className="t tklink">{m.ticker}</span>
                      <span className="mvbar"><i className={up ? 'upbar' : ''} style={{ width: `${w}%` }} /></span>
                      <span className={`p ${up ? 'upp' : ''}`}>{up ? '+' : '−'}{Math.abs(m.pct)}%</span>
                      <span className="chev">›</span>
                    </>
                  );
                  return m.link
                    ? <a key={m.ticker} className="lk mv" href={`/ticker/${m.ticker}`} onClick={go(`/ticker/${m.ticker}`)}>{inner}</a>
                    : <div key={m.ticker} className="mv">{inner}</div>;
                })}
              </div>
              <div className="mvcap">Prior cash session · refreshes each morning.</div>
            </div>

            {/* Macro indicators */}
            <div className="glass tile">
              <div className="th"><span className="label">Macro Indicators</span>
                <a className="linkttl" style={{ fontSize: 10, fontWeight: 700 }} href="/indicators" onClick={go('/indicators')}>All Indicators</a></div>
              <div style={{ marginTop: 3 }}>
                {IND_ROWS.map((row) => {
                  const lv = level(row.key);
                  const d = ddParts(lv?.dd, row.dec);
                  return (
                    <a key={row.key} className="lk irow" href="/indicators" onClick={go('/indicators')}>
                      <span className="g1">{row.g}</span>
                      <span style={{ marginLeft: 'auto' }}>{row.name} <span className="v1 num">{lv ? fmt(lv.value, row.dec) + row.suffix : '—'}</span>
                        <span className={`chg ${d.cls}`}>{d.arrow}{d.txt}</span><span className="chev">›</span></span>
                    </a>
                  );
                })}
              </div>
            </div>

            {/* Positioning */}
            <div className="glass tile">
              <div className="th"><span className="label">Positioning · COT extremes</span>
                <a className="linkttl" style={{ fontSize: 10, fontWeight: 700 }} href="/macro" onClick={go('/macro')}>Macro Overview</a></div>
              <div style={{ marginTop: 3 }}>
                {(posRows || []).map((p, i) => (
                  <a key={i} className="lk prow" href="/macro" onClick={go('/macro')}>
                    <span>{p.market}</span>
                    <span><span className={`lean ${p.lean}`}>{p.label}</span><span className="chev">›</span></span>
                  </a>
                ))}
                {posRows && posRows.length === 0 && <div className="mvcap">No positioning extremes right now.</div>}
              </div>
            </div>

            {/* Scanner */}
            <div className="glass tile">
              <div className="th"><span className="label">Trading Scanner</span>
                <a className="linkttl" style={{ fontSize: 10, fontWeight: 700 }} href="/scanner" onClick={go('/scanner')}>Trading Scanner</a></div>
              <div>
                {topScan.map((r) => (
                  <a key={r.ticker} className="lk nm-row" href={`/ticker/${r.ticker}`} onClick={go(`/ticker/${r.ticker}`)}>
                    <div><span className="tk tklink">{r.ticker}</span><span className="chip">HIGH</span></div>
                    <div><span className="score num">{fmt(r.score, 1)}</span><span className="chev">›</span></div>
                  </a>
                ))}
              </div>
              {bandCounts && <div className="mvcap">{bandCounts.total} longs cleared · {bandCounts.score5} top conviction.</div>}
            </div>

            {/* Upcoming data */}
            <div className="glass tile">
              <span className="label">Upcoming data</span>
              <div style={{ marginTop: 5 }}>
                {upcoming.map((u, i) => (
                  <a key={i} className="lk cal-ev" href="/macro" onClick={go('/macro')}>
                    <b>{weekdayDate(u.iso)}</b><span>{u.name}{u.prior ? ` · prev ${u.prior}` : ''} <span className="chev">›</span></span>
                  </a>
                ))}
                {upcoming.length === 0 && <div className="mvcap">No scheduled releases in the next two weeks.</div>}
              </div>
            </div>

          </div>
        </div>

        <p className="cap">Lands every morning as a recap of the prior session — news, implications and what to watch lead; the detail and live data follow. Every level is prior-close. Use ☀ / ☾ to switch themes.</p>
      </div>
    </div>
  );
}
