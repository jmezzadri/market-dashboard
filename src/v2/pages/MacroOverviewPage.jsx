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

  // Detect daily / weekly / monthly cadence from the average gap between samples.
  // Monthly indicators (CFNAI, JOLTS, ISM, etc.) used to fall into the weekly
  // bucket, which made the 5Y pill ask for 260 weekly points — and when the
  // series only had ~243 monthly points the slice returned the WHOLE array,
  // making 5Y identical to MAX.
  const cadence = (() => {
    if (data.length < 10) return "weekly";
    let gapSum = 0, n = 0;
    for (let i = 1; i < Math.min(20, data.length); i++) {
      const a = new Date(data[i - 1].date), b = new Date(data[i].date);
      gapSum += (b - a) / (1000 * 60 * 60 * 24);
      n++;
    }
    const avgGap = gapSum / n;
    if (avgGap < 4) return "daily";
    if (avgGap < 20) return "weekly";
    return "monthly";
  })();
  const tfPoints = cadence === "daily"
    ? { "1M": 21, "6M": 126, "1Y": 252, "5Y": 1260, "Max": data.length }
    : cadence === "weekly"
      ? { "1M": 4,  "6M": 26,  "1Y": 52,  "5Y": 260,  "Max": data.length }
      : { "1M": 3,  "6M": 6,   "1Y": 12,  "5Y": 60,   "Max": data.length };
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
          {(() => {
            const sorted = horizontalLines.map((h, i) => ({ ...h, _origIdx: i })).filter(h => h.value != null).sort((a, b) => a.value - b.value);
            const yPositions = sorted.map(h => yToPx(h.value));
            return sorted.map((h, i) => {
              const tooCloseToNext = i < sorted.length - 1 && Math.abs(yPositions[i] - yPositions[i + 1]) < 18;
              const tooCloseToPrev = i > 0 && Math.abs(yPositions[i] - yPositions[i - 1]) < 18;
              const labelAbove = !tooCloseToNext || tooCloseToPrev;
              const labelY = labelAbove ? yPositions[i] - 6 : yPositions[i] + 14;
              return (
                <g key={"h" + h._origIdx}>
                  <line x1={padL} y1={yPositions[i]} x2={W - padR} y2={yPositions[i]} stroke="var(--surface-solid, var(--surface, #fff))" strokeWidth="4" opacity="0.85" />
                  <line x1={padL} y1={yPositions[i]} x2={W - padR} y2={yPositions[i]} stroke={h.color || "var(--text-muted)"} strokeWidth="1.8" strokeDasharray="7 4" />
                  <rect x={W - padR - 6 - (h.label||"").length * 5.5} y={labelY - 8} width={(h.label||"").length * 5.7 + 8} height={12} fill="var(--surface-solid, var(--surface, #fff))" stroke="none" opacity="0.92" />
                  <text x={W - padR - 6} y={labelY} fontSize="10.5" fill={h.color || "var(--text-muted)"} textAnchor="end" fontFamily="Inter" fontWeight="600">{h.label || ""}</text>
                </g>
              );
            });
          })()}
          {allSeries.map((s, i) => {
            const sw = s.dashed ? 1.1 : (1.5 - i * 0.2);
            return (
              <path key={s.key} d={pathFor(s.key)} fill="none" stroke={s.color}
                    strokeWidth={Math.max(1.0, sw)} strokeDasharray={s.dashed ? "4 4" : undefined}
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
  term_premium:  { panel: 'rates', label: 'Term premium',                  short: 'Term prem',  fmt: v => (v>=0?'+':'') + Math.round(v) + ' bp',           dir: 'hw',       methodology: 'Extra yield investors demand for holding long-dated paper over rolling short paper, in basis points. A rising term premium signals bond holders pricing more duration risk — typically a late-cycle / stress signal.' },
  breakeven_10y: { panel: 'rates', label: '10y breakeven inflation',       short: '10y BE',     fmt: v => v.toFixed(2) + '%',                              dir: 'neutral',  methodology: 'Market-implied 10y inflation: nominal 10y yield minus 10y TIPS yield.' },

  // CREDIT
  hy_ig:         { panel: 'credit', label: 'High-yield OAS',               short: 'HY OAS',     fmt: v => Math.round(v) + ' bp',                           dir: 'hw',       methodology: 'ICE BofA US High Yield Index option-adjusted spread. Daily close.' },
  ig_oas:        { panel: 'credit', label: 'Investment-grade OAS',         short: 'IG OAS',     fmt: v => Math.round(v) + ' bp',                           dir: 'hw',       methodology: 'ICE BofA US Corporate Index option-adjusted spread. Daily close.' },
  hy_ig_ratio:   { panel: 'credit', label: 'HY / IG spread ratio',         short: 'HY/IG',      fmt: v => v.toFixed(2),                                    dir: 'hw',       methodology: 'Pure premium for credit risk, normalized by duration. Rising = lenders pricing more risk.' },
  sloos_ci:      { panel: 'credit', label: 'SLOOS · C&I tightening',       short: 'SLOOS C&I',  fmt: v => (v>=0?'+':'') + v.toFixed(1) + '%',              dir: 'hw',       methodology: 'Net % of banks tightening commercial & industrial loan standards. Quarterly Fed survey.' },
  sloos_cre:     { panel: 'credit', label: 'SLOOS · CRE tightening',       short: 'SLOOS CRE',  fmt: v => (v>=0?'+':'') + v.toFixed(1) + '%',              dir: 'hw',       methodology: 'Net % of banks tightening commercial real estate loan standards. Quarterly Fed survey.' },

  // EQUITIES
  buffett:       { panel: 'equities', label: 'Buffett indicator',          short: 'Mkt/GDP',    fmt: v => v.toFixed(0) + '%',                              dir: 'hw',       methodology: 'US equity market cap as a percentage of GDP. High readings flag rich valuations relative to economic activity.' },
  cape:          { panel: 'equities', label: 'CAPE · Shiller P/E',         short: 'CAPE',       fmt: v => v.toFixed(1) + 'x',                              dir: 'hw',       methodology: 'Price divided by 10-year average inflation-adjusted earnings. Multi-cycle valuation measure.' },
  vix:           { panel: 'equities', label: 'VIX · equity volatility',    short: 'VIX',        fmt: v => v.toFixed(1),                                    dir: 'hw',       methodology: '30-day implied move on the S&P 500, derived from listed options pricing. Reset daily.' },
  skew:          { panel: 'equities', label: 'SKEW · tail risk',           short: 'SKEW',       fmt: v => v.toFixed(0),                                    dir: 'hw',       methodology: 'Premium of out-of-the-money S&P puts. Captures crash-risk demand.' },
  eq_cr_corr:    { panel: 'equities', label: 'Equity-credit correlation',  short: 'Eq/Cr corr', fmt: v => v.toFixed(2),                                    dir: 'neutral',  methodology: '63-day rolling correlation of S&P 500 (SPY) and high-yield bond (HYG) daily returns.' },

  // MONEY & BANKING
  cpff:          { panel: 'money', label: 'Commercial paper spread',       short: 'CPFF',       fmt: v => Math.round(v) + ' bp',                           dir: 'hw',       methodology: '3-month AA financial commercial paper rate minus the Fed Funds rate. Wider = costlier short-term corporate funding.' },
  anfci:         { panel: 'money', label: 'Chicago Fed FCI',               short: 'ANFCI',      fmt: v => (v>=0?'+':'') + v.toFixed(2),                    dir: 'hw',       methodology: 'Adjusted National Financial Conditions Index — 105 underlying variables. 0 = long-run average.' },
  stlfsi:        { panel: 'money', label: 'St. Louis FCI',                 short: 'STLFSI',     fmt: v => (v>=0?'+':'') + v.toFixed(2),                    dir: 'hw',       methodology: 'St. Louis Fed Financial Stress Index. Weekly. Composite of 18 weekly financial variables.' },
  bkx_spx_v11:   { panel: 'money', label: 'KBW Bank / SPX',                short: 'BKX/SPX',    fmt: v => v.toFixed(4),                                    dir: 'lw',       methodology: 'KBW Bank Index divided by S&P 500. Banks underperform when balance sheets are under pressure.' },
  bank_credit:   { panel: 'money', label: 'Bank credit growth (YoY)',      short: 'Bank credit',fmt: v => (v>=0?'+':'') + v.toFixed(1) + '%',              dir: 'lw',       methodology: 'Year-over-year growth in total bank credit — loans, leases, and securities — at all US commercial banks.' },
  fed_bs:        { panel: 'money', label: 'Fed balance sheet (YoY)',       short: 'Fed BS YoY', fmt: v => (v>=0?'+':'') + v.toFixed(2) + '%',              dir: 'lw',       methodology: 'Year-over-year change in the size of the Federal Reserve balance sheet. Negative = the Fed is shrinking its balance sheet (quantitative tightening) — a tightening force on risk assets.' },

  // ECONOMY
  ic4wsa:        { panel: 'economy', label: 'Initial jobless claims (4w)', short: 'IC4WSA',     fmt: v => Math.round(v) + 'K',                             dir: 'hw',       methodology: '4-week moving average of initial unemployment claims, seasonally adjusted.' },
  ism:           { panel: 'economy', label: 'ISM Manufacturing',           short: 'ISM Mfg',    fmt: v => v.toFixed(1),                                    dir: 'lw',       methodology: 'Manufacturing purchasing managers index. 50 = neutral; below = contraction.' },
  jolts_quits:   { panel: 'economy', label: 'JOLTS · quits rate',          short: 'Quits',      fmt: v => v.toFixed(1) + '%',                              dir: 'lw',       methodology: '% of employed workers voluntarily leaving each month. A low quits rate means workers do not feel confident enough to leave — labor-market weakness signal.' },
  copper_gold:   { panel: 'economy', label: 'Copper / Gold ratio',         short: 'Cu/Au',      fmt: v => v.toFixed(2),                                    dir: 'lw',       methodology: 'Front-month copper ($/lb) divided by front-month gold ($/oz), scaled by 1,000 — the desk convention, which reads around 1.4. A rising ratio means cyclical/industrial demand is firming relative to safe-haven demand.' },
  usd:           { panel: 'economy', label: 'USD broad index',             short: 'USD',        fmt: v => v.toFixed(2),                                    dir: 'neutral',  methodology: 'Trade-weighted broad dollar index against a basket of major currencies.' },
  cfnai:         { panel: 'economy', label: 'Chicago Fed National Activity',   short: 'CFNAI',      fmt: v => (v>=0?'+':'') + v.toFixed(2),                    dir: 'lw',       methodology: '85-indicator composite of real US economic activity, normalized to 0.' },
};

// Source attribution per indicator key — surfaces the vendor + dataset on
// the modal "Source · Cadence · Freshness" panel so the user can trace any
// number on the page back to where it came from. Mirrors the Per-Ticker
// Data Inventory format (vendor · feed identifier). Joe directive 2026-05-19.
const INDICATOR_SOURCES = {
  yield_curve:   "FRED · 10-Year minus 2-Year Treasury (T10Y2Y)",
  real_rates:    "FRED · 10-Year Treasury Inflation-Indexed Yield (DFII10)",
  move:          "Yahoo · ICE BofA MOVE Index (^MOVE)",
  term_premium:  "FRED · Kim-Wright 10-Year Term Premium (THREEFYTP10)",
  breakeven_10y: "FRED · 10-Year Breakeven Inflation (T10YIE)",
  hy_ig:         "FRED · ICE BofA US High-Yield OAS (BAMLH0A0HYM2)",
  ig_oas:        "FRED · ICE BofA US Corporate OAS (BAMLC0A0CM)",
  hy_ig_ratio:   "In-house · HY OAS / IG OAS ratio (from FRED feeds above)",
  sloos_ci:      "FRED · Senior Loan Officer Survey · C&I tightening (DRTSCILM)",
  sloos_cre:     "FRED · Senior Loan Officer Survey · CRE tightening (DRTSCRELM)",
  buffett:       "In-house · US equity market cap / GDP (Wilshire 5000 + GDP via FRED)",
  cape:          "multpl.com · Shiller cyclically-adjusted P/E",
  vix:           "Yahoo · CBOE Volatility Index (^VIX)",
  skew:          "Yahoo · CBOE SKEW Index (^SKEW)",
  eq_cr_corr:    "In-house · 63-day rolling correlation of S&P 500 (SPY) and high-yield bond (HYG) daily returns",
  cpff:          "FRED · 3-month AA financial commercial paper minus Fed Funds (DCPF3M − DFF)",
  anfci:         "FRED · Chicago Fed Adjusted National Financial Conditions Index (ANFCI)",
  stlfsi:        "FRED · St. Louis Fed Financial Stress Index (STLFSI4)",
  bkx_spx_v11:   "Yahoo · KBW Bank Index (^BKX) / S&P 500 (^GSPC)",
  bank_credit:   "FRED · H.8 Bank Credit, All Commercial Banks (TOTBKCR)",
  fed_bs:        "FRED · Total Assets of the Federal Reserve (WALCL)",
  ic4wsa:        "FRED · 4-week Moving Average of Initial Jobless Claims (IC4WSA)",
  ism:           "ISM website · Manufacturing PMI (monthly)",
  jolts_quits:   "FRED · JOLTS Quits Rate (JTSQUR)",
  copper_gold:   "Yahoo · Copper futures (HG=F) / Gold futures (GC=F)",
  usd:           "Yahoo · ICE US Dollar Broad Index (DX-Y.NYB)",
  cfnai:         "FRED · Chicago Fed National Activity Index (CFNAI)",
};

// Cadence WITH the publication lag spelled out. A user who sees "Daily" next
// to a value two days old should not have to wonder whether the feed is
// broken — the lag is a known, normal property of the series, so we state it.
// "T+N" = the value lands N business days after the trading day it covers;
// weekly/monthly/quarterly series state the typical wait after the period
// closes. Series with no suffix publish same-day / with no material lag.
const INDICATOR_CADENCE = {
  yield_curve:   "Daily (T+1)",
  real_rates:    "Daily (T+2)",
  move:          "Daily (T+1)",
  term_premium:  "Daily (T+4)",
  breakeven_10y: "Daily (T+1)",
  hy_ig:         "Daily (T+1)",
  ig_oas:        "Daily (T+1)",
  hy_ig_ratio:   "Daily (T+1)",
  sloos_ci:      "Quarterly (~5-week lag)",
  sloos_cre:     "Quarterly (~5-week lag)",
  buffett:       "Quarterly (~1-quarter lag)",
  cape:          "Monthly",
  vix:           "Daily",
  skew:          "Daily (T+1)",
  eq_cr_corr:    "Daily",
  cpff:          "Weekly (~1-week lag)",
  anfci:         "Weekly (~1-week lag)",
  stlfsi:        "Weekly (~1-week lag)",
  bkx_spx_v11:   "Daily",
  bank_credit:   "Weekly (~2-week lag)",
  fed_bs:        "Weekly (~1-week lag)",
  ic4wsa:        "Weekly (~1-week lag)",
  ism:           "Monthly",
  jolts_quits:   "Monthly (~6-week lag)",
  copper_gold:   "Daily",
  usd:           "Daily",
  cfnai:         "Monthly (~4-week lag)",
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

// ─── Data-viz palette — distinct from the brand --accent (which stays for
//     page chrome only: H1, italic title accent, link colors). These three
//     colors are SEMANTIC: hot = stressed reading, cool = calm reading,
//     watch = mid-range. They're applied to mini-chart lines + percentile
//     bars so a glance at the page lights up where the hotspots are.
const VIZ_COLORS = {
  hot:     '#D946C4',  // magenta — high stress
  cool:    '#10B981',  // emerald-teal — calm
  watch:   '#F59E0B',  // amber — mid
  neutral: '#64748B',  // slate — direction-agnostic indicators
  faint:   'rgba(100,116,139,0.18)',  // faint slate for chart fills
};

function LegendDot({ color, label, sub }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <span style={{ width: 12, height: 12, borderRadius: '50%', background: color, flexShrink: 0, opacity: 0.9 }} />
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text)', letterSpacing: '0.02em' }}>{label}</span>
        <span style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>{sub}</span>
      </div>
    </div>
  );
}

// Decide a tile's heat color from its 5y percentile + direction-of-stress.
function heatColor(pct, dir) {
  if (pct == null) return VIZ_COLORS.neutral;
  if (dir === 'hw') {
    if (pct >= 0.75) return VIZ_COLORS.hot;
    if (pct >= 0.50) return VIZ_COLORS.watch;
    return VIZ_COLORS.cool;
  }
  if (dir === 'lw') {
    if (pct <= 0.25) return VIZ_COLORS.hot;
    if (pct <= 0.50) return VIZ_COLORS.watch;
    return VIZ_COLORS.cool;
  }
  return VIZ_COLORS.neutral;
}

function heatLabel(pct, dir) {
  // Direction-aware label tied 1:1 to heat color:
  //   magenta = Extreme, amber = Elevated, teal = Calm.
  if (pct == null) return null;
  if (dir === 'hw') {
    if (pct >= 0.75) return 'Extreme';
    if (pct >= 0.50) return 'Elevated';
    return 'Calm';
  }
  if (dir === 'lw') {
    if (pct <= 0.25) return 'Extreme';
    if (pct <= 0.50) return 'Elevated';
    return 'Calm';
  }
  if (pct >= 0.75) return 'High vs. 5y range';
  if (pct <= 0.25) return 'Low vs. 5y range';
  return 'Mid-range (5y)';
}

// ─── MiniChart — properly-sized in-tile chart (~320×110) with min/max y
//     labels, 4-digit start/end date markers, and a crosshair + tooltip
//     on hover. Trailing 1y window. Line color = the tile's heat color.
function MiniChart({ points, color = VIZ_COLORS.neutral, fmt = (v) => v.toFixed(2), width = 320, height = 110 }) {
  const [hoverIdx, setHoverIdx] = useState(null);
  const svgRef = useRef(null);
  if (!points || points.length < 2) {
    return <div style={{ width, height, background: 'var(--surface-2)', borderRadius: 6 }} />;
  }
  let gap = 0, n = 0;
  for (let i = 1; i < Math.min(20, points.length); i++) {
    gap += (new Date(points[i][0]) - new Date(points[i-1][0])) / 86400000; n++;
  }
  const daily = (gap / n) < 4;
  const window = points.slice(- (daily ? 252 : 52));
  const vals = window.map(p => p[1]).filter(v => v != null);
  if (vals.length < 2) return <div style={{ width, height, background: 'var(--surface-2)', borderRadius: 6 }} />;
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const pad = (hi - lo) * 0.08 || Math.abs(hi) * 0.05 || 1;
  const yLo = lo - pad, yHi = hi + pad;
  const padL = 6, padR = 6, padT = 14, padB = 18;
  const innerW = width - padL - padR, innerH = height - padT - padB;
  const xToPx = i => padL + (i / Math.max(1, window.length - 1)) * innerW;
  const yToPx = v => padT + ((yHi - v) / (yHi - yLo)) * innerH;
  let d = '';
  window.forEach((p, i) => {
    if (p[1] == null) return;
    d += (d ? ' L ' : 'M ') + xToPx(i).toFixed(1) + ' ' + yToPx(p[1]).toFixed(1);
  });
  const last = window[window.length - 1];
  const lastX = xToPx(window.length - 1);
  const lastY = yToPx(last[1]);
  const areaD = d + ` L ${lastX.toFixed(1)} ${height - padB} L ${padL} ${height - padB} Z`;
  const firstDate = new Date(window[0][0]);
  const lastDate = new Date(last[0]);
  const axisDateFmt = d => d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  const tipDateFmt  = d => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const gridYs = [padT + innerH/3, padT + innerH*2/3];

  // Hover handling: map mouse x into an index in window
  const handleMove = (e) => {
    if (!svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const xRel = (e.clientX - rect.left) / rect.width * width;
    const xData = (xRel - padL) / innerW;
    const idx = Math.round(xData * (window.length - 1));
    if (idx >= 0 && idx < window.length) setHoverIdx(idx);
  };
  const handleLeave = () => setHoverIdx(null);

  const hover = hoverIdx != null ? window[hoverIdx] : null;
  const hoverX = hoverIdx != null ? xToPx(hoverIdx) : null;
  const hoverY = hover != null && hover[1] != null ? yToPx(hover[1]) : null;
  // Tooltip placement: anchor inside the chart, flip to left side if cursor near right edge.
  const tipFlip = hoverIdx != null && hoverIdx > window.length * 0.66;

  return (
    <div style={{ position: 'relative', width: '100%', height: height, overflow: 'hidden' }}>
      <svg ref={svgRef} viewBox={`0 0 ${width} ${height}`}
           style={{ display: 'block', cursor: 'crosshair', userSelect: 'none', width: '100%', height: '100%' }}
           preserveAspectRatio="none"
           onMouseMove={handleMove} onMouseLeave={handleLeave}>
        {gridYs.map((y, i) => (
          <line key={i} x1={padL} y1={y} x2={width - padR} y2={y} stroke="rgba(120,127,135,0.18)" strokeWidth="1" />
        ))}
        <path d={areaD} fill={color} fillOpacity="0.10" />
        <path d={d} fill="none" stroke={color} strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx={lastX} cy={lastY} r="3" fill={color} stroke="var(--surface)" strokeWidth="1" />
        <text x={padL + 2} y={padT - 2} fontSize="9" fill="var(--text-dim)" fontFamily="var(--font-mono)" textAnchor="start">{hi.toFixed(hi >= 100 ? 0 : 2)}</text>
        <text x={padL + 2} y={height - padB + 9} fontSize="9" fill="var(--text-dim)" fontFamily="var(--font-mono)" textAnchor="start">{lo.toFixed(hi >= 100 ? 0 : 2)}</text>
        <text x={padL} y={height - 4} fontSize="9" fill="var(--text-dim)" fontFamily="var(--font-mono)" textAnchor="start">{axisDateFmt(firstDate)}</text>
        <text x={width - padR} y={height - 4} fontSize="9" fill="var(--text-dim)" fontFamily="var(--font-mono)" textAnchor="end">{axisDateFmt(lastDate)}</text>
        {/* Crosshair */}
        {hoverX != null && (
          <g>
            <line x1={hoverX} y1={padT} x2={hoverX} y2={height - padB} stroke="var(--text-muted)" strokeWidth="1" strokeDasharray="2 3" opacity="0.7" />
            {hoverY != null && (
              <circle cx={hoverX} cy={hoverY} r="3.5" fill={color} stroke="var(--surface)" strokeWidth="1.4" />
            )}
          </g>
        )}
      </svg>
      {/* Tooltip — small floating panel anchored inside the chart container */}
      {hover && hover[1] != null && hoverX != null && (
        <div style={{
          position: 'absolute',
          top: 4,
          [tipFlip ? 'left' : 'right']: tipFlip ? 4 : 4,
          background: 'var(--text)',
          color: 'var(--bg)',
          padding: '4px 8px',
          borderRadius: 4,
          fontSize: 10.5,
          lineHeight: 1.3,
          fontFamily: 'var(--font-mono)',
          fontVariantNumeric: 'tabular-nums',
          pointerEvents: 'none',
          whiteSpace: 'nowrap',
          boxShadow: '0 2px 6px rgba(0,0,0,0.18)',
        }}>
          <div style={{ opacity: 0.75, fontSize: 9.5, marginBottom: 1 }}>{tipDateFmt(new Date(hover[0]))}</div>
          <div style={{ fontWeight: 600 }}>{fmt(hover[1])}</div>
        </div>
      )}
    </div>
  );
}

// ─── PctileBar — 5y percentile range with marker.
function PctileBar({ pct, color = VIZ_COLORS.neutral, width = '100%', height = 8 }) {
  if (pct == null) return <div style={{ width, height }} />;
  return (
    <div title={`${Math.round(pct*100)}th percentile (5y)`} style={{
      position: 'relative', width, height, background: 'var(--surface-2)',
      borderRadius: height / 2, border: '0.5px solid var(--border-faint)',
    }}>
      <div style={{
        position: 'absolute', left: 0, top: 0, bottom: 0,
        width: `${Math.max(2, pct*100)}%`,
        background: color, opacity: 0.85,
        borderRadius: height / 2,
      }} />
      <div style={{
        position: 'absolute', left: `${Math.max(2, pct*100)}%`, top: -2, bottom: -2,
        width: 2, background: 'var(--text)', transform: 'translateX(-1px)',
        borderRadius: 1,
      }} />
    </div>
  );
}

// ─── Domain heatmap strip — one cell per indicator inside this panel,
//     filled with its heat color, sized equally. Click any cell to drill in.
//     This is the "where are the hotspots" glance.
function DomainHeatStrip({ indicators, hist, onOpen }) {
  return (
    <div style={{ display: 'flex', gap: 4, marginBottom: 18 }}>
      {indicators.map(ind => {
        const series = hist[ind.id];
        let pct = null;
        if (series && series.points && series.points.length) {
          const cur = series.points[series.points.length - 1][1];
          pct = trailingPctile(series.points, cur);
        }
        const c = heatColor(pct, ind.dir);
        const lbl = heatLabel(pct, ind.dir);
        return (
          <div key={ind.id} onClick={() => onOpen(ind.id)} title={`${ind.short} · ${pct != null ? Math.round(pct*100)+'th' : '—'} pctile${lbl ? ' · ' + lbl : ''}`} style={{
            flex: 1, minWidth: 0, height: 36, borderRadius: 6, cursor: 'pointer',
            background: c, opacity: 0.85,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'transform 80ms, opacity 80ms',
          }}>
            <span style={{ fontSize: 9.5, color: '#fff', fontFamily: 'var(--font-mono)', fontWeight: 600, letterSpacing: '0.04em', textShadow: '0 1px 2px rgba(0,0,0,0.18)' }}>{ind.short}</span>
          </div>
        );
      })}
    </div>
  );
}

// ─── IndicatorTile — the new core unit. Replaces the row layout entirely.
//     Each tile gives a name, current value, delta, a real chart with axis
//     labels, and a heat-colored percentile bar. Click anywhere to open
//     the wide modal.
function IndicatorTile({ ind, hist, onOpen }) {
  const series = hist[ind.id];
  const has = !!(series && series.points && series.points.length);
  const currentVal = has ? series.points[series.points.length - 1][1] : null;
  const delta = has ? thirtyDayDelta(series.points) : null;
  const pct = has ? trailingPctile(series.points, currentVal) : null;
  const c = heatColor(pct, ind.dir);
  const lbl = heatLabel(pct, ind.dir);
  return (
    <div onClick={() => has && onOpen(ind.id)} style={{
      background: 'var(--surface)',
      border: '0.5px solid var(--border)',
      borderTop: `2px solid ${c}`,
      borderRadius: 10,
      padding: '16px 18px 14px',
      cursor: has ? 'pointer' : 'default',
      transition: 'border-color 120ms, box-shadow 120ms, transform 120ms',
      display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0,
    }}
    onMouseEnter={e => { if (has) { e.currentTarget.style.boxShadow = '0 4px 14px rgba(14,17,21,0.06)'; e.currentTarget.style.transform = 'translateY(-1px)'; }}}
    onMouseLeave={e => { e.currentTarget.style.boxShadow = 'none'; e.currentTarget.style.transform = 'none'; }}>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
        <div>
          <div style={{ fontSize: 13.5, color: 'var(--text)', fontWeight: 600, lineHeight: 1.3 }}>{ind.label}</div>
          {lbl && (
            <div style={{ fontSize: 9.5, fontFamily: 'var(--font-mono)', letterSpacing: '0.12em', textTransform: 'uppercase', color: c, fontWeight: 700, marginTop: 4 }}>
              {lbl}
            </div>
          )}
        </div>
        {has && <FreshnessChip elementId={`indicator-${ind.id}-${(series.freq || 'd').toLowerCase()}`} fallback={series.as_of} freq={series.freq} />}
      </div>

      {/* Value + delta */}
      {has ? (
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 400, color: 'var(--text)', letterSpacing: '-0.012em', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
            {ind.fmt(currentVal)}
          </div>
          <ArrowGlyph delta={delta} dir={ind.dir} fmt={ind.fmt} />
        </div>
      ) : (
        <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>No data</div>
      )}

      {/* Chart */}
      {has && <MiniChart points={series.points} color={c} fmt={ind.fmt} />}

      {/* Percentile bar */}
      {has && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 }}>
          <span style={{ fontSize: 9.5, fontFamily: 'var(--font-mono)', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 600, flexShrink: 0 }}>5y</span>
          <div style={{ flex: 1 }}>
            <PctileBar pct={pct} color={c} />
          </div>
          <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-2)', fontWeight: 600, fontVariantNumeric: 'tabular-nums', minWidth: 32, textAlign: 'right' }}>
            {pct != null ? Math.round(pct*100) + 'th' : '—'}
          </span>
        </div>
      )}
    </div>
  );
}

// ─── Modal — centered, near-full-width container for indicator detail.
//     Replaces the right-side Drawer per Joe's 2026-05-17 request.
function Modal({ open, onClose, children }) {
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose && onClose(); }
    if (open) {
      document.addEventListener('keydown', onKey);
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <>
      <div onClick={onClose} style={{
        position: 'fixed', inset: 0, background: 'rgba(14,17,21,0.42)',
        zIndex: 50, animation: 'mtFadeIn 160ms ease-out',
      }} />
      <div role="dialog" aria-modal="true" style={{
        position: 'fixed', top: '4vh', left: '50%', transform: 'translateX(-50%)',
        width: 'min(1200px, 94vw)', maxHeight: '92vh', overflowY: 'auto',
        background: 'var(--surface)', borderRadius: 14, zIndex: 60,
        boxShadow: '0 16px 64px rgba(14,17,21,0.20), 0 4px 16px rgba(14,17,21,0.08)',
        border: '0.5px solid var(--border)',
      }}>
        <button onClick={onClose} aria-label="Close" style={{
          position: 'absolute', top: 16, right: 16, width: 34, height: 34,
          borderRadius: '50%', border: '0.5px solid var(--border)',
          background: 'var(--surface)', cursor: 'pointer', fontSize: 18,
          color: 'var(--text-muted)', lineHeight: 1, padding: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2,
        }}>×</button>
        {children}
      </div>
    </>
  );
}

function panelTitle(panelId) {
  if (panelId === 'money') return 'Money & Banking';
  return panelId.charAt(0).toUpperCase() + panelId.slice(1);
}

// Cadence-aware "as of" formatter for the modal. Monthly / quarterly series
// are dated to the first of their period by the data source — render them as
// the period ("March 2026", "Q1 2026") so a current reading never reads as a
// stale calendar day. Daily / weekly series render as a normal date.
function fmtAsOf(iso, freq) {
  if (!iso) return '—';
  const dt = new Date(iso.length === 10 ? iso + 'T00:00:00Z' : iso);
  if (Number.isNaN(dt.getTime())) return iso;
  const f = (freq || '').toUpperCase();
  if (f === 'M') return dt.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  if (f === 'Q') return `Q${Math.floor(dt.getUTCMonth() / 3) + 1} ${dt.getUTCFullYear()}`;
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
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

      <div style={{ display: 'flex', justifyContent: 'center', gap: 28, padding: '20px 32px 4px', flexWrap: 'wrap' }}>
        <LegendDot color={VIZ_COLORS.cool}    label="Calm"      sub="Reading is not signalling stress" />
        <LegendDot color={VIZ_COLORS.watch}   label="Elevated"  sub="Mid-range — worth watching" />
        <LegendDot color={VIZ_COLORS.hot}     label="Extreme"  sub="Reading is at an extreme of its 5y range" />
        <LegendDot color={VIZ_COLORS.neutral} label="Range-only" sub="Direction-agnostic — shown vs. 5y range" />
      </div>

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
      background: 'transparent',
      padding: '0 0 8px',
      marginBottom: 28,
    }}>
      <div style={{ marginBottom: 14 }}>
        <h2 style={{
          fontFamily: 'var(--font-display)',
          fontStyle: 'italic',
          fontWeight: 400,
          fontSize: 24,
          color: 'var(--text)',
          margin: '0 0 4px',
          letterSpacing: '-0.008em',
        }}>{panel.title}</h2>
        <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.55 }}>{panel.subtitle}</div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
        {indicators.map(ind => (
          <IndicatorTile key={ind.id} ind={ind} hist={hist} onOpen={onOpen} />
        ))}
      </div>
    </section>
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
    <Modal open={true} onClose={onClose}>
      <div style={{ padding: '32px 40px 36px' }}>
        <div style={{ fontSize: 10.5, letterSpacing: '0.18em', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600, marginBottom: 8 }}>{panelTitle(def.panel)}</div>
        <h2 style={{ fontFamily: 'var(--font-display)', fontWeight: 400, fontSize: 32, color: 'var(--text)', letterSpacing: '-0.012em', margin: '0 0 22px' }}>
          {def.label}
        </h2>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 24 }}>
          <KPI label="Current" value={def.fmt(currentVal)} sub={`As of ${fmtAsOf(series.as_of, series.freq)}`} />
          <KPI label="30-day Δ" value={delta30 != null ? (delta30 >= 0 ? '+' : '') + def.fmt(Math.abs(delta30)).replace(/^\+/, '') : '—'} sub="vs 30 days ago" />
          <KPI label="5y percentile" value={pct5y != null ? Math.round(pct5y*100) + 'th' : '—'} sub="trailing 5 years" />
          <KPI label="History since" value={series.points[0][0]} sub={`${series.points.length.toLocaleString()} points`} />
        </div>

        <div style={{ background: 'var(--surface)', border: '0.5px solid var(--border)', borderRadius: 12, padding: '22px 24px', marginBottom: 22 }}>
          <HistoryChart
            series={[{ key: 'value', label: def.short, color: heatColor(pct5y, def.dir) }]}
            data={chartData}
            fmtY={def.fmt}
            defaultTf="Max"
            height={400}
          />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 18 }}>
          <div style={{ background: 'var(--surface-2)', border: '0.5px solid var(--border-faint)', borderRadius: 12, padding: '20px 22px' }}>
            <div style={{ fontSize: 10.5, letterSpacing: '0.18em', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600, marginBottom: 10 }}>Methodology</div>
            <p style={{ fontSize: 14, color: 'var(--text-2)', lineHeight: 1.65, margin: 0 }}>
              {def.methodology}
            </p>
          </div>
          <div style={{ background: 'var(--surface-2)', border: '0.5px solid var(--border-faint)', borderRadius: 12, padding: '20px 22px' }}>
            <div style={{ fontSize: 10.5, letterSpacing: '0.18em', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600, marginBottom: 10 }}>Source · Cadence · Freshness</div>
            <div style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.65 }}>
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.04em', textTransform: 'uppercase', fontWeight: 600, marginBottom: 2 }}>Source</div>
                {INDICATOR_SOURCES[indicatorId] || 'Source not yet mapped'}
              </div>
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.04em', textTransform: 'uppercase', fontWeight: 600, marginBottom: 2 }}>Cadence</div>
                {INDICATOR_CADENCE[indicatorId] || (series.freq === 'D' ? 'Daily' : series.freq === 'W' ? 'Weekly' : series.freq === 'M' ? 'Monthly' : series.freq === 'Q' ? 'Quarterly' : series.freq)}
              </div>
              <div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.04em', textTransform: 'uppercase', fontWeight: 600, marginBottom: 2 }}>Last update</div>
                {fmtAsOf(series.as_of, series.freq)}
              </div>
            </div>
          </div>
        </div>
      </div>
    </Modal>
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
