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
   - View toggle persists to localStorage. */

import React, { useMemo, useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import FreshnessChip from '../components/FreshnessChip';
import { useFreshness } from '../../hooks/useFreshness';
import RegimeCanvas from '../components/RegimeCanvas';
import IndicatorCard from '../components/IndicatorCard';
import IndicatorDetail from '../components/IndicatorDetail';
import useIndicators from '../lib/useIndicators';
import BigHistoryChart from '../components/BigHistoryChart';
import IndexOverlayToggles from '../components/IndexOverlayToggles';
import DomainBars from '../components/DomainBars';
import MorningRead from '../components/MorningRead';
import Sparkline from '../components/Sparkline';

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

// Tile visual: 'bars' (median-anchored percentile bars — default per Joe
// 2026-06-11) or 'pills' (the name+number grid), persisted like the old view.
function loadTiles() {
  try {
    const v = window.localStorage.getItem('mt.overhaul.macro.tiles');
    return v === 'pills' ? 'pills' : 'bars';
  } catch {
    return 'bars';
  }
}
function saveTiles(v) {
  try { window.localStorage.setItem('mt.overhaul.macro.tiles', v); } catch {}
}

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
  'VIX': "Futures on the VIX index — positioning on future volatility itself. Large net-short positions have historically preceded sharp volatility spikes when short-volatility trades unwind (February 2018, August 2024).",
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
  'Japanese Yen': "Futures positioning in yen FX. Crowded yen shorts have historically unwound violently when carry trades (borrowing cheap yen to buy higher-yielding assets) reverse — August 2024.",
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
  'Dollar Index (DXY)': 'Dollar index',
  'Australian Dollar': 'Aussie dollar',
  'Investment-grade bonds': 'IG bonds',
  'High-yield bonds': 'HY bonds',
};
function shortLabel(n) {
  if (SHORT[n]) return SHORT[n];
  return n.length > 20 ? n.slice(0, 19) + '\u2026' : n;
}
function posRead(p){ return p>=90?'crowded long':p<=10?'crowded short':p>=75?'leaning long':p<=25?'leaning short':'neutral'; }
function posAccent(p){ const x=posState(p); return x==='extreme'?'var(--mt-down)':x==='elevated'?'var(--mt-warn)':'var(--mt-up)'; }

function DetailModal({ onClose, children }) {
  useEffect(() => {
    const k = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', k); document.body.style.overflow = prev; };
  }, [onClose]);
  const target = (typeof document !== 'undefined' && (document.querySelector('.mt-overhaul') || document.body)) || null;
  if (!target) return null;
  return createPortal(
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(20,23,28,.55)', zIndex: 5000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', overflowY: 'auto', padding: '32px 16px 64px' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ position: 'relative', width: 'min(1080px, 95vw)', background: 'var(--mt-surface, #fff)', borderRadius: 18, boxShadow: '0 24px 70px rgba(20,30,45,.4)' }}>
        <button onClick={onClose} aria-label="Close" style={{ position: 'absolute', top: 14, right: 16, border: 'none', background: 'none', fontSize: 26, lineHeight: 1, color: 'var(--mt-ink-3)', cursor: 'pointer', zIndex: 2 }}>×</button>
        {children}
      </div>
    </div>,
    target,
  );
}

function PositioningCard({ item, onClick }) {
  const accent = posAccent(item.spec);
  const isDealer = item.comm == null;
  const trend = (item.history || []).slice(-90).map((r) => r[1]).filter((v) => Number.isFinite(v));
  return (
    <button type="button" onClick={onClick} className="mt-card ind-card"
      style={{ textAlign: 'left', cursor: 'pointer', background: 'var(--mt-surface)', border: '1px solid var(--mt-line-0)', padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--mt-ink-0)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.market}</div>
          <div style={{ fontSize: 10.5, color: 'var(--mt-ink-2)', marginTop: 2 }}>{isDealer ? 'Dealer inventory' : 'Futures positioning'}</div>
        </div>
        <FreshnessChip elementId="indicator-cftc-cot-weekly" fallback={{ asOfIso: item.asof }} variant="dot" />
      </header>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
        <div className="num" style={{ fontSize: 22, fontWeight: 500, color: accent }}>{Math.round(item.spec)}<span style={{ fontSize: 11, color: 'var(--mt-ink-2)', marginLeft: 3, fontWeight: 400 }}>{ordSuffix(item.spec)} pct</span></div>
        <span className={`mt-tag mt-tag--${posState(item.spec) === 'extreme' ? 'extreme' : posState(item.spec) === 'elevated' ? 'elev' : 'calm'}`}>{posRead(item.spec)}</span>
      </div>
      <div style={{ color: accent }}><Sparkline data={trend} width={240} height={28} stroke={accent} showDot /></div>
      <div style={{ fontSize: 10.5, color: 'var(--mt-ink-2)' }}>{isDealer ? `dealers · net $${item.specNet}bn` : `speculators · net ${item.specNet}%`}</div>
    </button>
  );
}

function BucketPositioning({ data, onSelect }) {
  if (!data) return null;
  const items = data.markets || [];
  if (!items.length) return null;
  return (
    <div style={{ marginTop: 22 }}>
      <div className="mt-eyebrow" style={{ marginBottom: 4 }}>Positioning signals</div>
      {data.takeaway && <p className="mt-deck" style={{ marginTop: 0, marginBottom: 12 }}>{data.takeaway}</p>}
      <div className="mc-grid">
        {items.map((m) => (<PositioningCard key={m.market} item={m} onClick={() => onSelect && onSelect(m)} />))}
      </div>
    </div>
  );
}

function slicePos(points, tf) {
  if (!points || !points.length || tf === 'Max') return points || [];
  const last = new Date(points[points.length - 1][0]).getTime();
  const days = tf === '1Y' ? 365 : 3 * 365;
  const cutoff = last - days * 86400000;
  return points.filter((pt) => new Date(pt[0]).getTime() >= cutoff);
}
function PosStat({ label, v }) {
  return (<div><div style={{ fontSize: 11, color: 'var(--mt-ink-3)' }}>{label}</div><div className="num" style={{ fontSize: 20, fontWeight: 600, color: 'var(--mt-ink-0)' }}>{v}</div></div>);
}
function PositioningDetail({ item, onClose, catalog = [], indexSeries = [] }) {
  const [tf, setTf] = useState('3Y');
  const [overlayKey, setOverlayKey] = useState('');
  const [idxOn, setIdxOn] = useState({});
  const isDealer = item.comm == null;
  const h = item.history || [];
  const specAll = useMemo(() => h.map((r) => [r[0], r[1]]), [h]);
  const commAll = useMemo(() => h.map((r) => [r[0], r[2]]).filter((pt) => pt[1] != null), [h]);
  const spec = useMemo(() => slicePos(specAll, tf), [specAll, tf]);
  const comm = useMemo(() => (isDealer ? [] : slicePos(commAll, tf)), [commAll, tf, isDealer]);
  const overlay = useMemo(() => {
    if (!overlayKey) return null;
    const c = catalog.find((x) => x.key === overlayKey);
    if (!c || !c.points?.length) return null;
    return { points: slicePos(c.points, tf), label: c.label };
  }, [overlayKey, catalog, tf]);
  // Amber/red zones in value space — from the SAME trailing 3-year (156-week)
  // window the positioning percentile uses, so chart shading and pill agree.
  // Positioning is two-sided: crowded long (>=75th amber, >=90th red) AND
  // crowded short (<=25th amber, <=10th red) both warn.
  const bands = useMemo(() => {
    const vals = specAll
      .map((pt) => pt[1])
      .filter((v) => Number.isFinite(v))
      .slice(-156)
      .sort((a, b) => a - b);
    if (vals.length < 30) return [];
    const q = (f) => {
      const i = (vals.length - 1) * f;
      const lo = Math.floor(i), hi = Math.ceil(i);
      return vals[lo] + (vals[hi] - vals[lo]) * (i - lo);
    };
    const AMBER = 'var(--mt-warn)', RED = 'var(--mt-down)';
    return [
      { from: q(0.90), to: null, color: RED, opacity: 0.08, label: 'Red zone' },
      { from: q(0.75), to: q(0.90), color: AMBER, opacity: 0.10, label: 'Amber zone' },
      { from: q(0.10), to: q(0.25), color: AMBER, opacity: 0.10, label: 'Amber zone' },
      { from: null, to: q(0.10), color: RED, opacity: 0.08, label: 'Red zone' },
    ];
  }, [specAll]);
  const idxCompares = useMemo(
    () => indexSeries
      .filter((x) => idxOn[x.key] && x.points?.length)
      .map((x) => ({ points: slicePos(x.points, tf), label: x.label, color: x.color })),
    [indexSeries, idxOn, tf],
  );
  const accent = posAccent(item.spec);
  const read = item.spec >= 90 ? 'the most bullish in 3 years — crowded long, fragile to an unwind'
    : item.spec <= 10 ? 'the most bearish in 3 years — crowded short, fragile to a squeeze'
    : item.spec >= 75 ? 'in the upper part of its 3-year range'
    : item.spec <= 25 ? 'in the lower part of its 3-year range' : 'mid-range over the last 3 years';
  return (
    <div style={{ padding: 24 }}>
      <header style={{ display: 'flex', alignItems: 'baseline', gap: 16, flexWrap: 'wrap', marginBottom: 14 }}>
        <div style={{ flex: 1 }}>
          <div className="mt-eyebrow">Positioning · {isDealer ? 'dealer inventory' : 'futures'}</div>
          <div style={{ fontFamily: 'var(--mt-font-display)', fontSize: 32, fontWeight: 400, letterSpacing: '-0.02em', margin: '4px 0 0', lineHeight: 1.1 }}>{item.market}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className="num" style={{ fontSize: 32, fontWeight: 500, color: accent, lineHeight: 1 }}>{Math.round(item.spec)}<span style={{ fontSize: 14, color: 'var(--mt-ink-2)', marginLeft: 6, fontWeight: 400 }}>{ordSuffix(item.spec)} pct</span></div>
          <div style={{ marginTop: 6 }}><FreshnessChip elementId="indicator-cftc-cot-weekly" fallback={{ asOfIso: item.asof }} variant="label" /></div>
        </div>
      </header>
      <div style={{ fontSize: 14, color: 'var(--mt-ink-1)', marginBottom: 6 }}>{isDealer ? `Dealers' net inventory $${item.specNet}bn` : `Speculators net ${item.specNet}%`} — {read}.</div>
      {isDealer && Array.isArray(item.buckets) && item.buckets.length > 0 && (
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'baseline', margin: '0 0 12px' }}>
          <span style={{ color: 'var(--mt-ink-2)', textTransform: 'uppercase', letterSpacing: '.05em', fontSize: 10.5 }}>By maturity</span>
          {item.buckets.map((b) => (
            <span key={b.label} style={{ fontSize: 12.5, color: 'var(--mt-ink-2)' }}>
              {b.label} <b className="num" style={{ color: b.net < 0 ? 'var(--mt-down)' : 'var(--mt-up)' }}>{b.net < 0 ? '\u2212$' : '+$'}{Math.abs(b.net)}bn</b>
            </span>
          ))}
        </div>
      )}
      {MARKET_BLURB[item.market] && (
        <p style={{ fontSize: 13, color: 'var(--mt-ink-1)', lineHeight: 1.6, margin: '0 0 6px', fontWeight: 500 }}>
          {MARKET_BLURB[item.market]}
        </p>
      )}
      {/* How to read positioning — factual reference (Senior Quant, Joe
          directive 2026-06-10: explain what the data says about the asset,
          what extremes have meant, and why spec-vs-hedger gaps are normal).
          Static reference copy — nothing here goes stale. The dealer text is
          preserved from the NY Fed inventory PR (2026-06-10). */}
      {isDealer ? (
        <p style={{ fontSize: 12.5, color: 'var(--mt-ink-2)', lineHeight: 1.6, margin: '0 0 14px' }}>
          {"Net inventory in IG / HY corporate bonds is the balance-sheet risk that market-making banks are carrying — from the NY Fed's weekly Primary Dealer Statistics. Primary dealers are the shock absorbers of fixed income, so whether they're net long or net short reveals market liquidity, credit sentiment, and how much capital they can commit. Large net long: dealers are absorbing what institutions are dumping — a liquidity strain that's capital-expensive to hold and can widen bid-ask spreads. Flat or net short: lean inventory and low overnight risk, but little capacity to absorb heavy selling, leaving the market exposed to liquidity air pockets. IG is rate-sensitive, HY default-sensitive — dealers cutting HY while holding IG is a defensive pivot away from credit risk; cutting both is active de-risking that often precedes wider spreads. (This is a NET figure — long minus short; gross dealer books are far larger.)"}
        </p>
      ) : (
        <div style={{ fontSize: 12.5, color: 'var(--mt-ink-2)', lineHeight: 1.65, margin: '0 0 14px', display: 'grid', gap: 6 }}>
          <div><b style={{ color: 'var(--mt-ink-1)' }}>Who's in the data.</b> Speculators = hedge funds and managed money (CFTC non-commercial). Commercials = producers and merchants hedging physical exposure. The two sides roughly offset by construction — when speculators are net long, hedgers are net short — so a wide gap between the lines is normal, not a signal.</div>
          <div><b style={{ color: 'var(--mt-ink-1)' }}>What's plotted.</b> Solid line: speculators' net position as a share of open interest, ranked into its own trailing 3-year range. Dashed line: the commercials' mirror position.</div>
          <div><b style={{ color: 'var(--mt-ink-1)' }}>What extremes have meant.</b> Speculator positioning is trend-following — it rises with price, so positioning peaks usually coincide with or lag price peaks rather than lead them. At 3-year extremes the evidence is contrarian on average: crowded longs (90th+) have been followed by below-average forward returns and are exposed to forced unwinds; crowded shorts (10th−) carry squeeze risk. Academic tests find the standalone effect real but weak — an extreme measures the fuel available for a reversal, not its timing.</div>
          <div><b style={{ color: 'var(--mt-ink-1)' }}>Reading it against price.</b> Use the Overlay picker below to draw this market's price on the chart. The historical warning configurations: positioning at an extreme while price stalls, and price rising while speculator net falls (the crowd exiting into strength). The strongest flag is both groups at their own 3-year extremes at once — the amber link on the card.</div>
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div className="mt-pillgroup">
          {['1Y', '3Y', 'Max'].map((k) => (<button key={k} type="button" className={`mt-pill ${tf === k ? 'on' : ''}`} onClick={() => setTf(k)}>{k}</button>))}
        </div>
        <div style={{ fontSize: 12, color: 'var(--mt-ink-2)' }}><b className="num">{spec.length}</b> weekly reports</div>
      </div>
      {catalog.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, fontSize: 12, color: 'var(--mt-ink-2)' }}>
          <span>Overlay price / indicator:</span>
          <select value={overlayKey} onChange={(e) => setOverlayKey(e.target.value)}
            style={{ font: 'inherit', fontSize: 12, padding: '3px 8px', borderRadius: 6, border: '1px solid var(--mt-line-1)', background: 'var(--mt-surface)', color: 'var(--mt-ink-1)', maxWidth: 280 }}>
            <option value="">None</option>
            {catalog.filter((c) => c.label !== item.market).map((c) => (
              <option key={c.key} value={c.key}>{c.label}</option>
            ))}
          </select>
          {overlay && <span style={{ fontSize: 11, color: 'var(--mt-ink-3)' }}>(indexed — scales differ)</span>}
        </div>
      )}
      {indexSeries.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          <IndexOverlayToggles series={indexSeries} on={idxOn}
            onToggle={(k) => setIdxOn((prev) => ({ ...prev, [k]: !prev[k] }))} />
        </div>
      )}
      <BigHistoryChart points={spec} accent={accent} height={280} freq="W" primaryLabel={isDealer ? 'Dealer net inventory' : 'Speculators'}
        overlays={isDealer ? [] : [{ points: comm, color: 'var(--mt-ink-3)', label: 'Commercials (hedgers)', dash: '4 3' }]}
        compareData={overlay ? overlay.points : null}
        compareLabel={overlay ? overlay.label : ''}
        compares={idxCompares}
        bands={bands}
        yFormat={(v) => (isDealer ? `$${v.toFixed(1)}bn` : `${v.toFixed(1)}%`)} />
      {bands.length > 0 && (
        <div style={{ marginTop: 6, fontSize: 11, color: 'var(--mt-ink-3)' }}>
          Shaded bands mark where this signal turns amber (leaning) and red (crowded) —
          fixed to the same 3-year window that ranks the position, whatever timeframe you select.
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))', gap: 14, marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--mt-line-1)' }}>
        <PosStat label="Speculators net" v={`${item.specNet}${isDealer ? '' : '%'}`} />
        <PosStat label="Speculator percentile" v={ord(item.spec)} />
        {!isDealer && item.commNet != null && <PosStat label="Commercials net" v={`${item.commNet}%`} />}
        {item.oi != null && <PosStat label="Open interest" v={Number(item.oi).toLocaleString()} />}
      </div>
      <div style={{ marginTop: 18, paddingTop: 16, borderTop: '1px solid var(--mt-line-1)', fontSize: 12, color: 'var(--mt-ink-2)', lineHeight: 1.9 }}>
        <b>Source</b> {isDealer ? 'New York Fed primary-dealer statistics' : 'CFTC Commitments of Traders (futures + options)'}<br />
        <b>Frequency</b> Weekly · NYSE trading days · {isDealer ? 'Wednesday snapshot' : 'Tuesday snapshot'}<br />
        <b>Timing</b> {isDealer ? 'Thursday, after release' : 'Saturday 07:00 ET'}<br />
        <b>Service-level target</b> {isDealer ? '14 days' : '14 days (336 hours)'}<br />
        <b>Last update</b> {item.asof}
      </div>
    </div>
  );
}

function BucketModal({ dom, title, inds, cotPos, onClose, onSelectInd, onSelectPos }) {
  return (
    <DetailModal onClose={onClose}>
      <div style={{ padding: '24px 28px' }}>
        <div className="mt-eyebrow">{dom}</div>
        <div className="mt-h2" style={{ margin: '2px 0 18px' }}>{title}</div>
        <div style={{ fontSize: 12.5, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--mt-ink-1)', marginBottom: 12 }}>Indicators</div>
        <div className="mc-grid">
          {inds.map((i) => (<IndicatorCard key={i.id} ind={i} onClick={() => onSelectInd(i)} />))}
        </div>
        <BucketPositioning data={cotPos && cotPos.domains ? cotPos.domains[dom] : null} onSelect={onSelectPos} />
      </div>
    </DetailModal>
  );
}

export default function MacroPage() {
  const { active: indicators, loading, indexSeries } = useIndicators();
  const [view, setView] = useState(loadView);
  const [tiles, setTiles] = useState(loadTiles);
  const [stateF, setStateF] = useState('all');
  const [domain, setDomain] = useState('All');
  const [selected, setSelected] = useState(null);
  const [cotPos, setCotPos] = useState(null);
  const [selectedPos, setSelectedPos] = useState(null);
  const [selectedBucket, setSelectedBucket] = useState(null);
  const [tip, setTip] = useState(null);
  const showTip = (e, text) => { const r = e.currentTarget.getBoundingClientRect(); setTip({ text, x: r.left + r.width / 2, y: r.top }); };
  const hideTip = () => setTip(null);

  useEffect(() => { saveView(view); }, [view]);
  useEffect(() => { saveTiles(tiles); }, [tiles]);
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
    (indicators || []).forEach((i) => { if (i.points?.length) out.push({ key: 'ind:' + i.id, label: i.name, points: i.points }); });
    if (cotPos?.domains) Object.values(cotPos.domains).forEach((d) => (d.markets || []).forEach((m) => {
      if (m.history?.length) out.push({ key: 'pos:' + m.market, label: m.market + ' (positioning)', points: m.history.map((r) => [r[0], r[1]]) });
    }));
    return out;
  }, [indicators, cotPos]);

  return (
    <div className="mt-pagebody mt-fade">
      <style>{`.mc-pill{transition:filter .12s ease,transform .12s ease}.mc-pill:hover{filter:brightness(1.18);transform:translateY(-1px)}`}</style>
      {tip && createPortal(
        <div style={{ position: 'fixed', left: tip.x, top: tip.y - 8, transform: 'translate(-50%,-100%)', background: 'var(--mt-ink-1)', color: 'var(--mt-bg)', padding: '5px 9px', borderRadius: 6, fontSize: 11.5, lineHeight: 1.35, maxWidth: 280, whiteSpace: 'normal', textAlign: 'center', zIndex: 6000, pointerEvents: 'none', boxShadow: '0 6px 20px rgba(0,0,0,.22)' }}>{tip.text}</div>,
        document.querySelector('.mt-overhaul') || document.body,
      )}
      {/* Compact header (Joe 2026-06-11: the old full hero + "On this page"
          card burned ~a third of the viewport on static text; the morning
          read is the real hero of this page now). One line: title left,
          counts right. The color/range explanation lives in the legend line
          above the tiles. */}
      <section className="mt-pagesection" style={{ paddingBottom: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, flexWrap: 'wrap' }}>
            <div className="mt-eyebrow">Macro overview</div>
            <h1 className="mt-h1" style={{ fontSize: 30, margin: 0, lineHeight: 1.1 }}>
              Where every market sits <i>in its own range</i>.
            </h1>
          </div>
          <div className="num" style={{ fontSize: 12.5, color: 'var(--mt-ink-2)' }}>
            {indicators.length || '—'} indicators · {posCount || '—'} positioning signals
          </div>
        </div>
      </section>

      {!loading && (
        <section className="mt-pagesection">
          <MorningRead indicators={indicators} cotPos={cotPos} indexSeries={indexSeries} />
        </section>
      )}

      {/* Domain strip */}
      {!loading && (
        <section className="mt-pagesection">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
            {tiles === 'bars' ? (
              <div style={{ fontSize: 11.5, color: 'var(--mt-ink-3)' }}>
                Bar = above or below its own 3-year median · color = whether that stretch warns · length = how stretched
              </div>
            ) : <span />}
            <div className="mt-pillgroup">
              {[['bars', 'Bars'], ['pills', 'Pills']].map(([k, lbl]) => (
                <button key={k} type="button" className={`mt-pill ${tiles === k ? 'on' : ''}`} onClick={() => setTiles(k)}>{lbl}</button>
              ))}
            </div>
          </div>
          <div className="mc-domstrip" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
            {DOMAINS.map((dom) => {
              const inds = byDomain[dom] || [];
              const ext = inds.filter((i) => i.state === 'extreme').length;
              const elev = inds.filter((i) => i.state === 'elevated').length;
              const isActive = domain === dom;
              return (
                <div
                  key={dom}
                  role="button"
                  tabIndex={0}
                  className="mc-domcell"
                  onClick={() => setSelectedBucket(dom)}
                  style={{ cursor: 'pointer' }}
                >
                  <div className="mc-domhead">
                    <div className="mc-domname">{dom}</div>
                    <BucketRollupDot inds={inds} positioningElementId={(cotPos?.domains?.[dom]?.markets || []).length > 0 ? 'indicator-cftc-cot-weekly' : null} positioningAsOf={(cotPos?.domains?.[dom]?.markets || []).map((m) => m.asof).filter(Boolean).sort().slice(-1)[0]} onTip={showTip} onHideTip={hideTip} />
                  </div>
                  {tiles === 'bars' ? (
                    <DomainBars
                      inds={inds}
                      markets={cotPos?.domains?.[dom]?.markets || []}
                      shortLabel={shortLabel}
                      posDimmed={posDimmed}
                      posNextPrint="Sat 7:00a ET"
                      onSelectInd={setSelected}
                      onSelectPos={setSelectedPos}
                      onTip={showTip}
                      onHideTip={hideTip}
                    />
                  ) : (
                  <div style={{ marginTop: 12 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--mt-ink-1)', marginBottom: 8 }}>Indicators</div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6 }}>
                      {inds.map((i) => (
                        <button key={i.id} type="button"
                          className={`mt-tag mc-pill mt-tag--${i.state === 'extreme' ? 'extreme' : i.state === 'elevated' ? 'elev' : 'calm'}`}
                          onClick={(e) => { e.stopPropagation(); setSelected(i); }}
                          onMouseEnter={(e) => showTip(e, i.pct == null ? i.name : `${i.name} — ${ord(i.pct)} percentile of its 3-year range`)}
                          onMouseLeave={hideTip}
                          style={{ cursor: 'pointer', border: 'none', font: 'inherit', width: '100%', display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'space-between' }}>
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{shortLabel(i.name)}</span>
                          <span className="num" style={{ flex: '0 0 auto', opacity: 0.85 }}>{i.pct == null ? '\u2014' : Math.round(i.pct)}</span>
                        </button>
                      ))}
                    </div>
                    {(cotPos?.domains?.[dom]?.markets || []).length > 0 && (
                      <>
                        <div style={{ fontSize: 12.5, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--mt-ink-1)', margin: '16px 0 8px', paddingTop: 14, borderTop: '1px solid var(--mt-line-1)' }}>Positioning signals</div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6 }}>
                          {cotPos.domains[dom].markets.map((m) => (
                            <button key={m.market} type="button"
                              className={`mt-tag mc-pill mt-tag--${posState(m.spec) === 'extreme' ? 'extreme' : posState(m.spec) === 'elevated' ? 'elev' : 'calm'}`}
                              onClick={(e) => { e.stopPropagation(); setSelectedPos(m); }}
                              onMouseEnter={(e) => showTip(e, `${m.market} \u2014 speculators at the ${ord(m.spec)} percentile of 3 years`)}
                              onMouseLeave={hideTip}
                              style={{ cursor: 'pointer', border: '1px dashed currentColor', font: 'inherit', width: '100%', display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'space-between' }}>
                              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{shortLabel(m.market)}</span>
                              <span className="num" style={{ flex: '0 0 auto', opacity: 0.85 }}>{Math.round(m.spec)}</span>
                            </button>
                          ))}
                        </div>
                        {cotPos?.domains?.[dom]?.takeaway && (
                          <p style={{ marginTop: 12, fontSize: 12, lineHeight: 1.5, color: 'var(--mt-ink-2)' }}>{cotPos.domains[dom].takeaway}</p>
                        )}
                      </>
                    )}
                  </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}



      {loading && (
        <section className="mt-pagesection">
          <div className="mt-loadingcard">Loading…</div>
        </section>
      )}
      {selectedBucket && (
        <BucketModal
          dom={selectedBucket}
          title={DOMAIN_TITLE[selectedBucket] || ''}
          inds={byDomain[selectedBucket] || []}
          cotPos={cotPos}
          onClose={() => setSelectedBucket(null)}
          onSelectInd={setSelected}
          onSelectPos={setSelectedPos}
        />
      )}
      {selected && (
        <DetailModal onClose={() => setSelected(null)}>
          <IndicatorDetail ind={selected} onClose={() => setSelected(null)} catalog={overlayCatalog} indexSeries={indexSeries} />
        </DetailModal>
      )}
      {selectedPos && (
        <DetailModal onClose={() => setSelectedPos(null)}>
          <PositioningDetail item={selectedPos} onClose={() => setSelectedPos(null)} catalog={overlayCatalog} indexSeries={indexSeries} />
        </DetailModal>
      )}
    </div>
  );
}
