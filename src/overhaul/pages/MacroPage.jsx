/* Macro Overview — refactored 2026-05-27 per Joe Path-A directive.

   Catalog: 1 violation — DOMAIN_TITLE one-liners (Path-A exception #3:
   design copy, never gets stale, kept verbatim).

   Style refactor (zero inline style={{...}} after this commit):
   - "On this page" right card uses .mc-onthispage / .mc-otpval /
     .mc-otpsub / .mc-otprow classes from the prototype port instead of
     inline-styled approximations.
   - Filter bar uses .mc-filterbar / .mc-legend / .mc-legend--push.
   - Section spacing uses --tight / --tight2 / --flush variants.
   - Loading state uses .mt-loadingcard.

   Behavior preserved:
   - All counts derived from real useIndicators() hook.
   - Domain-strip freshness chip points to the OLDEST indicator in the
     domain (most likely to fail SLA first).
   - View toggle persists to localStorage.

   Cream rebrand Phase B (2026-07-07): page moved from the home-v11 glass
   scope to the shared home-v12 cream system (cream-system.css) with page
   styles in macro-v13.css (v13 system, 2026-09-01). RESKIN ONLY — classNames, layout wrappers and
   CSS; zero data/logic/chip changes. */

import React, { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams } from 'react-router-dom';
import FreshnessChip from '../components/FreshnessChip';
import { useFreshness } from '../../hooks/useFreshness';
import RegimeCanvas from '../components/RegimeCanvas';
import IndicatorCard from '../components/IndicatorCard';
import IndicatorDetail from '../components/IndicatorDetail';
import PositioningDetail from '../components/PositioningDetail';
import useIndicators from '../lib/useIndicators';
import useEngineRegime from '../lib/useEngineRegime';
import '../styles/cream-system.css';
import '../styles/v13.css';
import '../styles/macro-v13.css';
import '../styles/modal.css';
import BigHistoryChart from '../components/BigHistoryChart';
import IndexOverlayToggles from '../components/IndexOverlayToggles';
import DomainBars from '../components/DomainBars';
import EngineReadBand from '../components/EngineReadBand';
import Sparkline from '../components/Sparkline';
import DetailModal from '../components/DetailModal';

const DOMAINS = ['Rates', 'Credit', 'Equities', 'Commodities', 'FX', 'Financial Conditions & Economy'];
// Path-A exception #3 (Joe 2026-05-27): design copy, never gets stale, keep.
const DOMAIN_TITLE = {
  Rates: 'The cost and shape of money.',
  Credit: 'Stress in lending markets.',
  Equities: 'Valuation, volatility, breadth.',
  Commodities: 'Metals, energy, and grains.',
  FX: 'The dollar and major currencies.',
  'Financial Conditions & Economy': 'Growth, jobs, and broad financial conditions.',
};

function loadView() {
  try {
    return window.localStorage.getItem('mt.overhaul.macro.view') || 'map';
  } catch {
    return 'map';
  }
}
function saveView(v) {
  try { window.localStorage.setItem('mt.overhaul.macro.view', v); } catch {}
}

// Domain-level freshness chip: bind to the oldest indicator in the domain
// (the one most likely to fail SLA first). useFreshness can't be called in
// a loop, so this is the cleanest one-chip aggregation we can do safely.
function DomainFreshness({ inds }) {
  const oldest = useMemo(() => {
    if (!inds?.length) return null;
    return [...inds].sort((a, b) => String(a.asOf || '').localeCompare(String(b.asOf || '')))[0];
  }, [inds]);
  if (!oldest) return null;
  return <FreshnessChip elementId={oldest.manifestId || `indicator-${oldest.id}-daily`} variant="dot" />;
}

// Positioning read inside a domain tile. Observation layer (CFTC COT): one
// plain-English "so what" plus a single-track read of the domain's headline
// market — filled dot = the speculative crowd, open dot = commercial hedgers,
// amber link = the two sit at opposite extremes (a divergence). Styled with
// theme tokens only, so it follows light/dark like everything else.
function DomainPositioning({ data }) {
  if (!data) return null;
  const wrap = { marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--mt-line-1)' };
  const label = { fontSize: 9, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--mt-ink-3)', fontWeight: 700, marginBottom: 5 };
  if (data.none) {
    return (
      <div style={wrap}>
        <div style={label}>Positioning</div>
        <div style={{ fontSize: 11.5, color: 'var(--mt-ink-3)', lineHeight: 1.4 }}>{data.takeaway}</div>
      </div>
    );
  }
  const h = data.headline || {};
  const lo = Math.min(h.spec, h.comm);
  const hi = Math.max(h.spec, h.comm);
  const conn = h.div ? 'var(--mt-warn)' : 'var(--mt-ink-3)';
  const dot = { position: 'absolute', top: '50%', width: 10, height: 10, borderRadius: '50%', transform: 'translate(-50%,-50%)' };
  return (
    <div style={wrap}>
      <div style={label}>Positioning</div>
      <div style={{ fontSize: 11.5, color: 'var(--mt-ink-1)', lineHeight: 1.4 }}>{data.takeaway}</div>
      <div style={{ position: 'relative', height: 6, background: 'var(--mt-surface-3)', borderRadius: 4, marginTop: 8 }}>
        <span style={{ position: 'absolute', top: '50%', height: 3, transform: 'translateY(-50%)', left: `${lo}%`, width: `${hi - lo}%`, background: conn, borderRadius: 2 }} />
        <span style={{ ...dot, left: `${h.spec}%`, background: 'var(--mt-accent)' }} />
        <span style={{ ...dot, left: `${h.comm}%`, background: 'var(--mt-bg)', border: '2px solid var(--mt-ink-3)' }} />
      </div>
    </div>
  );
}

// 1 -> "1st", 22 -> "22nd", 13 -> "13th" — fixes the "1th percentile" bug.
function ordSuffix(n){ const v=Math.abs(Math.round(n)), k=v%100; if(k>=11&&k<=13) return 'th'; return {1:'st',2:'nd',3:'rd'}[v%10]||'th'; }
function ord(n){ return `${Math.round(n)}${ordSuffix(n)}`; }
// One plain-English line on what each futures market IS, shown above the
// standard speculator/hedger explanation in the positioning panel
// (Joe-approved Rates batch 2026-06-10; other domains land with their batches).
const MARKET_BLURB = {
  '3M SOFR': "Futures on short-term US interest rates — the purest bet on the Fed's path.",
  '2Y Treasury': "Futures on 2-year Treasuries — positioning on near-term Fed policy.",
  '5Y Treasury': "Futures on 5-year Treasuries — the belly of the curve, where Fed path and growth views meet.",
  '10Y Treasury': "Futures on 10-year Treasuries — positioning on the benchmark long rate.",
  'Ultra Bond': "Futures on the longest-maturity Treasuries (25+ years) — the biggest duration bet on the board.",
  'Investment-grade bonds': "Primary dealers' net inventory of investment-grade corporate bonds — how much quality credit risk Wall Street is warehousing.",
  'High-yield bonds': "Primary dealers' net inventory of junk bonds — how much speculative credit risk Wall Street is warehousing.",
  'S&P 500': "Futures on the S&P 500 — speculative positioning in US large-cap equities.",
  'Nasdaq 100': "Futures on the Nasdaq-100 — speculative positioning in US mega-cap technology.",
  'Russell 2000': "Futures on the Russell 2000 — speculative positioning in US small-caps, the most domestically exposed segment.",
  'VIX': "Futures on the VIX index — positioning on future volatility itself. Speculators are structurally net short VIX futures: the futures curve usually sits above spot, so the standing trade is selling futures to harvest the roll-down (the volatility risk premium). The raw sign is therefore always short — the percentile against its own range is the signal. Deeply stretched shorts have historically preceded sharp volatility spikes when the trade unwinds (February 2018, August 2024).",
  'WTI Crude': "Futures positioning in NYMEX WTI crude oil.",
  'Natural Gas': "Futures positioning in NYMEX Henry Hub natural gas.",
  'Gold': "Futures positioning in COMEX gold.",
  'Silver': "Futures positioning in COMEX silver.",
  'Copper': "Futures positioning in COMEX copper.",
  'Corn': "Futures positioning in CBOT corn.",
  'Soybeans': "Futures positioning in CBOT soybeans.",
  'Wheat': "Futures positioning in CBOT soft red winter wheat.",
  'Sugar': "Futures positioning in ICE Sugar No. 11 — world raw sugar.",
  'Coffee': "Futures positioning in ICE Coffee C — arabica.",
  'Dollar index': "Futures positioning in the ICE US Dollar Index.",
  'Euro': "Futures positioning in euro FX — the largest currency-futures market.",
  'Japanese Yen': "Futures positioning in yen FX. Extended yen shorts have historically unwound violently when carry trades (borrowing cheap yen to buy higher-yielding assets) reverse — August 2024.",
  'British Pound': "Futures positioning in sterling FX.",
  'Canadian Dollar': "Futures positioning in Canadian dollar FX — oil-linked.",
  'Swiss Franc': "Futures positioning in Swiss franc FX — a funding and haven currency.",
  'Aussie dollar': "Futures positioning in Australian dollar FX — commodity- and China-linked.",
  'Mexican Peso': "Futures positioning in peso FX — the most-traded emerging-market currency and a carry favorite.",
};
function posState(p){ return (p<=10||p>=90)?'extreme':(p<=25||p>=75)?'elevated':'calm'; }
function stColor(s){ return s==='extreme'?'var(--mt-down)':s==='elevated'?'var(--mt-warn)':'var(--mt-up)'; }
function signedPct(p){ if (p == null || !Number.isFinite(p)) return ''; const d = Math.round(p - 50); return (d >= 0 ? '+' : '') + d; }
// Per-element freshness probe. Calls the canonical useFreshness hook once and
// reports its status up. Rendering one probe per element is the only
// React-safe way to aggregate N hook results, and it guarantees the tile
// rollup dot uses the SAME staleness logic (trading-calendar aware,
// pipeline_health-anchored) as every individual chip — so the tile and its
// chips can never disagree.
function ElemProbe({ item, onStatus }) {
  const f = useFreshness(item.id, item.asOf ? { asOfIso: item.asOf } : undefined);
  useEffect(() => { onStatus(item.id, f.status); }, [item.id, f.status, onStatus]);
  return null;
}

// Tile rollup dot: green only when every indicator AND the positioning feed in
// the bucket are within SLA. Each probe is anchored to the served data date
// (asOfIso), so the dot reflects the actual freshness of the published value
// against the manifest SLA — never a fake-green from an untracked element.
function BucketRollupDot({ inds, positioningElementId, positioningAsOf, onTip, onHideTip }) {
  const items = useMemo(() => {
    const a = (inds || []).map((i) => ({ id: i.manifestId || `indicator-${i.id}-daily`, asOf: i.asOf }));
    if (positioningElementId) a.push({ id: positioningElementId, asOf: positioningAsOf });
    return a;
  }, [inds, positioningElementId, positioningAsOf]);
  const [statuses, setStatuses] = useState({});
  const onStatus = useCallback((id, s) => {
    setStatuses((p) => (p[id] === s ? p : { ...p, [id]: s }));
  }, []);
  const vals = items.map((it) => statuses[it.id]).filter((s) => s && s !== 'loading');
  const ready = items.length > 0 && vals.length >= items.length;
  const anyRed = vals.some((s) => s === 'red');
  const anyUnknown = vals.some((s) => s === 'unknown');
  const color = !ready ? 'var(--mt-ink-3)' : anyRed ? 'var(--mt-down)' : anyUnknown ? 'var(--mt-ink-3)' : 'var(--mt-up)';
  const title = !ready ? 'Checking feeds…' : anyRed ? 'A feed in this group is past its freshness target' : anyUnknown ? 'A feed in this group is not tracked yet' : 'All feeds within SLA';
  return (
    <>
      {items.map((it) => <ElemProbe key={it.id} item={it} onStatus={onStatus} />)}
      <span
        onMouseEnter={onTip ? (e) => onTip(e, title) : undefined}
        onMouseLeave={onHideTip}
        style={{ width: 10, height: 10, borderRadius: '50%', display: 'inline-block', background: color }} />
    </>
  );
}
const SHORT = {
  '10-Year Breakeven': '10y breakeven',
  'C&I Lending Standards': 'C&I lending stds',
  'CRE Lending Standards': 'CRE lending stds',
  'Credit Distress (proxy)': 'Credit distress',
  'HY vs IG Ratio': 'HY vs IG',
  'Bank Credit Growth': 'Bank credit',
  '10-Year Real Yield': '10y real yield',
  'Equity-Credit Correlation': 'Equity-credit corr',
  'S&P 500 Breadth (50d)': 'SPX breadth (50d)',
  'S&P 500 Breadth (200d)': 'SPX breadth (200d)',
  'Nasdaq Breadth (50d)': 'NDX breadth (50d)',
  'Nasdaq Breadth (200d)': 'NDX breadth (200d)',
  'Stock valuation': 'Stock val (CAPE)',
  'Manufacturing activity': 'Mfg activity (ISM)',
  'Copper-to-gold ratio': 'Copper / gold',
  'Treasury General Account': 'Treasury acct (TGA)',
  'Dollar Index (DXY)': 'DXY',
  'Dollar index': 'DXY',
  'Euro': 'EUR',
  'Japanese Yen': 'JPY',
  'British Pound': 'GBP',
  'Canadian Dollar': 'CAD',
  'Swiss Franc': 'CHF',
  'Aussie dollar': 'AUD',
  'Mexican Peso': 'MXN',
  'Australian Dollar': 'Aussie dollar',
  'Investment-grade bonds': 'IG bonds',
  'High-yield bonds': 'HY bonds',
};
function shortLabel(n) {
  if (SHORT[n]) return SHORT[n];
  return n.length > 20 ? n.slice(0, 19) + '\u2026' : n;
}
function posRead(p){ return p>=90?'extended long':p<=10?'extended short':p>=75?'leaning long':p<=25?'leaning short':'neutral'; }
function posAccent(p){ const x=posState(p); return x==='extreme'?'var(--mt-down)':x==='elevated'?'var(--mt-warn)':'var(--mt-up)'; }

/* Engine track record — the S&P 500 with every de-risked stretch shaded, so a
   reader can judge the stress signal against what the market actually did
   instead of inferring it from a two-year colour strip. Added 2026-07-29
   alongside the confirmation filter on the stress gate. */
function EngineHistoryDetail({ weeks = [], spx = [] }) {
  const [bt, setBt] = useState(null);
  useEffect(() => {
    let c = false;
    fetch('/macrotilt_engine_backtest.json', { cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : null)).then((d) => { if (!c) setBt(d); }).catch(() => {});
    return () => { c = true; };
  }, []);

  const rows = useMemo(() => {
    if (!weeks.length || !spx.length) return [];
    const out = []; let j = 0;
    for (const w of weeks) {
      while (j + 1 < spx.length && spx[j + 1][0] <= w.date) j += 1;
      const p = spx[j];
      if (!p || p[0] > w.date || !Number.isFinite(p[1])) continue;
      out.push({ date: w.date, v: p[1], st: w.stress_state });
    }
    return out;
  }, [weeks, spx]);

  const W = 1000, H = 300, PADL = 4, PADB = 22;
  const geom = useMemo(() => {
    if (rows.length < 8) return null;
    const vs = rows.map((r) => Math.log(r.v));
    const lo = Math.min(...vs), hi = Math.max(...vs), span = hi - lo || 1;
    const x = (i) => PADL + (i / (rows.length - 1)) * (W - PADL * 2);
    const y = (v) => (H - PADB) - ((Math.log(v) - lo) / span) * (H - PADB - 10);
    const line = rows.map((r, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(r.v).toFixed(1)}`).join('');
    const bands = []; let cur = null;
    rows.forEach((r, i) => {
      const off = r.st && r.st !== 'Risk On';
      if (off && !cur) cur = { a: i, b: i, st: r.st };
      else if (off) { cur.b = i; if (r.st === 'Risk Off') cur.st = 'Risk Off'; }
      else if (cur) { bands.push(cur); cur = null; }
    });
    if (cur) bands.push(cur);
    const ticks = [];
    let lastYr = null;
    rows.forEach((r, i) => {
      const yr = r.date.slice(0, 4);
      if (yr !== lastYr && Number(yr) % 3 === 0) { ticks.push({ x: x(i), label: yr }); lastYr = yr; }
      else if (yr !== lastYr) lastYr = yr;
    });
    return { x, y, line, bands, ticks };
  }, [rows]);

  const eps = bt?.drawdowns || [];
  const v = bt?.validation;
  const fmtPct = (n) => (n == null ? '—' : `${(n * 100).toFixed(1)}%`);

  return (
    <div className="eng-track">
      <div className="mt-eyebrow">The engine · track record</div>
      <h3>Every stretch the engine spent defensive, against the S&amp;P 500</h3>
      <p className="eng-lede">
        The line is the S&amp;P 500 on a log scale since {rows[0]?.date.slice(0, 4) || '2006'}. Shaded stretches are
        the weeks the stress signal had the engine out of full equity — amber at the watch line, red at the
        de-risk line. A de-risk only starts after two consecutive Fridays above the line, which is what keeps
        one-week volatility spikes from turning into a round trip.
      </p>
      {geom ? (
        <>
          <svg viewBox={`0 0 ${W} ${H}`} className="eng-svg" preserveAspectRatio="none" role="img"
               aria-label="S&P 500 with de-risked periods shaded">
            {geom.bands.map((b, i) => (
              <rect key={i} x={geom.x(b.a)} y={0} width={Math.max(1.5, geom.x(b.b) - geom.x(b.a))}
                    height={H - PADB} fill={b.st === 'Risk Off' ? 'var(--mt-down)' : 'var(--mt-warn)'}
                    opacity={b.st === 'Risk Off' ? 0.16 : 0.13} />
            ))}
            <path d={geom.line} fill="none" stroke="var(--mt-ink-0)" strokeWidth="1.6"
                  vectorEffect="non-scaling-stroke" />
          </svg>
          <div className="eng-axis">
            {geom.ticks.map((t, i) => (
              <span key={i} style={{ left: `${(t.x / W) * 100}%` }}>{t.label}</span>
            ))}
          </div>
        </>
      ) : <p className="eng-lede">Chart data loading…</p>}

      <div className="eng-key">
        <span><i className="eng-sw off" />De-risked · 50% equity</span>
        <span><i className="eng-sw watch" />Watch · 80% equity</span>
        <span><i className="eng-sw on" />Fully invested</span>
      </div>

      {eps.length > 0 && (
        <>
          <h4 className="eng-h4">How deep each drawdown got · full backtest window, 1986 onward</h4>
          <table className="eng-tbl">
            <thead><tr><th>Episode</th><th>S&amp;P 500</th><th>The engine</th><th>Difference</th></tr></thead>
            <tbody>
              {eps.map((e) => (
                <tr key={e.name}>
                  <td>{e.name}</td>
                  <td className="num">{fmtPct(e.spy_depth)}</td>
                  <td className="num">{fmtPct(e.engine_depth)}</td>
                  <td className={`num ${e.diff_pp > 0.05 ? 'good' : ''}`}>
                    {e.diff_pp > 0.05 ? `${e.diff_pp.toFixed(1)}% shallower` : 'no material difference'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {v && (
            <p className="eng-foot">
              Full window {(bt.weekly?.[0]?.date || '').slice(0, 4)}–{(bt.weekly?.[bt.weekly.length - 1]?.date || '').slice(0, 4)}:
              {' '}the engine returned <b>{v.engine.cagr}% a year</b> against <b>{v.spy.cagr}%</b> for the S&amp;P 500,
              with a worst drawdown of <b>{fmtPct(v.engine.max_drawdown)}</b> against <b>{fmtPct(v.spy.max_drawdown)}</b>.
              Signal read at Friday close, executed the following Monday open. {bt.calibration_label}.
            </p>
          )}
        </>
      )}
    </div>
  );
}


/* Reveal — scroll-reveal wrapper, same pattern as HomePage (v12 system).
   Replays in BOTH directions; state lives in React so data-poll re-renders
   preserve the revealed class. */
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

export default function MacroPage() {
  const { active: indicators, loading, indexSeries } = useIndicators();
  const regime = useEngineRegime();
  const [engHist, setEngHist] = useState(null);
  useEffect(() => { let c=false; fetch('/macrotilt_engine_history.json',{cache:'no-cache'}).then(r=>r.ok?r.json():null).then(d=>{ if(!c) setEngHist(d?.weekly||null); }).catch(()=>{}); return ()=>{c=true;}; }, []);
  const [view, setView] = useState(loadView);
  const [stateF, setStateF] = useState('all');
  const [domain, setDomain] = useState('All');
  const [selected, setSelected] = useState(null);
  const [cotPos, setCotPos] = useState(null);
  const [selectedPos, setSelectedPos] = useState(null);
  const [selectedBucket, setSelectedBucket] = useState(null);
  const [engOpen, setEngOpen] = useState(false);
  const [tip, setTip] = useState(null);
  const showTip = (e, text) => { const r = e.currentTarget.getBoundingClientRect(); setTip({ text, x: r.left + r.width / 2, y: r.top }); };
  const hideTip = () => setTip(null);

  useEffect(() => { saveView(view); }, [view]);
  // Positioning freshness for the bars view: the CFTC report is Tuesday data
  // pulled Saturday morning. Within 6 calendar days of the report date the
  // print is current (weekend + Monday reads); after that the group dims
  // until the next pull. Mirrors Joe's "no sense looking until the refresh".
  const posDimmed = useMemo(() => {
    const iso = cotPos?.as_of;
    if (!iso) return true;
    const t = Date.parse(String(iso).slice(0, 10) + 'T00:00:00Z');
    if (!Number.isFinite(t)) return true;
    return (Date.now() - t) / 86400000 > 6;
  }, [cotPos]);
  useEffect(() => {
    let cancelled = false;
    fetch('/cot_positioning.json', { cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!cancelled) setCotPos(d); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // Deep-links from Home: /macro?ind=<id> opens an indicator detail;
  // /macro?pos=<market> opens a positioning (COT) detail.
  const [searchParams] = useSearchParams();
  useEffect(() => {
    const id = searchParams.get('ind');
    if (!id || !indicators?.length) return;
    const it = indicators.find((i) => i.id === id);
    if (it) setSelected(it);
  }, [searchParams, indicators]);
  useEffect(() => {
    const m = searchParams.get('pos');
    if (!m || !cotPos?.domains) return;
    for (const [domName, d] of Object.entries(cotPos.domains)) {
      const hit = (d.markets || []).find((x) => x.market === m);
      if (hit) { setSelectedPos({ ...hit, domain: domName }); break; }
    }
  }, [searchParams, cotPos]);
  const posCount = useMemo(() => {
    if (!cotPos || !cotPos.domains) return 0;
    let n = 0;
    Object.values(cotPos.domains).forEach((d) => {
      n += (d.markets ? d.markets.length : 0);
    });
    return n;
  }, [cotPos]);

  const filtered = useMemo(() => {
    return indicators.filter(
      (i) =>
        (stateF === 'all' || i.state === stateF) &&
        (domain === 'All' || i.domain === domain),
    );
  }, [indicators, stateF, domain]);

  const counts = useMemo(() => ({
    all: indicators.length,
    extreme: indicators.filter((i) => i.state === 'extreme').length,
    elevated: indicators.filter((i) => i.state === 'elevated').length,
    calm: indicators.filter((i) => i.state === 'calm').length,
  }), [indicators]);

  const typeCounts = useMemo(() => ({
    lead: indicators.filter((i) => i.registryTier === 1).length,
    coinc: indicators.filter((i) => i.registryTier === 2).length,
    lag: indicators.filter((i) => i.registryTier === 3).length,
  }), [indicators]);

  const byDomain = useMemo(() => {
    const out = {};
    DOMAINS.forEach((d) => { out[d] = []; });
    indicators.forEach((i) => {
      const d = DOMAINS.includes(i.domain) ? i.domain : 'Financial Conditions & Economy';
      out[d].push(i);
    });
    return out;
  }, [indicators]);

  // Catalog of every series (price/indicator + positioning) that can be
  // overlaid on any chart. Lets you put positioning on a price chart and
  // price on a positioning chart (indexed, since the scales differ).
  const overlayCatalog = useMemo(() => {
    const out = [];
    // Major equity indexes first — Joe looked for them in this dropdown
    // (2026-07-30) and they were only available as the toggle pills below it.
    // Same series the pills draw (from useIndicators.indexSeries), so the two
    // entry points can never disagree.
    (indexSeries || []).forEach((x) => { if (x.points?.length) out.push({ key: 'idx:' + x.key, label: x.label + ' (index)', points: x.points }); });
    (indicators || []).forEach((i) => { if (i.points?.length) out.push({ key: 'ind:' + i.id, label: i.name, points: i.points }); });
    if (cotPos?.domains) Object.values(cotPos.domains).forEach((d) => (d.markets || []).forEach((m) => {
      if (m.history?.length) out.push({ key: 'pos:' + m.market, label: m.market + ' (positioning)', points: m.history.map((r) => [r[0], r[1]]) });
    }));
    return out;
  }, [indicators, cotPos, indexSeries]);

  const clampPct = (x) => Math.max(0, Math.min(100, x));
  const ddOf = (ind) => { const p=ind.points; if(!p||p.length<2) return null; const last=p[p.length-1][1], prev=p[p.length-2][1]; if(!Number.isFinite(last)||!Number.isFinite(prev)) return null; const dec=Math.min(ind.decimals??2,2); const r=Number((last-prev).toFixed(dec)); if(r===0) return null; const a=Math.abs(r).toLocaleString('en-US',{minimumFractionDigits:dec,maximumFractionDigits:dec}); return {arrow:r>0?'▲':'▼', txt:a, cls:r>0?'up':'down'}; };
  const stressG = (() => { const MIN=40,MAX=160,R=MAX-MIN,m=regime.move; return { on:((116-MIN)/R)*100, watch:((124-116)/R)*100, off:((MAX-124)/R)*100, mk:m==null?null:clampPct(((m-MIN)/R)*100) }; })();
  const yieldG = (() => { const MIN=-40,MAX=60,R=MAX-MIN,b=regime.yieldDeltaBp; return { defl:((-11-MIN)/R)*100, neutral:((32- -11)/R)*100, infl:((MAX-32)/R)*100, mk:b==null?null:clampPct(((b-MIN)/R)*100) }; })();
  const verdictParts = (regime.regimeLabel || '—').split('·').map((x) => x.trim());
  const sZone = regime.stressZone, yReg = regime.yieldRegime;
  const sCls = sZone==='Risk On'?'up':sZone==='Watch'?'amb':sZone==='Risk Off'?'down':'';
  const sMsg = sZone==='Risk On'?'Calm — far from any de-risk line.':sZone==='Watch'?'Watch — approaching the de-risk line.':sZone==='Risk Off'?'Risk off — the de-risk line is breached.':'—';
  const nearInfl = yReg==='Neutral' && regime.yieldDeltaBp!=null && 32-regime.yieldDeltaBp<=8;
  const yCls = yReg==='Inflationary'?'amb':yReg==='Deflationary'?'up':nearInfl?'amb':'';
  const yMsg = yReg==='Inflationary'?'Inflationary — the Fed is back in play.':yReg==='Deflationary'?'Deflationary — a growth scare.':nearInfl?'Neutral — nearing the inflationary edge.':'Neutral.';
  const fmtV = (v, dec, unit) => { if (v==null||!Number.isFinite(v)) return '—'; const n=v.toLocaleString('en-US',{minimumFractionDigits:dec??2,maximumFractionDigits:dec??2}); return unit==='%'?n+'%':(!unit||['index','ratio','z-score'].includes(unit))?n:n+' '+unit; };
  const stateColor = (st) => st==='extreme'?'var(--down)':st==='elevated'?'var(--amber)':'var(--up)';
  const posLean = (spec) => spec<=15?{cls:'wash',txt:'Specs at low'}:spec>=85?{cls:'crowd',txt:'Specs at high'}:null;
  const openMove = () => { const it=indicators.find((i)=>i.id==='move'); if(it) setSelected(it); };
  const openYield = () => { const it=indicators.find((i)=>i.id==='ust_10y')||indicators.find((i)=>i.id==='real_rates'); if(it) setSelected(it); };
  const stateWord = (st) => st==='extreme'?'stretched (red)':st==='elevated'?'elevated (amber)':'in range (green)';
  const indTip = (ind) => { const v=fmtV(ind.value, ind.decimals, ind.unit); const L=[ind.name+' — '+v]; if(ind.pct!=null) L.push(ord(ind.pct)+' percentile of its 3-year range · '+stateWord(ind.state)); const d=(ind.narrative||ind.description||'').trim(); if(d) L.push(d.length>180?d.slice(0,177)+'…':d); L.push('Click for the full chart.'); return L.join('\n'); };
  const posTip = (m, ln) => { const L=[m.market+' · positioning']; if(Number.isFinite(m.spec)) L.push('Speculators at the '+ord(m.spec)+' percentile of their 3-year range'+(ln?(ln.cls==='wash'?' — almost no bullish bets left (contrarian floor)':' — piled in (contrarian warning)'):'')); L.push('Click for the full positioning chart.'); return L.join('\n'); };
  const moveTip = 'Stress signal · MOVE '+fmtV(regime.move,0)+'\nRisk On ≤116 · Watch 116–124 · Risk Off ≥124\nThe bond market\u2019s volatility gauge — the engine\u2019s primary de-risk trigger. Click for the full chart.';
  const yieldTip = 'Yield regime · 3-month change in the 10-year'+(regime.yieldDeltaBp!=null?', '+(regime.yieldDeltaBp>=0?'+':'')+Math.round(regime.yieldDeltaBp)+'bp':'')+'\nInflationary ≥+32 · Neutral · Deflationary ≤−11\nSets which defensive sleeve holds when the engine de-risks. Click for the full chart.';

  return (
    <div className="home-v12 v13 macro-v13">
      {tip && createPortal(
        <div className="mac-tip" style={{ left: tip.x, top: tip.y - 8 }}>{tip.text}</div>,
        document.querySelector('.mt-overhaul') || document.body,
      )}

      {/* the engine — ink card, same pattern as the shipped home page.
          (Hero header removed 2026-07-22, Joe: took up too much space.) */}
      {!loading && (
        <section className="wrap">
          <Reveal className="engine-card mac-engine">
            <div>
              <div className="eyebrow2"><span className="dot" />The Engine</div>
              <h2>{verdictParts[0]}{verdictParts[1] && <em> · {verdictParts[1]}</em>}</h2>
              {/* Copy replaced 2026-07-29. The old line quoted an equity split
                  that no longer appears anywhere on the site, and said nothing
                  about why these two dials are the ones on the card. Every
                  number below is from the workbook behind the engine spec. */}
              <p className="so">
                Bond volatility beat fifteen other stress gauges at seeing S&amp;P 500 drawdowns coming — since
                2006 it ranked the −10% quarters above the calm ones 72% of the time, against 67% for the
                equity volatility index. Above the watch line the engine de-risks, and the 3-month change in
                the 10-year picks the hedge: long Treasuries only rally into a drawdown when yields are falling.
              </p>
            </div>
            <div>
              <a className="gauge" onClick={openMove} onMouseEnter={(e)=>showTip(e, moveTip)} onMouseLeave={hideTip} style={{ '--w': `${stressG.mk ?? 0}%` }}>
                <div className="gl"><span>Stress signal · MOVE</span><b>{fmtV(regime.move,0)}</b></div>
                <div className="track"><div className="fill" /><div className="pin" /></div>
                <div className="ends"><span>Risk On ≤116</span><span>Watch</span><span>Off ≥124</span></div>
                <div className={`read ${sCls==='up'?'ok':sCls==='amb'?'warm':sCls?'bad':''}`}>{sMsg}</div>
              </a>
              <a className="gauge" onClick={openYield} onMouseEnter={(e)=>showTip(e, yieldTip)} onMouseLeave={hideTip} style={{ '--w': `${yieldG.mk ?? 0}%` }}>
                <div className="gl"><span>Yield regime · 3M Δ 10Y</span><b>{regime.yieldDeltaBp==null?'—':(regime.yieldDeltaBp>=0?'+':'')+Math.round(regime.yieldDeltaBp)} <i>bp</i></b></div>
                <div className="track"><div className="fill" /><div className="pin" /></div>
                <div className="ends"><span>Defl ≤−11</span><span>Neutral</span><span>Infl ≥+32</span></div>
                <div className={`read ${yCls==='amb'?'warm':yCls==='up'?'ok':''}`}>{yMsg}</div>
              </a>
            </div>
            {/* Regime history — FULL history, monthly cells (was the trailing 2
                years, weekly). Two years showed only the April 2025 read and
                none of the episodes the engine was built for, which read as
                evidence against the signal. Each cell takes the most defensive
                state seen in that month so a one-week de-risk stays visible. */}
            {engHist && engHist.length > 0 && (() => {
              const RANK = { 'Risk Off': 3, Watch: 2, 'Risk On': 1 };
              const YRANK = { Inflationary: 3, Deflationary: 2, Neutral: 1 };
              const months = [];
              const seen = new Map();
              engHist.forEach((w) => {
                const m = (w.date || '').slice(0, 7);
                if (!m) return;
                let cell = seen.get(m);
                if (!cell) { cell = { m, stress: 'Risk On', yreg: 'Neutral' }; seen.set(m, cell); months.push(cell); }
                if ((RANK[w.stress_state] || 0) > (RANK[cell.stress] || 0)) cell.stress = w.stress_state;
                if ((YRANK[w.yield_regime] || 0) > (YRANK[cell.yreg] || 0)) cell.yreg = w.yield_regime;
              });
              const sC = (x) => x==='Risk On'?'var(--up)':x==='Watch'?'var(--amber)':x==='Risk Off'?'var(--down)':'var(--track)';
              const yC = (x) => x==='Deflationary'?'var(--up)':x==='Inflationary'?'var(--amber)':'var(--track)';
              const first = months[0]?.m || '';
              return (
                <div className="mac-hist mac-hist--click" role="button" tabIndex={0}
                     onClick={() => setEngOpen(true)}
                     onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setEngOpen(true); } }}>
                  <div className="mac-histlbl">
                    Regime history · monthly since {first.slice(0, 4)} · top: stress signal · bottom: yield regime
                    <span className="mac-histcta">See it against the market ↗</span>
                  </div>
                  <div className="mac-histrow">{months.map((w)=><span key={w.m} onMouseEnter={(e)=>showTip(e, w.m+' · Stress: '+w.stress)} onMouseLeave={hideTip} style={{ background: sC(w.stress) }} />)}</div>
                  <div className="mac-histrow">{months.map((w)=><span key={w.m} onMouseEnter={(e)=>showTip(e, w.m+' · Yield: '+w.yreg)} onMouseLeave={hideTip} style={{ background: yC(w.yreg) }} />)}</div>
                  <div className="mac-histaxis"><span>{first}</span><span>now</span></div>
                </div>
              );
            })()}
          </Reveal>
        </section>
      )}

      {/* six domain tiles — putty cards with indicator + positioning rows */}
      {!loading && (
        <section className="wrap">
          <Reveal className="mac-catgrid">
            {DOMAINS.map((dom) => {
              const inds = byDomain[dom] || [];
              const markets = cotPos?.domains?.[dom]?.markets || [];
              const ext = inds.filter((i) => i.state==='extreme').length;
              const elev = inds.filter((i) => i.state==='elevated').length;
              return (
                <div key={dom} className="mac-cat">
                  <div className="mac-cathead"><span className="mac-catname">{dom==='Financial Conditions & Economy'?'Fin Cond & Economy':dom}</span>{(ext||elev)>0 && <span className="mac-catcount" style={{ color: ext?'var(--down)':'var(--amber)' }}>{ext||elev} {ext?'stretched':'elevated'}</span>}</div>
                  <div className="mac-rows">
                    {inds.map((ind) => { const dd=ddOf(ind); return (
                      <a key={ind.id} className="mac-irow" onClick={() => setSelected(ind)} onMouseEnter={(e)=>showTip(e, indTip(ind))} onMouseLeave={hideTip}>
                        <span className="mac-nm"><span className="mac-dot" style={{ background: stateColor(ind.state) }} /><span className="mac-name">{ind.name}</span></span>
                        <span className="mac-val">{fmtV(ind.value, ind.decimals, ind.unit)}</span>
                        <span className={'mac-chg'+(dd?' '+dd.cls:'')}>{dd ? dd.arrow+dd.txt : ''}</span>
                        <span className="mac-pct">{ind.pct!=null ? ord(ind.pct) : ''}</span>
                        <span className="mac-chev">›</span>
                      </a>
                    ); })}
                    {markets.length > 0 && (
                      <div className="mac-poshead">Positioning · COT extremes</div>
                    )}
                    {markets.map((m) => { const ln=posLean(m.spec); const ps = (m.spec<=10||m.spec>=90)?'extreme':(m.spec<=25||m.spec>=75)?'elevated':'calm'; let chg=''; const h=m.history; if(Array.isArray(h)&&h.length>=2){ const c=h[h.length-1][1], p=h[h.length-2][1]; if(Number.isFinite(c)&&Number.isFinite(p)){ const r=Number((c-p).toFixed(1)); if(r!==0) chg=(r>0?'▲':'▼')+Math.abs(r).toFixed(1); } } return (
                      <a key={'pos-'+m.market} className="mac-irow" onClick={() => setSelectedPos({ ...m, domain: dom })} onMouseEnter={(e)=>showTip(e, posTip(m, ln))} onMouseLeave={hideTip}>
                        <span className="mac-nm"><span className="mac-dot" style={{ background: stateColor(ps) }} /><span className="mac-name">{m.market}</span></span>
                        <span className="mac-lean">{ln ? <span className={'lean '+ln.cls}>{ln.txt}</span> : ''}</span>
                        <span className="mac-chg mut">{chg}</span>
                        <span className="mac-pct">{Number.isFinite(m.spec) ? ord(m.spec) : ''}</span>
                        <span className="mac-chev">›</span>
                      </a>
                    ); })}
                    {inds.length===0 && markets.length===0 && <div className="mac-empty">No live elements.</div>}
                  </div>
                </div>
              );
            })}
          </Reveal>
        </section>
      )}

      {loading && <section className="wrap"><div className="mac-loading">Loading…</div></section>}

      {selected && (
        <DetailModal onClose={() => setSelected(null)}>
          <IndicatorDetail ind={selected} onClose={() => setSelected(null)} catalog={overlayCatalog} indexSeries={indexSeries} />
        </DetailModal>
      )}
      {engOpen && (
        <DetailModal onClose={() => setEngOpen(false)}>
          <EngineHistoryDetail
            weeks={engHist || []}
            spx={(indexSeries.find((x) => x.key === 'spx_index') || {}).points || []}
          />
        </DetailModal>
      )}
      {selectedPos && (
        <DetailModal onClose={() => setSelectedPos(null)}>
          <PositioningDetail
            item={selectedPos}
            domain={selectedPos.domain}
            blurb={MARKET_BLURB[selectedPos.market]}
            onClose={() => setSelectedPos(null)}
          />
        </DetailModal>
      )}
    </div>
  );
}
