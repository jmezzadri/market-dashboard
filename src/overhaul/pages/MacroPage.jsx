/* Macro Landscape — terminal skin (2026-10-28 redesign, from Joe's approved
   "MacroTilt Redesign" canvas: Macro / MacroMobile boards). Dark, dense,
   data-first; no light theme on this page.

   Desktop: the ENG panel (regime, two 24-block meters, the regime-history
   strip), a six-cell summary strip, then three columns of indicator panels
   — Rates + Credit, Equities + FX, Commodities — and a full-width Economy
   panel. Every panel ends with its SPECULATOR POSITIONING · CFTC sub-table.
   Phone: the ENG panel with 20-block meters, then one collapsible panel per
   asset class, Rates open by default; the header carries the counts.

   VISUAL REBUILD ONLY. Every row is the one the 2026-10-22 summary tiles
   rendered: the same hooks, the same counts (stretched / elevated / big
   moves per domain and the hot spot), the same flag words, the same
   click-through into the indicator and positioning detail modals, the same
   engine history modal. Styling lives in styles/redesign.css.

   ── history ──
   Macro Overview — refactored 2026-05-27 per Joe Path-A directive.

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

import React, { useMemo, useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams } from 'react-router-dom';
import IndicatorDetail from '../components/IndicatorDetail';
import PositioningDetail from '../components/PositioningDetail';
import useIndicators, { MOVE_FLAG_PCTILE } from '../lib/useIndicators';
import useEngineRegime from '../lib/useEngineRegime';
import { stressMessage } from '../lib/engineGauges';
import '../styles/cream-system.css';
import '../styles/v13.css';
import '../styles/macro-v13.css';   /* the hover tooltip (.mac-tip) and the detail modals */
import '../styles/modal.css';
import { STRESS_THRESH, YIELD_THRESH } from '../lib/useEngineRegime';
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
/* Badge tooltips. Joe, 2026-09-03: "JUST WRITE 95% move over x lookback.
   THAT'S ALL, I DON'T NEED ALL THE SUPERFLUOUS WORDS." One line, the rule,
   nothing else. Do not add a sentence of explanation here again. Thresholds
   mirror MOVE_FLAG_PCTILE and stateFor() in useIndicators.js. */
const BIG_MOVE_TIP = 'Top 10% move \u00b7 3y lookback';
const STRETCHED_TIP = 'Top/bottom 10% level \u00b7 3y lookback \u00b7 the row says which end';
const ELEVATED_TIP = 'Top/bottom 25% level \u00b7 3y lookback \u00b7 the row says which end';

function posState(p){ return (p<=10||p>=90)?'extreme':(p<=25||p>=75)?'elevated':'calm'; }

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


/* The panels, in the order and columns of the approved board. Economy is
   the full-width panel under the three columns. */
const PANEL = {
  Rates: { code: 'RTS', title: 'RATES' },
  Credit: { code: 'CRD', title: 'CREDIT' },
  Equities: { code: 'EQ', title: 'EQUITIES' },
  Commodities: { code: 'CMD', title: 'COMMODITIES' },
  FX: { code: 'FX', title: 'FX' },
  'Financial Conditions & Economy': { code: 'ECON', title: 'FINANCIAL CONDITIONS & ECONOMY' },
};
const COLUMNS = [['Rates', 'Credit'], ['Equities', 'FX'], ['Commodities']];
const SUMMARY_NAME = { 'Financial Conditions & Economy': 'ECONOMY' };
const slug = (dom) => 'tm-' + dom.toLowerCase().replace(/[^a-z]+/g, '-').replace(/-+$/, '');

/* A block meter: n blocks over [min, max]; blocks up to the live value are
   lit in their zone's colour, the rest dim. The zone edges are the engine's
   own thresholds; the range is the board's. */
function blocks(n, min, max, value, zoneOf) {
  return Array.from({ length: n }, (_, i) => {
    const mid = min + ((max - min) * (i + 0.5)) / n;
    const z = zoneOf(mid);
    const lit = value != null && Number.isFinite(value) && mid <= value;
    return { k: i, cls: `tm-blk tm-blk--${z}${lit ? ' is-lit' : ''}`, delay: `${(i * 50)}ms` };
  });
}
const MOVE_RANGE = [80, 140];
const YIELD_RANGE = [-50, 50];

export default function MacroPage() {
  const { active: indicators, loading, indexSeries } = useIndicators();
  const regime = useEngineRegime();
  const [engHist, setEngHist] = useState(null);
  useEffect(() => { let c=false; fetch('/macrotilt_engine_history.json',{cache:'no-cache'}).then(r=>r.ok?r.json():null).then(d=>{ if(!c) setEngHist(d?.weekly||null); }).catch(()=>{}); return ()=>{c=true;}; }, []);
  const [selected, setSelected] = useState(null);
  const [cotPos, setCotPos] = useState(null);
  const [selectedPos, setSelectedPos] = useState(null);
  const [engOpen, setEngOpen] = useState(false);
  // Phone accordion: one panel open at a time, Rates by default. On a wide
  // screen every panel is open (CSS) and this state is inert.
  const [openDom, setOpenDom] = useState('Rates');
  const [phone, setPhone] = useState(() => (typeof window !== 'undefined' ? window.innerWidth <= 860 : false));
  useEffect(() => {
    const on = () => setPhone(window.innerWidth <= 860);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  const [tip, setTip] = useState(null);
  const showTip = (e, text) => { const r = e.currentTarget.getBoundingClientRect(); setTip({ text, x: r.left + r.width / 2, y: r.top }); };
  const hideTip = () => setTip(null);
  useEffect(() => { setTip(null); }, [openDom]);

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
  // overlaid on any chart in the detail modal.
  const overlayCatalog = useMemo(() => {
    const out = [];
    (indexSeries || []).forEach((x) => { if (x.points?.length) out.push({ key: 'idx:' + x.key, label: x.label + ' (index)', points: x.points }); });
    (indicators || []).forEach((i) => { if (i.points?.length) out.push({ key: 'ind:' + i.id, label: i.name, points: i.points }); });
    if (cotPos?.domains) Object.values(cotPos.domains).forEach((d) => (d.markets || []).forEach((m) => {
      if (m.history?.length) out.push({ key: 'pos:' + m.market, label: m.market + ' (positioning)', points: m.history.map((r) => [r[0], r[1]]) });
    }));
    return out;
  }, [indicators, cotPos, indexSeries]);

  /* One-session change, signed, at the indicator's own precision. */
  const chgOf = (ind) => {
    const p = ind.points; if (!p || p.length < 2) return null;
    const last = p[p.length - 1][1], prev = p[p.length - 2][1];
    if (!Number.isFinite(last) || !Number.isFinite(prev)) return null;
    const dec = Math.min(ind.decimals ?? 2, 2);
    const r = Number((last - prev).toFixed(dec));
    if (r === 0) return { txt: '0', cls: 'fl' };
    const a = Math.abs(r).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
    return r > 0 ? { txt: `+${a}`, cls: 'up' } : { txt: `−${a}`, cls: 'down' };
  };
  const fmtV = (v, dec, unit) => { if (v==null||!Number.isFinite(v)) return '—'; const n=v.toLocaleString('en-US',{minimumFractionDigits:dec??2,maximumFractionDigits:dec??2}); return unit==='%'?n+'%':(!unit||['index','ratio','z-score'].includes(unit))?n:n+' '+unit; };
  const ext = (p) => p != null && (p >= 90 || p <= 10);
  const indTip = (ind) => { const v=fmtV(ind.value, ind.decimals, ind.unit); const L=[ind.name+' — '+v]; if(ind.pct!=null) L.push(ord(ind.pct)+' pct · '+(ind.pctWindow || '3-year')+' range'+(ind.tailWord?' · '+ind.tailWord:'')); const d=(ind.narrative||ind.description||'').trim(); if(d) L.push(d.length>120?d.slice(0,117)+'…':d); L.push('Click for chart.'); return L.join('\n'); };
  const posTip = (m) => { const L=[m.market+' · positioning']; if(Number.isFinite(m.spec)) L.push('Specs '+ord(m.spec)+' pct · 3y range'+(m.spec>=90?' · crowded':m.spec<=10?' · washed out':'')); L.push('Click for chart.'); return L.join('\n'); };

  const sZone = regime.stressZone, yReg = regime.yieldRegime;
  const sMsg = stressMessage(sZone, regime.move);
  const yDelta = regime.yieldDeltaBp;
  const yMsg = (() => {
    if (yReg === 'Inflationary') return 'Inflationary — the Fed is back in play.';
    if (yReg === 'Deflationary') return 'Deflationary — a growth scare.';
    if (yReg === 'Neutral' && yDelta != null && Number.isFinite(yDelta)) {
      const toInfl = Math.round(YIELD_THRESH.inflBp - yDelta), toDefl = Math.round(yDelta - YIELD_THRESH.deflBp);
      return toInfl <= toDefl ? `Neutral — ${Math.max(1, toInfl)}bp short of the inflationary line.` : `Neutral — ${Math.max(1, toDefl)}bp above the deflationary line.`;
    }
    return yReg ? `${yReg}.` : '—';
  })();
  const moveBlocks = blocks(phone ? 20 : 24, MOVE_RANGE[0], MOVE_RANGE[1], regime.move, (m) => (m < STRESS_THRESH.watch ? 'green' : m < STRESS_THRESH.riskOff ? 'amber' : 'red'));
  const yieldBlocks = blocks(phone ? 20 : 24, YIELD_RANGE[0], YIELD_RANGE[1], yDelta, (y) => (y <= YIELD_THRESH.deflBp ? 'blue' : y >= YIELD_THRESH.inflBp ? 'amber' : 'grey'));
  const openMove = () => { const it=indicators.find((i)=>i.id==='move'); if(it) setSelected(it); };
  const openYield = () => { const it=indicators.find((i)=>i.id==='ust_10y')||indicators.find((i)=>i.id==='real_rates'); if(it) setSelected(it); };

  /* Per-domain roll-up — the same arithmetic as the 2026-10-22 summary tiles:
     elements = indicators AND positioning rows; heat = share stretched plus
     half the share elevated; the hottest domain with any stretched element
     is the hot spot. */
  const summ = useMemo(() => {
    const out = {};
    DOMAINS.forEach((dom) => {
      const inds = byDomain[dom] || [];
      const markets = cotPos?.domains?.[dom]?.markets || [];
      const posStates = markets.map((m) => posState(m.spec));
      const total = inds.length + markets.length;
      const extN = inds.filter((i) => i.state==='extreme').length + posStates.filter((x) => x==='extreme').length;
      const elev = inds.filter((i) => i.state==='elevated').length + posStates.filter((x) => x==='elevated').length;
      const big = inds.filter((i) => i.movePct != null && i.movePct >= MOVE_FLAG_PCTILE).length;
      const heat = total ? (extN + 0.5 * elev) / total : 0;
      out[dom] = { inds, markets, total, ext: extN, elev, big, heat };
    });
    return out;
  }, [byDomain, cotPos]);
  const hot = DOMAINS.reduce((a, d) => (summ[d].heat > (summ[a]?.heat ?? -1) ? d : a), null);
  const isHot = (dom) => dom === hot && summ[dom].ext > 0;

  /* The regime history strip — full history, monthly cells, each the most
     defensive state seen in that month (unchanged from the summary-tile page). */
  const months = useMemo(() => {
    if (!engHist || !engHist.length) return [];
    const RANK = { 'Risk Off': 3, Watch: 2, 'Risk On': 1 };
    const YRANK = { Inflationary: 3, Deflationary: 2, Neutral: 1 };
    const out = []; const seen = new Map();
    engHist.forEach((w) => {
      const m = (w.date || '').slice(0, 7);
      if (!m) return;
      let cell = seen.get(m);
      if (!cell) { cell = { m, stress: 'Risk On', yreg: 'Neutral' }; seen.set(m, cell); out.push(cell); }
      if ((RANK[w.stress_state] || 0) > (RANK[cell.stress] || 0)) cell.stress = w.stress_state;
      if ((YRANK[w.yield_regime] || 0) > (YRANK[cell.yreg] || 0)) cell.yreg = w.yield_regime;
    });
    return out;
  }, [engHist]);
  const sCls = (x) => (x==='Risk On'?'green':x==='Watch'?'amber':x==='Risk Off'?'red':'grey');
  const yCls = (x) => (x==='Deflationary'?'blue':x==='Inflationary'?'amber':'grey');

  const indRow = (ind) => {
    const ch = chgOf(ind);
    const pct = ind.pct != null ? Math.round(ind.pct) : null;
    return (
      <a key={ind.id} className="tm-row rd-num" onClick={() => setSelected(ind)} onMouseEnter={(e)=>showTip(e, indTip(ind))} onMouseLeave={hideTip}>
        <span className="tm-c-name">{ind.name}{ind.tailWord && <span className="tm-flag tm-flag--phone">{ind.tailWord}</span>}</span>
        <span className="tm-c-last">{fmtV(ind.value, ind.decimals, ind.unit)}</span>
        <span className={`tm-c-chg ${ch ? ch.cls : 'fl'}${ind.movePct!=null&&ind.movePct>=MOVE_FLAG_PCTILE?' is-big':''}`}>{ch ? ch.txt : '—'}</span>
        <span className={`tm-c-pct${ext(pct) ? ' is-ext' : ''}`}><span className="tm-pctbar" aria-hidden="true"><span className="tm-pctfill" style={{ '--w': `${Math.max(pct ?? 0, 2)}%` }} /></span><span className="tm-pctnum">{pct != null ? pct : '—'}</span></span>
        <span className="tm-c-flag">{ind.tailWord || ''}</span>
      </a>
    );
  };
  const posRow = (m, dom) => {
    const ps = posState(m.spec);
    let ch = null; const h = m.history;
    if (Array.isArray(h) && h.length >= 2) { const c = h[h.length-1][1], p = h[h.length-2][1]; if (Number.isFinite(c) && Number.isFinite(p)) { const r = Number((c-p).toFixed(1)); ch = r === 0 ? { txt: '0', cls: 'fl' } : r > 0 ? { txt: `+${Math.abs(r).toFixed(1)}`, cls: 'up' } : { txt: `−${Math.abs(r).toFixed(1)}`, cls: 'down' }; } }
    const pct = Number.isFinite(m.spec) ? Math.round(m.spec) : null;
    const side = ps !== 'calm' && pct != null ? (pct <= 50 ? 'SHORT' : 'LONG') : '';
    const flag = pct != null && pct >= 90 ? 'AT HIGH' : pct != null && pct <= 10 ? 'AT LOW' : '';
    return (
      <a key={'pos-'+m.market} className="tm-row rd-num" onClick={() => setSelectedPos({ ...m, domain: dom })} onMouseEnter={(e)=>showTip(e, posTip(m))} onMouseLeave={hideTip}>
        <span className="tm-c-name">{m.market}{flag && <span className="tm-flag tm-flag--phone">{flag}</span>}</span>
        <span className="tm-c-last tm-c-side">{side || '—'}</span>
        <span className={`tm-c-chg ${ch ? ch.cls : 'fl'}`}>{ch ? ch.txt : '—'}</span>
        <span className={`tm-c-pct${ext(pct) ? ' is-ext' : ''}`}><span className="tm-pctbar" aria-hidden="true"><span className="tm-pctfill" style={{ '--w': `${Math.max(pct ?? 0, 2)}%` }} /></span><span className="tm-pctnum">{pct != null ? pct : '—'}</span></span>
        <span className="tm-c-flag">{flag}</span>
      </a>
    );
  };

  const panel = (dom, extraCls = '') => {
    const d = summ[dom]; const meta = PANEL[dom];
    const isOpen = !phone || openDom === dom;
    const counts = (
      <span className="tm-counts rd-num"><span className="is-amber">{d.ext} stretched</span> · {d.elev} elevated · <span className="is-blue">{d.big} big {d.big === 1 ? 'move' : 'moves'}</span></span>
    );
    return (
      <section key={dom} id={slug(dom)} className={`tm-panel rd-rise d4 ${extraCls}${isOpen ? ' is-open' : ''}`} aria-label={meta.title}>
        {phone ? (
          <button type="button" className="tm-phead tm-phead--btn" aria-expanded={isOpen} onClick={() => setOpenDom(isOpen ? null : dom)}>
            <span className="tm-code">{meta.code}</span>
            <span className="tm-phead-main"><span className="tm-ptitle">{meta.title}</span>{counts}</span>
            {isHot(dom) && <span className="tm-hot">HOT SPOT</span>}
            <span className="tm-chev" aria-hidden="true">{isOpen ? '▾' : '▸'}</span>
          </button>
        ) : (
          <div className="tm-phead">
            <span className="tm-code">{meta.code}</span>
            <span className="tm-ptitle">{meta.title}</span>
            <span className="tm-pfill" />
            <span className="tm-pdesc">{DOMAIN_TITLE[dom].replace(/\.$/, '')}</span>
          </div>
        )}
        {isOpen && (
          <div className="tm-pbody">
            <div className="tm-cols rd-num"><span>INDICATOR</span><span className="r">LAST</span><span className="r">CHG</span><span className="tm-cols-pct">PCTL</span><span className="tm-cols-flag">FLAG</span></div>
            {d.inds.map(indRow)}
            {d.inds.length === 0 && <div className="tm-empty">No live indicators.</div>}
            {d.markets.length > 0 && (
              <>
                <div className="tm-ghead">SPECULATOR POSITIONING · CFTC</div>
                {d.markets.map((m) => posRow(m, dom))}
              </>
            )}
          </div>
        )}
      </section>
    );
  };

  const verdictParts = (regime.regimeLabel || '—').split('·').map((x) => x.trim());

  return (
    <div className="mt-terminal tm-macro">
      {tip && createPortal(
        <div className="mac-tip" style={{ left: tip.x, top: tip.y - 8 }}>{tip.text}</div>,
        document.querySelector('.mt-overhaul') || document.body,
      )}

      {loading && <div className="tm-loading">LOADING…</div>}

      {!loading && (
        <main className="tm-main">
          {/* ── ENG ───────────────────────────────────────────────────── */}
          <section className="tm-panel tm-eng rd-rise d2" aria-label="The Engine">
            <div className="tm-phead">
              <span className="tm-code">ENG</span>
              <span className="tm-ptitle">THE ENGINE · TODAY'S REGIME</span>
              <span className="tm-pfill" />
              {months.length > 0 && <button type="button" className="tm-plink" onClick={() => setEngOpen(true)}>SEE IT AGAINST THE MARKET ▸</button>}
            </div>
            <div className="tm-eng-grid">
              <div className="tm-eng-cell tm-eng-verdict">
                <div className="tm-regime"><span className={`tm-regime-s is-${sCls(sZone)}`}>{(verdictParts[0] || '—').toUpperCase()}</span> <span className="tm-regime-dot">·</span> <span className="tm-regime-y">{(verdictParts[1] || '—').toUpperCase()}</span></div>
                <p className="tm-eng-so">Two dials. One sets how much you hold in stocks. The other sets what the rest is held in.</p>
                <div className="tm-rules rd-num">
                  <span className="tm-rule-k">STOCK WEIGHT</span><span>MOVE under {STRESS_THRESH.watch}: fully invested · {STRESS_THRESH.watch}–{STRESS_THRESH.riskOff}: 80% · over {STRESS_THRESH.riskOff}: 50%</span>
                  <span className="tm-rule-k">HEDGE</span><span>10Y falling: long Treasuries · 10Y rising: mostly cash and gold</span>
                </div>
              </div>
              <button type="button" className="tm-eng-cell tm-meter" onClick={openMove}>
                <div className="tm-meter-head rd-num"><span className="tm-meter-k">STRESS SIGNAL · MOVE</span><b>{fmtV(regime.move, 0)}</b></div>
                <div className="tm-blocks" aria-hidden="true">{moveBlocks.map((b) => <span key={b.k} className={b.cls} style={{ animationDelay: b.delay }} />)}</div>
                <div className="tm-meter-scale rd-num"><span>RISK ON ≤{STRESS_THRESH.watch}</span><span>WATCH</span><span>RISK OFF ≥{STRESS_THRESH.riskOff}</span></div>
                <div className="tm-meter-read">{sMsg}</div>
              </button>
              <button type="button" className="tm-eng-cell tm-meter" onClick={openYield}>
                <div className="tm-meter-head rd-num"><span className="tm-meter-k">10Y · 3-MONTH CHANGE</span><b>{yDelta == null ? '—' : `${yDelta >= 0 ? '+' : '−'}${Math.abs(Math.round(yDelta))}bp`}</b></div>
                <div className="tm-blocks" aria-hidden="true">{yieldBlocks.map((b) => <span key={b.k} className={b.cls} style={{ animationDelay: b.delay }} />)}</div>
                <div className="tm-meter-scale rd-num"><span>DEFLATIONARY ≤{YIELD_THRESH.deflBp}</span><span>NEUTRAL</span><span>INFLATIONARY ≥+{YIELD_THRESH.inflBp}</span></div>
                <div className="tm-meter-read">{yMsg}</div>
              </button>
            </div>
            {months.length > 0 && (
              <div className="tm-hist" role="button" tabIndex={0}
                   onClick={() => setEngOpen(true)}
                   onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setEngOpen(true); } }}>
                <div className="tm-hist-lbl rd-num">REGIME HISTORY · MONTHLY SINCE {months[0].m.slice(0, 4)} · TOP: STRESS SIGNAL · BOTTOM: YIELD REGIME</div>
                <div className="tm-hist-row">{months.map((w) => <span key={w.m} className={`is-${sCls(w.stress)}`} onMouseEnter={(e)=>showTip(e, w.m+' · Stress: '+w.stress)} onMouseLeave={hideTip} />)}</div>
                <div className="tm-hist-row">{months.map((w) => <span key={w.m} className={`is-${yCls(w.yreg)}`} onMouseEnter={(e)=>showTip(e, w.m+' · Yield: '+w.yreg)} onMouseLeave={hideTip} />)}</div>
                <div className="tm-hist-axis rd-num"><span>{months[0].m}</span><span>NOW</span></div>
              </div>
            )}
          </section>

          {/* ── summary strip (desktop) ──────────────────────────────── */}
          <section className="tm-summary rd-rise d3" aria-label="Summary by asset class">
            {DOMAINS.map((dom) => {
              const d = summ[dom];
              return (
                <a key={dom} href={`#${slug(dom)}`} className="tm-sum" onClick={(e) => { e.preventDefault(); document.getElementById(slug(dom))?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}>
                  <div className="tm-sum-head"><span className="tm-sum-name">{SUMMARY_NAME[dom] || dom.toUpperCase()}</span>{isHot(dom) && <span className="tm-hot">HOT SPOT</span>}</div>
                  <div className="tm-sum-stats rd-num">
                    <span className="tm-stat"><b className="is-amber" onMouseEnter={(e)=>showTip(e, STRETCHED_TIP)} onMouseLeave={hideTip}>{d.ext}<u>/{d.total}</u></b><i>STRETCHED</i></span>
                    <span className="tm-stat"><b onMouseEnter={(e)=>showTip(e, ELEVATED_TIP)} onMouseLeave={hideTip}>{d.elev}<u>/{d.total}</u></b><i>ELEVATED</i></span>
                    <span className="tm-stat"><b className="is-blue" onMouseEnter={(e)=>showTip(e, BIG_MOVE_TIP)} onMouseLeave={hideTip}>{d.big}<u>/{d.inds.length}</u></b><i>BIG MOVES</i></span>
                  </div>
                </a>
              );
            })}
          </section>

          {/* ── indicator panels ─────────────────────────────────────── */}
          {phone ? (
            <div className="tm-stack">{DOMAINS.map((dom) => panel(dom))}</div>
          ) : (
            <>
              <div className="tm-grid3">
                {COLUMNS.map((col, ci) => (
                  <div key={ci} className="tm-col">{col.map((dom) => panel(dom))}</div>
                ))}
              </div>
              {panel('Financial Conditions & Economy', 'tm-panel--econ')}
            </>
          )}

          <p className="tm-footnote">
            PCTL = where today's reading sits in its 3-year range (0 lowest, 100 highest); amber marks the top and bottom 10%.
            Positioning PCTL = where speculators' net position sits against its own history.
            {phone ? ' Speculator positioning sits inside each panel.' : ''}
          </p>
        </main>
      )}

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
