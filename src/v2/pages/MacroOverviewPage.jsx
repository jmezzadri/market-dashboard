// MacroOverviewPage.jsx — Macro Overview reframed as pure indicator backdrop.
//
// Council sign-offs on the design (chat, 2026-05-17):
//   UX Designer — approved layout (5 stacked domain panels, hero + meta tile).
//   Senior Quant — approved 26-indicator bucketing across the five panels.
//   Data Steward — every indicator id below is registered in /data_manifest.json
//                  and pulls through /indicator_history.json; FreshnessChip wired.
//   Lead Developer — owns the build.
//
// Structure
//   PageHero (title + bullets + small right-side meta tile)
//   Five domain panels stacked top to bottom:
//     Rates · Credit · Equities · Money & Banking · Economy
//   Each panel: one-line plain-English subtitle + indicator rows.
//   Each row: name · current value · 30d direction arrow · 5y percentile dot · freshness chip.
//   Click any row → modal with KPI strip + HistoryChart (timeframe pills, crosshair) + methodology.
//
// What dies on this page (now lives on Asset Tilt):
//   - Regime classifier (Risk On / Watch / Risk Off + Inflationary / Neutral / Deflationary)
//   - Three vol-trigger tiles (VIX / MOVE / CPFF)
//   - 7-indicator cycle composite
//   - 24-week regime bar strip
//
// HistoryChart is inlined here so the new page can ship without touching
// AssetAllocation.jsx. Behavior is identical line-for-line to the Asset Tilt
// version — a follow-up PR will extract it to a single shared component.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import PageHero from '../components/PageHero';
import FreshnessChip from '../components/FreshnessChip';
import Drawer from '../components/Drawer';

// ─── HistoryChart — IDENTICAL to AssetAllocation.jsx. Do NOT change here
//     without updating Asset Tilt in lockstep. Joe rule: every chart is the
//     same chart.
function HistoryChart({ series, data, fmtY = (v) => v.toFixed(2), logY = false, defaultTf = "Max", height = 320, availableOverlays = [], horizontalLines = [], defaultOverlay = null, yMin: yMinProp = null, rebase = false, overlapNote = null }) {
  const [tf, setTf] = useState(defaultTf);
  const [hoverIdx, setHoverIdx] = useState(null);
  const [overlayKey, setOverlayKey] = useState(defaultOverlay);
  const svgRef = useRef(null);
  const overlay = overlayKey ? availableOverlays.find(o => o.key === overlayKey) : null;
  const allSeries = overlay ? [...series, { ...overlay, dashed: true }] : series;

  const cadence = (() => {
    if (data.length < 10) return "weekly";
    let gapSum = 0, n = 0;
    for (let i = 1; i < Math.min(20, data.length); i++) {
      const a = new Date(data[i - 1].date), b = new Date(data[i].date);
      gapSum += (b - a) / (1000 * 60 * 60 * 24);
      n++;
    }
    return (gapSum / n) < 4 ? "daily" : "weekly";
  })();
  const tfPoints = cadence === "daily"
    ? { "1M": 21, "6M": 126, "1Y": 252, "5Y": 1260, "Max": data.length }
    : { "1M": 4,  "6M": 26,  "1Y": 52,  "5Y": 260,  "Max": data.length };
  let w = data.slice(-tfPoints[tf]);

  if (rebase && w.length > 0) {
    const baseVals = {};
    for (const s of allSeries) {
      for (const p of w) { if (p[s.key] != null && p[s.key] !== 0) { baseVals[s.key] = p[s.key]; break; } }
    }
    w = w.map(p => {
      const o = { ...p };
      for (const s of allSeries) {
        const base = baseVals[s.key];
        if (base != null && p[s.key] != null) o[s.key] = p[s.key] / base;
      }
      return o;
    });
  }

  const W = 800, H = height, padL = 56, padR = 24, padT = 18, padB = 36;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  const allVals = [...w.flatMap(p => allSeries.map(s => p[s.key]).filter(v => v != null && (!logY || v > 0))), ...horizontalLines.map(h => h.value).filter(v => v != null)];
  let yMinRaw = Math.min(...allVals);
  let yMaxRaw = Math.max(...allVals);
  let yMin, yMax;
  if (logY) {
    yMin = yMinRaw / 1.04;
    yMax = yMaxRaw * 1.04;
    yMin = Math.max(yMin, 0.01);
  } else {
    const yPad = (yMaxRaw - yMinRaw) * 0.08 || Math.abs(yMaxRaw) * 0.05 || 1;
    yMin = yMinRaw - yPad;
    yMax = yMaxRaw + yPad;
  }
  if (yMinProp != null) { yMin = yMinProp; }

  const yScale = logY ? Math.log(yMax / yMin) : (yMax - yMin);
  const yToPx = (v) => {
    if (logY) return padT + (Math.log(yMax / v) / yScale) * innerH;
    return padT + ((yMax - v) / yScale) * innerH;
  };
  const xToPx = (i) => padL + (i / Math.max(1, w.length - 1)) * innerW;
  const pathFor = (key) => w.map((p, i) => {
    const v = p[key];
    if (v == null) return null;
    return [xToPx(i), yToPx(v)];
  }).filter(Boolean).map((pt, i) => (i === 0 ? "M " : "L ") + pt[0].toFixed(1) + " " + pt[1].toFixed(1)).join(" ");

  const yTicks = [];
  if (logY) {
    const lo = Math.log(yMin), hi = Math.log(yMax);
    for (let i = 0; i <= 4; i++) {
      const lv = lo + (hi - lo) * (i / 4);
      const v = Math.exp(lv);
      yTicks.push({ v, y: yToPx(v) });
    }
  } else {
    for (let i = 0; i <= 4; i++) {
      const v = yMin + (yMax - yMin) * (i / 4);
      yTicks.push({ v, y: yToPx(v) });
    }
  }
  const xLabels = [
    { i: 0, d: w[0]?.date },
    { i: Math.floor(w.length / 2), d: w[Math.floor(w.length / 2)]?.date },
    { i: w.length - 1, d: w[w.length - 1]?.date },
  ].filter(p => p.d).map(p => ({ x: xToPx(p.i), label: (() => { const d = new Date(p.d); return d.toLocaleDateString("en-US", { month: "short", year: tf === "Max" || tf === "5Y" ? "numeric" : "2-digit" }); })() }));

  const handleMove = (e) => {
    if (!svgRef.current || w.length === 0) return;
    const rect = svgRef.current.getBoundingClientRect();
    const xRel = (e.clientX - rect.left) / rect.width * W;
    const xData = (xRel - padL) / innerW;
    const idx = Math.round(xData * (w.length - 1));
    if (idx >= 0 && idx < w.length) setHoverIdx(idx);
  };
  const handleLeave = () => setHoverIdx(null);

  const hover = hoverIdx != null ? w[hoverIdx] : null;
  const hoverX = hoverIdx != null ? xToPx(hoverIdx) : null;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, gap: 12, flexWrap: "wrap" }}>
        <div style={{ fontSize: 10, letterSpacing: "0.095em", color: "var(--text-muted)", textTransform: "uppercase", fontWeight: 600 }}>History · timeframe select · crosshair{availableOverlays.length > 0 ? " · overlay" : ""}</div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {availableOverlays.length > 0 && (
            <select value={overlayKey || ""} onChange={(e) => setOverlayKey(e.target.value || null)} style={{
              fontSize: 11, padding: "4px 10px", borderRadius: 11, border: "1px solid var(--border)",
              background: "var(--surface)", color: "var(--text)", cursor: "pointer", marginRight: 8, letterSpacing: "0.04em",
            }}>
              <option value="">OVERLAY…</option>
              {availableOverlays.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
            </select>
          )}
          {["1M", "6M", "1Y", "5Y", "Max"].map(t => (
            <button key={t} onClick={() => setTf(t)} style={{
              background: t === tf ? "var(--accent-soft)" : "transparent",
              border: "1px solid " + (t === tf ? "var(--accent)" : "var(--border)"),
              color: t === tf ? "var(--accent)" : "var(--text-muted)",
              borderRadius: 11, padding: "4px 12px", fontSize: 11, letterSpacing: "0.04em", cursor: "pointer", fontWeight: 500,
            }}>{t}</button>
          ))}
        </div>
      </div>
      <div style={{ minHeight: 56, padding: "8px 12px", background: hover ? "var(--surface-2)" : "transparent", border: "0.5px solid " + (hover ? "var(--border-faint)" : "transparent"), borderRadius: 8, marginBottom: 8, fontSize: 12, color: "var(--text)", transition: "background 80ms" }}>
        {hover ? (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
              <div style={{ fontSize: 10.5, color: "var(--text-muted)", letterSpacing: "0.04em", textTransform: "uppercase", fontWeight: 600 }}>{(() => { const d = new Date(hover.date); return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" }); })()}</div>
              <div style={{ fontSize: 10.5, color: "var(--text-dim)", letterSpacing: "0.04em" }}>HOVER · POINT {hoverIdx + 1} OF {w.length}</div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(" + allSeries.length + ", 1fr)", gap: 12 }}>
              {allSeries.map(s => (
                <div key={s.key} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--text-muted)" }}>
                    <span style={{ display: "inline-block", width: 10, height: 2, background: s.color, borderRadius: 1 }} />{s.label}
                  </span>
                  <span style={{ fontFamily: "var(--font-mono)", fontWeight: 600, fontSize: 14, color: "var(--text)" }}>{hover[s.key] != null ? fmtY(hover[s.key]) : "—"}</span>
                </div>
              ))}
            </div>
          </>
        ) : (
          <div style={{ fontSize: 11.5, color: "var(--text-dim)", fontStyle: "italic" }}>Hover the chart for the crosshair readout · all {allSeries.length} series at the cursor's date</div>
        )}
      </div>
      <div style={{ position: "relative" }}>
        <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: "100%", height, display: "block", cursor: "crosshair" }} onMouseMove={handleMove} onMouseLeave={handleLeave}>
          {yTicks.map((t, i) => (
            <g key={i}>
              <line x1={padL} y1={t.y} x2={W - padR} y2={t.y} stroke="rgba(14,17,21,0.06)" strokeWidth="1" />
              <text x={padL - 8} y={t.y + 4} fontSize="10" fill="var(--text-dim)" textAnchor="end" fontFamily="Inter">{fmtY(t.v)}</text>
            </g>
          ))}
          {xLabels.map((l, i) => (
            <text key={i} x={l.x} y={H - padB + 18} fontSize="10.5" fill="var(--text-dim)" textAnchor="middle" fontFamily="Inter">{l.label}</text>
          ))}
          {horizontalLines.map((h, i) => (
            <g key={"h" + i}>
              <line x1={padL} y1={yToPx(h.value)} x2={W - padR} y2={yToPx(h.value)} stroke={h.color || "var(--text-muted)"} strokeWidth="1.2" strokeDasharray="6 4" />
              <text x={W - padR - 6} y={yToPx(h.value) - 6} fontSize="10" fill={h.color || "var(--text-muted)"} textAnchor="end" fontFamily="Inter" fontWeight="500">{h.label || ""}</text>
            </g>
          ))}
          {allSeries.map((s, i) => {
            const sw = s.dashed ? 1.4 : (3.0 - i * 0.4);
            return (
              <path key={s.key} d={pathFor(s.key)} fill="none" stroke={s.color}
                    strokeWidth={Math.max(1.2, sw)} strokeDasharray={s.dashed ? "4 4" : undefined}
                    opacity={s.dashed ? 0.8 : (i === 0 ? 1 : 0.9)} />
            );
          })}
          {hoverIdx != null && hoverX != null && (
            <g>
              <line x1={hoverX} y1={padT} x2={hoverX} y2={H - padB} stroke="rgba(14,17,21,0.20)" strokeWidth="1" strokeDasharray="2 3" />
              {allSeries.map(s => {
                const v = w[hoverIdx][s.key];
                if (v == null) return null;
                return <circle key={s.key} cx={hoverX} cy={yToPx(v)} r="4" fill={s.color} stroke="#fff" strokeWidth="1.5" />;
              })}
            </g>
          )}
        </svg>
      </div>
      <div style={{ display: "flex", gap: 18, marginTop: 10, fontSize: 11.5, color: "var(--text-muted)", flexWrap: "wrap" }}>
        {[...allSeries, ...horizontalLines.map((h, i) => ({ key: "hline" + i, label: h.label, color: h.color || "var(--text-muted)", dashed: true }))].map(s => (
          <span key={s.key} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ display: "inline-block", width: 14, height: s.dashed ? 0 : 2, borderTop: s.dashed ? "2px dashed " + s.color : "2px solid " + s.color }} />
            {s.label}
          </span>
        ))}
        <span style={{ marginLeft: "auto" }}>{tf} window · {w.length} points</span>
      </div>
      {(() => {
        if (!overlapNote || !rebase || w.length < 2 || allSeries.length < 2) return null;
        const last = w[w.length - 1];
        const finals = allSeries.map(s => last[s.key]).filter(v => v != null);
        if (finals.length < 2) return null;
        const spread = Math.max(...finals) - Math.min(...finals);
        if (spread > 0.005) return null;
        return (
          <div style={{ marginTop: 10, padding: "8px 12px", background: "rgba(0,113,227,0.06)", border: "0.5px solid rgba(0,113,227,0.18)", borderRadius: 8, fontSize: 11.5, color: "var(--text-2)", lineHeight: 1.5 }}>
            <span style={{ color: "var(--accent)", fontWeight: 600, marginRight: 4 }}>Note:</span>{overlapNote}
          </div>
        );
      })()}
    </div>
  );
}

// ─── Indicator catalog ──────────────────────────────────────────────────
// dir: 'hw' (high-warns — rising = stress), 'lw' (low-warns — falling = stress),
//      'neutral' (direction is informational, not good/bad).
const INDICATORS = {
  // RATES
  yield_curve:   { panel: 'rates', label: 'Yield curve (10y − 2y)',        short: '10y−2y',     fmt: v => (v>=0?'+':'') + Math.round(v) + ' bp',           dir: 'lw',       methodology: 'A positive slope is normal; inversion has historically led recessions by 10–22 months.' },
  real_rates:    { panel: 'rates', label: '10y real yield',                short: '10y real',   fmt: v => (v>=0?'+':'') + v.toFixed(2) + '%',              dir: 'hw',       methodology: 'Nominal 10y Treasury minus 10y breakeven inflation. Higher real rates tighten financial conditions.' },
  move:          { panel: 'rates', label: 'MOVE · bond volatility',        short: 'MOVE',       fmt: v => v.toFixed(0),                                    dir: 'hw',       methodology: 'Implied volatility on Treasury options across the curve. Captures rate-policy uncertainty.' },
  term_premium:  { panel: 'rates', label: 'Term premium',                  short: 'Term prem',  fmt: v => (v>=0?'+':'') + v.toFixed(2) + '%',              dir: 'neutral',  methodology: 'Extra yield investors demand for holding long-dated paper over rolling short paper.' },
  breakeven_10y: { panel: 'rates', label: '10y breakeven inflation',       short: '10y BE',     fmt: v => v.toFixed(2) + '%',                              dir: 'neutral',  methodology: 'Market-implied 10y inflation: nominal 10y yield minus 10y TIPS yield.' },

  // CREDIT
  hy_ig:         { panel: 'credit', label: 'High-yield OAS',               short: 'HY OAS',     fmt: v => Math.round(v) + ' bp',                           dir: 'hw',       methodology: 'ICE BofA US High Yield Index option-adjusted spread. Daily close.' },
  ig_oas:        { panel: 'credit', label: 'Investment-grade OAS',         short: 'IG OAS',     fmt: v => Math.round(v) + ' bp',                           dir: 'hw',       methodology: 'ICE BofA US Corporate Index option-adjusted spread. Daily close.' },
  hy_ig_ratio:   { panel: 'credit', label: 'HY / IG spread ratio',         short: 'HY/IG',      fmt: v => v.toFixed(2),                                    dir: 'hw',       methodology: 'Pure premium for credit risk, normalized by duration. Rising = lenders pricing more risk.' },
  sloos_ci:      { panel: 'credit', label: 'SLOOS · C&I tightening',       short: 'SLOOS C&I',  fmt: v => (v>=0?'+':'') + v.toFixed(1) + '%',              dir: 'hw',       methodology: 'Net % of banks tightening commercial & industrial loan standards. Quarterly Fed survey.' },
  sloos_cre:     { panel: 'credit', label: 'SLOOS · CRE tightening',       short: 'SLOOS CRE',  fmt: v => (v>=0?'+':'') + v.toFixed(1) + '%',              dir: 'hw',       methodology: 'Net % of banks tightening commercial real estate loan standards. Quarterly Fed survey.' },

  // EQUITIES
  spx_200dma:    { panel: 'equities', label: 'SPX vs 200-day average',     short: 'SPX vs 200d',fmt: v => (v>=0?'+':'') + v.toFixed(1) + '%',              dir: 'lw',       methodology: 'Distance of the S&P 500 from its 200-day moving average. Below = sustained downtrend.' },
  cape:          { panel: 'equities', label: 'CAPE · Shiller P/E',         short: 'CAPE',       fmt: v => v.toFixed(1) + 'x',                              dir: 'hw',       methodology: 'Price divided by 10-year average inflation-adjusted earnings. Multi-cycle valuation measure.' },
  vix:           { panel: 'equities', label: 'VIX · equity volatility',    short: 'VIX',        fmt: v => v.toFixed(1),                                    dir: 'hw',       methodology: '30-day implied move on the S&P 500, derived from listed options pricing. Reset daily.' },
  skew:          { panel: 'equities', label: 'SKEW · tail risk',           short: 'SKEW',       fmt: v => v.toFixed(0),                                    dir: 'hw',       methodology: 'Premium of out-of-the-money S&P puts. Captures crash-risk demand.' },
  eq_cr_corr:    { panel: 'equities', label: 'Equity-credit correlation',  short: 'Eq/Cr corr', fmt: v => v.toFixed(2),                                    dir: 'neutral',  methodology: '60-day rolling correlation of SPX returns with HY OAS changes.' },

  // MONEY & BANKING
  cpff:          { panel: 'money', label: 'Commercial paper spread',       short: 'CPFF',       fmt: v => Math.round(v) + ' bp',                           dir: 'hw',       methodology: '30-day AA-rated commercial paper minus 30-day T-bill. Wider = expensive 30-day corporate borrowing.' },
  anfci:         { panel: 'money', label: 'Chicago Fed FCI',               short: 'ANFCI',      fmt: v => (v>=0?'+':'') + v.toFixed(2),                    dir: 'hw',       methodology: 'Adjusted National Financial Conditions Index — 105 underlying variables. 0 = long-run average.' },
  stlfsi:        { panel: 'money', label: 'St. Louis FCI',                 short: 'STLFSI',     fmt: v => (v>=0?'+':'') + v.toFixed(2),                    dir: 'hw',       methodology: 'St. Louis Fed Financial Stress Index. Weekly. Composite of 18 weekly financial variables.' },
  bkx_spx_v11:   { panel: 'money', label: 'KBW Bank / SPX',                short: 'BKX/SPX',    fmt: v => v.toFixed(4),                                    dir: 'lw',       methodology: 'KBW Bank Index divided by S&P 500. Banks underperform when balance sheets are stressed.' },
  bank_credit:   { panel: 'money', label: 'Bank credit growth (YoY)',      short: 'Bank credit',fmt: v => (v>=0?'+':'') + v.toFixed(1) + '%',              dir: 'lw',       methodology: 'Year-over-year growth in total loans and leases at all US commercial banks.' },
  fed_bs:        { panel: 'money', label: 'Fed balance sheet',             short: 'Fed BS',     fmt: v => '$' + (v/1e3).toFixed(2) + 'T',                  dir: 'neutral',  methodology: 'Total assets on the Federal Reserve balance sheet, in millions of dollars.' },

  // ECONOMY
  ic4wsa:        { panel: 'economy', label: 'Initial jobless claims (4w)', short: 'IC4WSA',     fmt: v => Math.round(v) + 'K',                             dir: 'hw',       methodology: '4-week moving average of initial unemployment claims, seasonally adjusted.' },
  ism:           { panel: 'economy', label: 'ISM Manufacturing',           short: 'ISM Mfg',    fmt: v => v.toFixed(1),                                    dir: 'lw',       methodology: 'Manufacturing purchasing managers index. 50 = neutral; below = contraction.' },
  jolts_quits:   { panel: 'economy', label: 'JOLTS · quits rate',          short: 'Quits',      fmt: v => v.toFixed(1) + '%',                              dir: 'neutral',  methodology: '% of employed workers voluntarily leaving each month. Higher = labor confidence.' },
  copper_gold:   { panel: 'economy', label: 'Copper / Gold ratio',         short: 'Cu/Au',      fmt: v => v.toFixed(3),                                    dir: 'lw',       methodology: 'Front-month copper futures over gold futures. Cyclical demand indicator.' },
  usd:           { panel: 'economy', label: 'USD broad index',             short: 'USD',        fmt: v => v.toFixed(2),                                    dir: 'neutral',  methodology: 'Trade-weighted broad dollar index against a basket of major currencies.' },
  cfnai:         { panel: 'economy', label: 'Chicago Fed Nat. Activity',   short: 'CFNAI',      fmt: v => (v>=0?'+':'') + v.toFixed(2),                    dir: 'lw',       methodology: '85-indicator composite of real US economic activity, normalized to 0.' },
};

const PANELS = [
  { id: 'rates',    title: 'Rates',            subtitle: 'The cost and shape of money — what duration is being repriced.' },
  { id: 'credit',   title: 'Credit',           subtitle: 'What lenders are charging for risk, and whether they\'re still lending.' },
  { id: 'equities', title: 'Equities',         subtitle: 'What the stock tape is pricing in — level, volatility, and tail risk.' },
  { id: 'money',    title: 'Money & Banking',  subtitle: 'How freely capital is moving through the financial plumbing.' },
  { id: 'economy',  title: 'Economy',          subtitle: 'The real-world pulse — labor, activity, and cyclical demand.' },
];

// ─── helpers ────────────────────────────────────────────────────────────
function ascending(arr) { return [...arr].sort((a,b) => a-b); }

function percentile(value, arr) {
  if (!arr || arr.length === 0 || value == null) return null;
  const sorted = ascending(arr);
  let lo = 0, hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] < value) lo = mid + 1; else hi = mid;
  }
  return lo / sorted.length;
}

function trailingPctile(points, value) {
  if (!points || (value == null && value !== 0)) return null;
  const cutoff = new Date(); cutoff.setFullYear(cutoff.getFullYear() - 5);
  const cutoffStr = cutoff.toISOString().slice(0,10);
  const recent = points.filter(p => p[0] >= cutoffStr).map(p => p[1]).filter(v => v != null);
  return percentile(value, recent);
}

function thirtyDayDelta(points) {
  if (!points || points.length < 2) return null;
  const today = points[points.length - 1][1];
  const target = new Date(); target.setDate(target.getDate() - 30);
  const t = target.toISOString().slice(0,10);
  let priorIdx = 0;
  for (let i = points.length - 1; i >= 0; i--) { if (points[i][0] <= t) { priorIdx = i; break; } }
  const prior = points[priorIdx][1];
  if (prior == null) return null;
  return today - prior;
}

function ArrowGlyph({ delta, dir, fmt }) {
  if (delta == null) return <span style={{color:'var(--text-dim)'}}>—</span>;
  const up = delta > 0;
  let color = 'var(--text-muted)';
  if (dir === 'hw') color = up ? 'var(--red-text)' : 'var(--green-text)';
  if (dir === 'lw') color = up ? 'var(--green-text)' : 'var(--red-text)';
  const arrow = up ? '▲' : (delta < 0 ? '▼' : '◆');
  const abs = Math.abs(delta);
  const formatted = fmt ? fmt(abs).replace(/^\+/, '') : abs.toFixed(2);
  return <span style={{color, fontFamily:'var(--font-mono)', fontSize:11, fontVariantNumeric:'tabular-nums'}}>{arrow} {formatted}</span>;
}

function PctileDot({ pct }) {
  if (pct == null) return <span style={{width:14, height:14, display:'inline-block'}} />;
  const opacity = 0.25 + pct * 0.65;
  return (
    <span title={`${Math.round(pct*100)}th percentile (5y)`} style={{
      width: 14, height: 14, borderRadius: '50%', display: 'inline-block',
      background: `rgba(14,85,96,${opacity})`,
      border: '1px solid rgba(14,85,96,0.3)'
    }} />
  );
}

function panelTitle(panelId) {
  if (panelId === 'money') return 'Money & Banking';
  return panelId.charAt(0).toUpperCase() + panelId.slice(1);
}

// ─── Main ───────────────────────────────────────────────────────────────
export default function MacroOverviewPage() {
  const [hist, setHist] = useState(null);
  const [modal, setModal] = useState(null);

  useEffect(() => {
    fetch('/indicator_history.json', { cache: 'no-cache' })
      .then(r => r.ok ? r.json() : null).then(setHist).catch(() => setHist(null));
  }, []);

  const asOf = hist?.__meta__?.generated_at_utc?.slice(0,10) || null;
  const totalIndicators = Object.keys(INDICATORS).length;
  const panelGroups = useMemo(() => {
    const g = {};
    for (const p of PANELS) g[p.id] = [];
    for (const [id, def] of Object.entries(INDICATORS)) {
      if (g[def.panel]) g[def.panel].push({ id, ...def });
    }
    return g;
  }, []);

  if (!hist) {
    return (
      <main style={{ maxWidth: 1280, margin: '0 auto', padding: '60px 32px' }}>
        <div style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
          Loading Macro Overview…
        </div>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 1280, margin: '0 auto', padding: '0 0 64px' }}>
      <PageHero
        eyebrow="Macro Overview"
        title={<>The five things you should know about the <em>macro tape</em> today.</>}
        bullets={[
          'No regime call on this page — that lives on Asset Tilt. This is the indicator backdrop.',
          'Five domains: Rates, Credit, Equities, Money & Banking, and the real Economy.',
          'Click any indicator for full history, methodology, and overlays.',
        ]}
        right={
          <aside style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '18px 20px 14px', textAlign: 'center' }}>
            <div style={{ fontFamily: 'var(--font-ui)', fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.18em', marginBottom: 14 }}>
              On this page
            </div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 42, fontWeight: 400, lineHeight: 1, letterSpacing: '-0.015em', color: 'var(--text)' }}>
              {totalIndicators}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>
              indicators · five domains
            </div>
            {asOf && (
              <div style={{ marginTop: 14, fontSize: 11, color: 'var(--text-muted)' }}>
                Updated {asOf}
              </div>
            )}
          </aside>
        }
      />

      <div style={{ padding: '8px 32px 0' }}>
        {PANELS.map(panel => (
          <DomainPanel
            key={panel.id}
            panel={panel}
            indicators={panelGroups[panel.id]}
            hist={hist}
            onOpen={setModal}
          />
        ))}
      </div>

      {modal && (
        <IndicatorModal
          indicatorId={modal}
          def={INDICATORS[modal]}
          hist={hist}
          onClose={() => setModal(null)}
        />
      )}
    </main>
  );
}

function DomainPanel({ panel, indicators, hist, onOpen }) {
  return (
    <section style={{
      background: 'var(--surface)',
      border: '0.5px solid var(--border)',
      borderRadius: 12,
      padding: '24px 28px',
      marginBottom: 20,
    }}>
      <div style={{ marginBottom: 16, borderBottom: '0.5px solid var(--border-faint)', paddingBottom: 12 }}>
        <h2 style={{
          fontFamily: 'var(--font-display)',
          fontStyle: 'italic',
          fontWeight: 400,
          fontSize: 22,
          color: 'var(--accent)',
          margin: '0 0 4px',
          letterSpacing: '-0.005em',
        }}>{panel.title}</h2>
        <div style={{ fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.55 }}>{panel.subtitle}</div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 110px 110px 22px 90px', gap: 14, padding: '8px 4px 8px', borderBottom: '0.5px solid var(--border-faint)', fontFamily: 'var(--font-mono)', fontSize: 9.5, color: 'var(--text-muted)', letterSpacing: '0.10em', textTransform: 'uppercase', fontWeight: 600 }}>
        <div>Indicator</div>
        <div>Current</div>
        <div>30-day Δ</div>
        <div title="5-year percentile" style={{textAlign:'center'}}>5y</div>
        <div style={{ textAlign: 'right' }}>Fresh</div>
      </div>

      <div>
        {indicators.map(ind => (
          <IndicatorRow key={ind.id} ind={ind} hist={hist[ind.id]} onOpen={onOpen} />
        ))}
      </div>
    </section>
  );
}

function IndicatorRow({ ind, hist, onOpen }) {
  if (!hist || !hist.points || hist.points.length === 0) {
    return (
      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 110px 110px 22px 90px', gap: 14, alignItems: 'center', padding: '11px 4px', borderBottom: '0.5px dashed var(--border-faint)' }}>
        <div style={{ fontSize: 13.5, color: 'var(--text-muted)' }}>{ind.label}</div>
        <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>no data</div>
        <div /><div /><div />
      </div>
    );
  }
  const currentVal = hist.points[hist.points.length - 1][1];
  const delta = thirtyDayDelta(hist.points);
  const pct = trailingPctile(hist.points, currentVal);
  return (
    <div
      onClick={() => onOpen(ind.id)}
      style={{
        display: 'grid',
        gridTemplateColumns: '1.4fr 110px 110px 22px 90px',
        gap: 14,
        alignItems: 'center',
        padding: '11px 4px',
        borderBottom: '0.5px dashed var(--border-faint)',
        cursor: 'pointer',
        transition: 'background 80ms',
      }}
      onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-2)'}
      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
    >
      <div style={{ fontSize: 13.5, color: 'var(--text)', fontWeight: 500 }}>
        {ind.label}
      </div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--text)', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
        {ind.fmt(currentVal)}
      </div>
      <div>
        <ArrowGlyph delta={delta} dir={ind.dir} fmt={ind.fmt} />
      </div>
      <div style={{ textAlign: 'center' }}>
        <PctileDot pct={pct} />
      </div>
      <div style={{ textAlign: 'right' }}>
        <FreshnessChip elementId={`indicator-${ind.id}-${(hist.freq || 'd').toLowerCase()}`} fallback={hist.as_of} />
      </div>
    </div>
  );
}

function IndicatorModal({ indicatorId, def, hist, onClose }) {
  const series = hist[indicatorId];
  if (!series || !series.points) return null;
  const chartData = series.points.map(([d, v]) => ({ date: d, value: v }));
  const currentVal = series.points[series.points.length - 1][1];
  const delta30 = thirtyDayDelta(series.points);
  const pct5y = trailingPctile(series.points, currentVal);
  return (
    <Drawer open={true} onClose={onClose}>
      <div style={{ padding: '24px 28px 32px' }}>
        <div style={{ fontSize: 10.5, letterSpacing: '0.18em', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600, marginBottom: 6 }}>{panelTitle(def.panel)}</div>
        <h2 style={{ fontFamily: 'var(--font-display)', fontWeight: 400, fontSize: 26, color: 'var(--text)', letterSpacing: '-0.005em', margin: '0 0 16px' }}>
          {def.label}
        </h2>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 22 }}>
          <KPI label="Current" value={def.fmt(currentVal)} sub={`As of ${series.as_of || '—'}`} />
          <KPI label="30-day Δ" value={delta30 != null ? (delta30 >= 0 ? '+' : '') + def.fmt(Math.abs(delta30)).replace(/^\+/, '') : '—'} sub="vs 30d ago" />
          <KPI label="5y percentile" value={pct5y != null ? Math.round(pct5y*100) + 'th' : '—'} sub="trailing 5 years" />
        </div>

        <div style={{ background: 'var(--surface)', border: '0.5px solid var(--border)', borderRadius: 10, padding: '18px 20px', marginBottom: 18 }}>
          <HistoryChart
            series={[{ key: 'value', label: def.short, color: 'var(--accent)' }]}
            data={chartData}
            fmtY={def.fmt}
            defaultTf="5Y"
            height={320}
          />
        </div>

        <div style={{ background: 'var(--surface-2)', border: '0.5px solid var(--border-faint)', borderRadius: 10, padding: '16px 18px' }}>
          <div style={{ fontSize: 10.5, letterSpacing: '0.18em', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600, marginBottom: 8 }}>Methodology</div>
          <p style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.6, margin: 0 }}>
            {def.methodology}
          </p>
          <div style={{ marginTop: 12, fontSize: 11.5, color: 'var(--text-muted)' }}>
            Cadence: {series.freq === 'D' ? 'Daily' : series.freq === 'W' ? 'Weekly' : series.freq === 'M' ? 'Monthly' : series.freq === 'Q' ? 'Quarterly' : series.freq} · {series.points.length.toLocaleString()} points since {series.points[0][0]}
          </div>
        </div>
      </div>
    </Drawer>
  );
}

function KPI({ label, value, sub }) {
  return (
    <div style={{ background: 'var(--surface-2)', border: '0.5px solid var(--border-faint)', borderRadius: 8, padding: '12px 14px' }}>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9.5, color: 'var(--text-muted)', letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 4, fontWeight: 600 }}>{label}</div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 18, fontWeight: 600, color: 'var(--text)', lineHeight: 1.05, letterSpacing: '-0.015em' }}>{value}</div>
      <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 4 }}>{sub}</div>
    </div>
  );
}
