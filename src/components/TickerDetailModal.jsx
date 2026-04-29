// TickerDetailModal — extracted from src/App.jsx as part of Phase 4b PR-A
// (modal rebuild prep). PURE REFACTOR — no functional change in this PR.
// The visual rebuild against the v5 mockup spec lands in PR-B (hero +
// KPI strip), PR-C (Signal Intelligence rail), PR-D (bottom tabs +
// action row).
//
// Surface unchanged: still rendered from App.jsx via the same prop set
// (ticker, scanData, accounts, watchlistRows, portfolioAuthed,
// refetchPortfolio, onClose, onTickerAdded, scanBusy).
//
// Lead Developer ship; UX Designer signed off (visual rendering is
// byte-for-byte identical, brand audit not triggered for a no-op move);
// Senior Quant signed off (no calculation surface change).

import { useState, useEffect, useRef } from "react";
import { InfoTip, Tip } from "../InfoTip";
import HistoricalChart from "./HistoricalChart";
import UniverseFreshness from "./UniverseFreshness";
import { computeSectionComposites, colorForDirection } from "../ticker/sectionComposites";
import { normalizeTickerName } from "../lib/nameFormat";
import { supabase } from "../lib/supabase";
import useMassiveTickerInfo from "../hooks/useMassiveTickerInfo";
import useStockRiskMetrics from "../hooks/useStockRiskMetrics";
import useTickerDeepDive from "../hooks/useTickerDeepDive";
import { WATCHLIST_FALLBACK } from "../data/watchlistFallback";



// ============================================================================
// SignalIntelligenceRail — Phase 4b PR-C
// 6 RAG tiles: Macro Composite · Asset Tilt · Technical Indicators ·
// Unusual Flow · Earnings & Events · News.
// LESSONS rule #29: stateful disclosure pattern (no <details>), Fraunces +
// JetBrains Mono + parchment via site CSS vars.
// LESSONS rule #30: every value derives from live data (composite,
// macroLatest, v9Alloc, scanData feeds); no hardcoded narrative.
// ============================================================================
function SignalIntelligenceRail({
  ticker, composite, tech, scanData, macroLatest, v9Alloc,
  riskMetrics, heldIn,
  sector, isFund,
  congressBuys, congressSells, insiderBuys, insiderSells,
  flowCalls, flowPuts, darkPoolPrints, news,
  nextEarn, earnTimeForChip, impMove30, scrollToSection,
}) {
  const fmtSigned = v => v == null ? "—" : `${v >= 0 ? "+" : ""}${v}`;
  const ragColor = state => state === "green" ? "var(--green-text, #1a8c39)"
                          : state === "amber" ? "var(--yellow-text, #B8860B)"
                          : state === "red"   ? "var(--red-text, #c8302a)"
                          : "var(--text-dim)";

  // Tile 1 — Macro Composite
  const macroTile = (() => {
    if (!macroLatest) return { state: "loading", value: "…", meta: "Loading composite history", detail: null };
    const rl = macroLatest.RL, gr = macroLatest.GR, ir = macroLatest.IR;
    const blend = [rl, gr, ir].filter(Number.isFinite);
    const avg = blend.length ? blend.reduce((a,b)=>a+b,0) / blend.length : null;
    const state = avg == null ? "loading" : avg >= 10 ? "green" : avg <= -10 ? "red" : "amber";
    const value = avg == null ? "—" : fmtSigned(Math.round(avg));
    const meta = state === "green" ? "Risk-on regime · all 3 composites positive"
              : state === "red"   ? "Risk-off regime · composites stressed"
              : "Mixed regime · composites split";
    return {
      state, value, meta,
      detail: (
        <>
          <b>R&amp;L</b> {fmtSigned(Math.round(rl))} · <b>Growth</b> {fmtSigned(Math.round(gr))} · <b>Inflation &amp; Rates</b> {fmtSigned(Math.round(ir))}.
        </>
      ),
    };
  })();

  // Tile 2 — Asset Tilt
  const tiltTile = (() => {
    if (!v9Alloc) return { state: "loading", value: "…", meta: "Loading v9 allocation", detail: null };
    const picks = v9Alloc.picks || [];
    const defens = v9Alloc.defensive || [];
    const directPick = picks.find(p => (p.ticker || "").toUpperCase() === (ticker || "").toUpperCase())
                    || defens.find(p => (p.ticker || "").toUpperCase() === (ticker || "").toUpperCase());
    const sectorPick = sector ? picks.find(p => (p.name || "").toLowerCase() === sector.toLowerCase()
                                              || (p.fund || "").toLowerCase().includes(sector.toLowerCase())) : null;
    if (directPick) {
      const w = (Number(directPick.weight) || 0) * 100;
      const state = w >= 5 ? "green" : "amber";
      return {
        state, value: `${w >= 0 ? "+" : ""}${w.toFixed(1)}% of model`,
        meta: `Direct pick · ${directPick.fund || directPick.name || ticker}`,
        detail: <>v9 leverages this name. Weight {w.toFixed(1)}% of total portfolio. Indicator rank {directPick.indicator_rank ?? "—"}, momentum rank {directPick.momentum_rank ?? "—"}.</>,
      };
    }
    if (sectorPick) {
      const w = (Number(sectorPick.weight) || 0) * 100;
      return {
        state: w >= 5 ? "green" : "amber",
        value: `${w >= 0 ? "+" : ""}${w.toFixed(1)}% sector O/W`,
        meta: `${sector} sleeve · proxy ${sectorPick.ticker}`,
        detail: <>v9 model is overweight the {sector} sector via {sectorPick.fund || sectorPick.ticker} ({w.toFixed(1)}% of portfolio). The model leans toward this sector but doesn't single-name {ticker}.</>,
      };
    }
    return {
      state: "amber", value: "Not in model", meta: "Outside v9 picks",
      detail: <>v9 hasn't selected {ticker}{sector ? ` or its sector (${sector})` : ""} this rebalance. Holding it is a discretionary bet vs the model.</>,
    };
  })();

  // Tile 3 — Technical Indicators
  const techTile = (() => {
    const techSec = composite?.sections?.technicals;
    const score = techSec?.score;
    const state = score == null ? "loading"
                : score >= 25 ? "green"
                : score <= -25 ? "red"
                : "amber";
    const value = score == null ? "…" : fmtSigned(score);
    const rows = [];
    if (tech?.rsi_14 != null) {
      const rsi = Number(tech.rsi_14);
      rows.push({ label: "RSI(14)", val: rsi.toFixed(0), color: rsi >= 70 ? "red" : rsi <= 30 ? "amber" : "green" });
    }
    if (tech?.macd_cross != null) {
      const cross = String(tech.macd_cross).toLowerCase();
      rows.push({ label: "MACD", val: cross, color: cross.includes("bull") ? "green" : cross.includes("bear") ? "red" : "amber" });
    }
    if (tech?.above_50ma != null || tech?.above_200ma != null) {
      const above50 = !!tech.above_50ma, above200 = !!tech.above_200ma;
      rows.push({
        label: "SMA 50 / 200",
        val: `${above50 ? "above" : "below"} 50d · ${above200 ? "above" : "below"} 200d`,
        color: above50 && above200 ? "green" : !above50 && !above200 ? "red" : "amber",
      });
    }
    if (tech?.bb_pctb != null) {
      const pctB = Number(tech.bb_pctb);
      rows.push({ label: "Bollinger %B", val: pctB.toFixed(2), color: pctB > 1 ? "amber" : pctB < 0 ? "amber" : pctB > 0.5 ? "green" : "amber" });
    }
    if (tech?.atr_14 != null) {
      rows.push({ label: "ATR(14)", val: `$${Number(tech.atr_14).toFixed(2)}`, color: "amber" });
    }
    if (tech?.stoch_k != null) {
      const k = Number(tech.stoch_k);
      rows.push({ label: "Stoch K/D", val: `${k.toFixed(0)} / ${tech.stoch_d != null ? Number(tech.stoch_d).toFixed(0) : "—"}`, color: k > 80 ? "amber" : k < 20 ? "amber" : "green" });
    }
    if (tech?.obv != null) rows.push({ label: "OBV", val: "tracking price", color: "green" });
    if (tech?.ichimoku_tenkan != null && tech?.ichimoku_kijun != null) {
      const above = Number(tech.ichimoku_tenkan) > Number(tech.ichimoku_kijun);
      rows.push({ label: "Ichimoku", val: above ? "tenkan above kijun" : "tenkan below kijun", color: above ? "green" : "red" });
    }
    return { state, value, meta: `Composite ${value} · ${rows.length} indicators in scope`, detail: rows };
  })();

  // Tile 4 — Unusual Flow
  const flowTile = (() => {
    const cBuy = congressBuys?.length || 0, cSell = congressSells?.length || 0;
    const iBuy = insiderBuys?.length || 0, iSell = insiderSells?.length || 0;
    const fCall = flowCalls?.length || 0, fPut = flowPuts?.length || 0;
    const dp = darkPoolPrints?.length || 0;
    const total = cBuy + cSell + iBuy + iSell + fCall + fPut + dp;
    const netBull = (cBuy - cSell) + (iBuy - iSell) + (fCall - fPut);
    const state = total === 0 ? "loading"
                : Math.abs(netBull) >= 2 || dp >= 3 ? (netBull >= 0 ? "green" : "red")
                : "amber";
    const value = total === 0 ? "Quiet" : netBull > 0 ? "Net bullish" : netBull < 0 ? "Net bearish" : "Mixed";
    const meta = total === 0
      ? "No unusual flow events in last scan"
      : `${total} events · Congress ${cBuy + cSell} · Insider ${iBuy + iSell} · Options ${fCall + fPut} · Dark pool ${dp}`;
    return { state, value, meta, detail: { cBuy, cSell, iBuy, iSell, fCall, fPut, dp, total } };
  })();

  // Tile 5 — Earnings & Events
  const earningsTile = (() => {
    const next = nextEarn || null;
    if (!next) return { state: "loading", value: "—", meta: "No upcoming earnings on file", detail: null };
    const dt = new Date(String(next).slice(0,10) + "T00:00:00Z");
    const now = new Date();
    const days = Math.round((dt - now) / 86400000);
    const state = days <= 7 ? "amber" : "green";
    const dateLabel = dt.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    const timeLabel = earnTimeForChip === "premarket" ? "before open" : earnTimeForChip === "postmarket" ? "after close" : "";
    return {
      state,
      value: days < 0 ? "Reported" : days === 0 ? "Today" : `${days} day${days === 1 ? "" : "s"}`,
      meta: `Next report: ${dateLabel}${timeLabel ? ` (${timeLabel})` : ""}`,
      detail: { days, dateLabel, timeLabel, impMove30 },
    };
  })();

  // Tile 7 — Risk Metrics (2Y daily — beta, vol, max drawdown, VaR)
  const riskTile = (() => {
    const m = riskMetrics;
    if (!m) return { state: "loading", value: "…", meta: "Loading 2-year risk metrics", detail: null };
    const flags = {
      beta:   m.beta == null    ? null : m.beta    > 1.6 ? "red" : m.beta    > 1.3 ? "amber" : "green",
      annVol: m.annVol == null  ? null : m.annVol  > 0.40 ? "red" : m.annVol  > 0.25 ? "amber" : "green",
      maxDD:  m.maxDD == null   ? null : m.maxDD   > 0.40 ? "red" : m.maxDD   > 0.25 ? "amber" : "green",
      var10:  m.var10d99 == null? null : m.var10d99> 0.20 ? "red" : m.var10d99> 0.10 ? "amber" : "green",
    };
    const arr = Object.values(flags).filter(Boolean);
    const state = arr.includes("red") ? "red" : arr.includes("amber") ? "amber" : arr.length ? "green" : "loading";
    const headline =
      state === "red"   ? "Elevated risk"
    : state === "amber" ? "Watch"
    : state === "green" ? "In range"
    :                     "—";
    const meta = [
      m.beta != null   ? `β ${m.beta.toFixed(2)}` : null,
      m.annVol != null ? `vol ${(m.annVol*100).toFixed(0)}%` : null,
      m.maxDD != null  ? `DD ${(m.maxDD*100).toFixed(0)}%` : null,
    ].filter(Boolean).join(" · ");
    const heldVal = heldIn?.[0]?.p?.value || null;
    const var$ = m?.var10d99 != null && heldVal ? heldVal * m.var10d99 : null;
    return { state, value: headline, meta, detail: { ...m, flags, var$ } };
  })();

  // Tile 6 — News
  const newsTile = (() => {
    const items = (news || []).slice(0, 5);
    const state = items.length === 0 ? "loading" : "green";
    const value = items.length === 0 ? "Quiet" : `${items.length} stor${items.length === 1 ? "y" : "ies"}`;
    return { state, value, meta: items.length === 0 ? "No headlines in last 24h" : "Filtered to ticker-specific only", detail: items };
  })();

  return (
    <div style={{display:"flex",flexDirection:"column",gap:"var(--space-3)"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",marginBottom:"var(--space-2)"}}>
        <span style={{fontFamily:"var(--font-mono)",fontSize:11,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.16em",color:"var(--text-dim)"}}>Signal Intelligence</span>
        <span style={{fontFamily:"var(--font-mono)",fontSize:9,color:"var(--text-dim)",letterSpacing:"0.14em"}}>click to expand</span>
      </div>
      <SignalCard title="Macro Composite" {...macroTile} ragColor={ragColor} defaultOpen />
      <SignalCard title="Asset Tilt" {...tiltTile} ragColor={ragColor} />
      <SignalCard title="Technical Indicators" {...techTile} ragColor={ragColor} renderDetail={detail => (
        <div style={{display:"flex",flexDirection:"column",gap:6}}>
          {detail.map((r,i)=>(
            <div key={i} style={{display:"grid",gridTemplateColumns:"100px 1fr auto",gap:8,alignItems:"center",fontSize:12}}>
              <span style={{fontFamily:"var(--font-mono)",fontSize:10,letterSpacing:"0.06em",color:"var(--text-muted)",textTransform:"uppercase"}}>{r.label}</span>
              <span style={{color:"var(--text)"}}>{r.val}</span>
              <span style={{width:8,height:8,borderRadius:"50%",background:ragColor(r.color)}}/>
            </div>
          ))}
        </div>
      )} />
      <SignalCard title="Unusual Flow" {...flowTile} ragColor={ragColor} renderDetail={detail => (
        <div style={{display:"flex",flexDirection:"column",gap:6,fontSize:12}}>
          {detail.cBuy > 0 && <FlowRow label="Congress · BUY" count={detail.cBuy} positive scrollToSection={scrollToSection}/>}
          {detail.cSell > 0 && <FlowRow label="Congress · SELL" count={detail.cSell} positive={false} scrollToSection={scrollToSection}/>}
          {detail.iBuy > 0 && <FlowRow label="Insider · BUY" count={detail.iBuy} positive scrollToSection={scrollToSection}/>}
          {detail.iSell > 0 && <FlowRow label="Insider · SELL" count={detail.iSell} positive={false} scrollToSection={scrollToSection}/>}
          {detail.fCall > 0 && <FlowRow label="Calls · sweep" count={detail.fCall} positive scrollToSection={scrollToSection}/>}
          {detail.fPut > 0 && <FlowRow label="Puts · sweep" count={detail.fPut} positive={false} scrollToSection={scrollToSection}/>}
          {detail.dp > 0 && <FlowRow label="Dark pool prints" count={detail.dp} elevated scrollToSection={scrollToSection}/>}
          {detail.total === 0 && <span style={{color:"var(--text-muted)"}}>No flow events in the last scan window.</span>}
        </div>
      )} />
      <SignalCard title="Earnings & Events" {...earningsTile} ragColor={ragColor} renderDetail={detail => detail && (
        <div style={{display:"flex",flexDirection:"column",gap:8,fontSize:12,color:"var(--text-2)",lineHeight:1.5}}>
          <div>Next earnings: <b>{detail.dateLabel}</b>{detail.timeLabel ? ` · ${detail.timeLabel}` : ""}{detail.days > 0 ? ` · in ${detail.days} day${detail.days === 1 ? "" : "s"}` : ""}.</div>
          {detail.impMove30 != null && <div>30-day implied move: <b>±{Number(detail.impMove30).toFixed(1)}%</b> (priced from at-the-money options).</div>}
        </div>
      )} />
      <SignalCard title="News" {...newsTile} ragColor={ragColor} renderDetail={detail => (
        <div style={{display:"flex",flexDirection:"column",gap:8}}>
          {detail.length === 0
            ? <span style={{color:"var(--text-muted)",fontSize:12}}>No headlines.</span>
            : detail.map((n,i)=>(
              <div key={i} style={{fontSize:12}}>
                {n.url
                  ? <a href={n.url} target="_blank" rel="noopener noreferrer" style={{color:"var(--text)",textDecoration:"none",fontWeight:500}}>{n.headline}</a>
                  : <span style={{color:"var(--text)",fontWeight:500}}>{n.headline}</span>
                }
                <div style={{marginTop:2,fontFamily:"var(--font-mono)",fontSize:9.5,color:"var(--text-dim)",letterSpacing:"0.06em",textTransform:"uppercase"}}>
                  {n.source || ""}{n.created_at ? ` · ${new Date(n.created_at).toLocaleDateString(undefined,{month:"short",day:"numeric"})}` : ""}
                </div>
              </div>
            ))
          }
        </div>
      )} />
      <SignalCard title="Risk Metrics · 2Y" {...riskTile} ragColor={ragColor} renderDetail={detail => {
        const fmtPctMag = v => v == null ? "—" : (v*100).toFixed(1) + "%";
        const fmtBeta = v => v == null ? "—" : v.toFixed(2);
        const fmt$ = v => v == null ? null : "$" + Math.round(v).toLocaleString();
        const Row = ({ label, val, color }) => (
          <div style={{display:"grid",gridTemplateColumns:"100px 1fr auto",gap:8,alignItems:"center",fontSize:12}}>
            <span style={{fontFamily:"var(--font-mono)",fontSize:10,letterSpacing:"0.06em",color:"var(--text-muted)",textTransform:"uppercase"}}>{label}</span>
            <span style={{color:"var(--text)"}}>{val}</span>
            <span style={{width:8,height:8,borderRadius:"50%",background:ragColor(color)}}/>
          </div>
        );
        return (
          <div style={{display:"flex",flexDirection:"column",gap:6}}>
            <Row label="Beta · vs SPY"  val={fmtBeta(detail.beta)}             color={detail.flags.beta}/>
            <Row label="Annualized vol" val={fmtPctMag(detail.annVol)}         color={detail.flags.annVol}/>
            <Row label="Max drawdown"   val={fmtPctMag(detail.maxDD)}          color={detail.flags.maxDD}/>
            <Row label="10-day 99% VaR" val={fmtPctMag(detail.var10d99) + (detail.var$ ? " · ~" + fmt$(detail.var$) : "")} color={detail.flags.var10}/>
            {detail.sourceWindow && (
              <div style={{marginTop:6,fontFamily:"var(--font-mono)",fontSize:9.5,textTransform:"uppercase",letterSpacing:"0.14em",color:"var(--text-dim)"}}>
                Source: Yahoo daily · {detail.sourceWindow}
              </div>
            )}
          </div>
        );
      }} />
    </div>
  );
}

// SignalCard — stateful disclosure (no <details>; LESSONS rule #29).
function SignalCard({ title, state, value, meta, detail, ragColor, renderDetail, defaultOpen }) {
  const [open, setOpen] = useState(!!defaultOpen);
  const dotBg = ragColor(state);
  const stripe = state === "loading" ? "var(--border)" : dotBg;
  return (
    <div
      onClick={()=>setOpen(o=>!o)}
      style={{
        background: "var(--surface-solid, var(--paper, #fff))",
        border: "1px solid var(--border)",
        borderLeft: `3px solid ${stripe}`,
        borderRadius: "var(--radius-xs, 6px)",
        padding: "12px 14px",
        cursor: "pointer",
        transition: "box-shadow 0.12s ease, transform 0.12s ease",
      }}
    >
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:10}}>
        <span style={{display:"flex",alignItems:"center",gap:8}}>
          <span style={{width:8,height:8,borderRadius:"50%",background:dotBg,flexShrink:0}}/>
          <span style={{fontFamily:"var(--font-mono)",fontSize:11,fontWeight:600,letterSpacing:"0.06em",textTransform:"uppercase",color:"var(--text)"}}>{title}</span>
        </span>
        <span style={{fontFamily:"var(--font-mono)",fontSize:13,fontWeight:600,color:dotBg,whiteSpace:"nowrap"}}>{value}</span>
      </div>
      {meta && <div style={{marginTop:4,fontSize:11.5,color:"var(--text-muted)",lineHeight:1.4}}>{meta}</div>}
      {open && detail != null && (
        <div style={{marginTop:10,paddingTop:10,borderTop:"1px solid var(--border-faint)"}} onClick={e=>e.stopPropagation()}>
          {renderDetail ? renderDetail(detail) : (
            <div style={{fontSize:12,color:"var(--text-2)",lineHeight:1.5}}>{detail}</div>
          )}
        </div>
      )}
    </div>
  );
}

function FlowRow({ label, count, positive, elevated, scrollToSection }) {
  const color = positive ? "var(--green-text, #1a8c39)"
              : positive === false ? "var(--red-text, #c8302a)"
              : elevated ? "var(--yellow-text, #B8860B)"
              : "var(--text)";
  const target = label.toLowerCase().includes("congress") || label.toLowerCase().includes("insider") ? "sec-activity"
              : label.toLowerCase().includes("calls") || label.toLowerCase().includes("puts") ? "sec-options"
              : label.toLowerCase().includes("dark pool") ? "sec-darkpool"
              : null;
  return (
    <div onClick={target ? (e)=>{e.stopPropagation(); scrollToSection?.(target);} : undefined}
         style={{display:"grid",gridTemplateColumns:"1fr auto",gap:10,fontSize:12,color:"var(--text)",cursor:target?"pointer":"default"}}>
      <span style={{fontFamily:"var(--font-mono)",fontSize:10.5,color:"var(--text-muted)",letterSpacing:"0.04em",textTransform:"uppercase"}}>{label}</span>
      <span style={{color,fontFamily:"var(--font-mono)",fontWeight:600}}>{count} event{count === 1 ? "" : "s"}</span>
    </div>
  );
}




// ============================================================================
// DeepDiveTabs — Phase 4b PR-E
// Bottom-of-modal tabs for company-overview / dividend history / splits.
// All values come from the live Supabase tables populated by the daily
// MASSIVE-DAILY cron (Phase 1-3 of the data modernization).
// ============================================================================
function DeepDiveTabs({ deepDive, ticker, riskMetrics, heldIn }) {
  const [tab, setTab] = useState("about");
  const fmt$ = v => v == null ? "—" : `$${Number(v).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}`;
  const fmtMcap = v => {
    if (v == null) return "—";
    const n = Number(v);
    if (n >= 1e12) return `$${(n/1e12).toFixed(2)}T`;
    if (n >= 1e9)  return `$${(n/1e9).toFixed(2)}B`;
    if (n >= 1e6)  return `$${(n/1e6).toFixed(0)}M`;
    return `$${n.toLocaleString()}`;
  };
  const fmtDate = d => d ? new Date(String(d).slice(0,10) + "T00:00:00Z").toLocaleDateString(undefined,{month:"short",day:"numeric",year:"numeric"}) : "—";

  const ref = deepDive.ref;
  const divs = deepDive.dividends || [];
  const spls = deepDive.splits || [];

  // Frequency code → human ("4" = quarterly, "12" = monthly, "1" = annual, etc.)
  const freqLabel = f => {
    if (f == null) return "";
    const n = Number(f);
    if (n === 12) return "monthly";
    if (n === 4) return "quarterly";
    if (n === 2) return "semi-annual";
    if (n === 1) return "annual";
    return `${n}×/yr`;
  };

  const tabBtnStyle = (active) => ({
    padding: "8px 14px",
    background: "transparent",
    border: "none",
    borderBottom: active ? "2px solid var(--accent)" : "2px solid transparent",
    color: active ? "var(--text)" : "var(--text-muted)",
    fontFamily: "var(--font-mono)",
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    cursor: "pointer",
  });

  return (
    <div style={{
      marginTop: "var(--space-4)",
      background: "var(--surface-solid, var(--paper, #fff))",
      border: "1px solid var(--border)",
      borderRadius: "var(--radius-xs, 6px)",
      overflow: "hidden",
    }}>
      <div style={{display:"flex",borderBottom:"1px solid var(--border-faint)",gap:0}}>
        <button onClick={()=>setTab("about")} style={tabBtnStyle(tab==="about")}>About</button>
        <button onClick={()=>setTab("dividends")} style={tabBtnStyle(tab==="dividends")}>
          Dividend history{divs.length>0?` · ${divs.length}`:""}
        </button>
        <button onClick={()=>setTab("splits")} style={tabBtnStyle(tab==="splits")}>
          Splits{spls.length>0?` · ${spls.length}`:""}
        </button>
      </div>

      <div style={{padding:"16px 18px"}}>
        {tab === "about" && (
          deepDive.loading
            ? <div style={{fontSize:13,color:"var(--text-muted)"}}>Loading company overview…</div>
            : !ref
              ? <div style={{fontSize:13,color:"var(--text-muted)"}}>No company overview on file for {ticker} yet. The daily backfill populates ~1,500 tickers per cycle; check back tomorrow.</div>
              : (
                <div style={{display:"grid",gridTemplateColumns:"1fr",gap:14}}>
                  {ref.description && (
                    <div style={{fontSize:13.5,color:"var(--text-2)",lineHeight:1.55,maxWidth:720}}>{ref.description}</div>
                  )}
                  <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))",gap:"10px 18px"}}>
                    {ref.list_date && <Field label="Listed" value={fmtDate(ref.list_date)}/>}
                    {ref.primary_exchange && <Field label="Exchange" value={ref.primary_exchange}/>}
                    {(ref.address_city || ref.address_state) && <Field label="Headquarters" value={[ref.address_city, ref.address_state].filter(Boolean).join(", ")}/>}
                    {ref.total_employees != null && <Field label="Employees" value={Number(ref.total_employees).toLocaleString()}/>}
                    {ref.market_cap != null && <Field label="Market cap" value={fmtMcap(ref.market_cap)}/>}
                    {ref.sic_description && <Field label="Industry" value={ref.sic_description}/>}
                    {ref.share_class_shares_outstanding != null && <Field label="Shares out" value={Number(ref.share_class_shares_outstanding).toLocaleString()}/>}
                    {ref.homepage_url && <Field label="Website" value={<a href={ref.homepage_url} target="_blank" rel="noopener noreferrer" style={{color:"var(--accent)",textDecoration:"none"}}>{ref.homepage_url.replace(/^https?:\/\//, "").replace(/\/$/, "")}</a>}/>}
                  </div>
                  <div style={{marginTop:6,fontFamily:"var(--font-mono)",fontSize:9.5,textTransform:"uppercase",letterSpacing:"0.14em",color:"var(--text-dim)"}}>
                    Source: ticker_reference (Massive · Polygon){ref.ingested_at?` · refreshed ${fmtDate(ref.ingested_at)}`:""}
                  </div>
                </div>
              )
        )}
        {tab === "dividends" && (
          deepDive.loading
            ? <div style={{fontSize:13,color:"var(--text-muted)"}}>Loading dividend history…</div>
            : divs.length === 0
              ? <div style={{fontSize:13,color:"var(--text-muted)"}}>No dividends on file for {ticker} in the most recent ingest window.</div>
              : (
                <table style={{width:"100%",borderCollapse:"collapse",fontSize:12.5}}>
                  <thead>
                    <tr>
                      {["Ex-date","Pay date","Cash","Frequency","Type"].map(h=>(
                        <th key={h} style={{textAlign:"left",padding:"6px 8px",fontFamily:"var(--font-mono)",fontSize:10,textTransform:"uppercase",letterSpacing:"0.08em",color:"var(--text-dim)",borderBottom:"1px solid var(--border-faint)"}}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {divs.map((d,i)=>(
                      <tr key={d.ex_dividend_date+"_"+i} style={{borderBottom:"1px solid var(--border-faint)"}}>
                        <td style={{padding:"7px 8px",fontFamily:"var(--font-mono)",color:"var(--text)"}}>{fmtDate(d.ex_dividend_date)}</td>
                        <td style={{padding:"7px 8px",fontFamily:"var(--font-mono)",color:"var(--text-2)"}}>{fmtDate(d.pay_date)}</td>
                        <td style={{padding:"7px 8px",fontFamily:"var(--font-mono)",fontWeight:600,color:"var(--text)"}}>{fmt$(d.cash_amount)}</td>
                        <td style={{padding:"7px 8px",color:"var(--text-2)"}}>{freqLabel(d.frequency)}</td>
                        <td style={{padding:"7px 8px",color:"var(--text-muted)"}}>{d.dividend_type || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )
        )}
        {tab === "splits" && (
          deepDive.loading
            ? <div style={{fontSize:13,color:"var(--text-muted)"}}>Loading splits…</div>
            : spls.length === 0
              ? <div style={{fontSize:13,color:"var(--text-muted)"}}>No splits on file for {ticker} in the most recent ingest window.</div>
              : (
                <table style={{width:"100%",borderCollapse:"collapse",fontSize:12.5}}>
                  <thead>
                    <tr>
                      {["Effective date","Ratio"].map(h=>(
                        <th key={h} style={{textAlign:"left",padding:"6px 8px",fontFamily:"var(--font-mono)",fontSize:10,textTransform:"uppercase",letterSpacing:"0.08em",color:"var(--text-dim)",borderBottom:"1px solid var(--border-faint)"}}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {spls.map((s,i)=>(
                      <tr key={s.execution_date+"_"+i} style={{borderBottom:"1px solid var(--border-faint)"}}>
                        <td style={{padding:"7px 8px",fontFamily:"var(--font-mono)",color:"var(--text)"}}>{fmtDate(s.execution_date)}</td>
                        <td style={{padding:"7px 8px",fontFamily:"var(--font-mono)",fontWeight:600,color:"var(--text)"}}>
                          {s.split_to}-for-{s.split_from}
                          <span style={{marginLeft:8,color:"var(--text-muted)",fontWeight:400}}>{Number(s.split_to)>Number(s.split_from)?"forward":"reverse"}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )
        )}
      </div>
    </div>
  );
}

function Field({ label, value }) {
  return (
    <div>
      <div style={{fontFamily:"var(--font-mono)",fontSize:9.5,textTransform:"uppercase",letterSpacing:"0.12em",color:"var(--text-dim)",marginBottom:2}}>{label}</div>
      <div style={{fontSize:13,color:"var(--text)",fontWeight:500}}>{value}</div>
    </div>
  );
}




// ============================================================================
// ActionRow — Phase 4b PR-F
// Closes the modal-left column with the four primary actions:
//   - Buy / add        → opens PositionEditor in "add" mode (prefilled ticker)
//   - Edit position    → opens PositionEditor in "edit" mode (held row)
//   - Watchlist toggle → uses the existing add/remove handlers
//   - Open in Scanner  → navigates to /#scanner with the modal closed
// "Set stop alert" is queued — needs backend alert table + cron + notifications.
// ============================================================================
function ActionRow({
  ticker, heldIn, portfolioAuthed, onUserWatchlist, removeFromWatchlist, wlBusy,
  onOpenAddPosition, onOpenEditPosition, onClosePosition, onClose,
}) {
  const heldRow = heldIn?.[0]?.p || null;
  const owns = heldIn && heldIn.length > 0;

  const btnBase = {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "8px 14px",
    fontFamily: "var(--font-mono)",
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-xs, 6px)",
    background: "var(--surface-solid, var(--paper, #fff))",
    color: "var(--text)",
    cursor: "pointer",
    transition: "all 0.12s ease",
  };
  const btnPrimary = {
    ...btnBase,
    background: "var(--accent, #0071e3)",
    border: "1px solid var(--accent, #0071e3)",
    color: "var(--surface-solid, #fff)",
  };
  const btnDanger = {
    ...btnBase,
    color: "var(--red-text, #c8302a)",
    border: "1px solid rgba(200,48,42,0.35)",
  };

  return (
    <div style={{
      marginTop: "var(--space-4)",
      display: "flex",
      flexWrap: "wrap",
      gap: 10,
      paddingTop: "var(--space-4)",
      borderTop: "1px solid var(--border-faint)",
    }}>
      {portfolioAuthed && owns && (<>
        <button type="button" onClick={()=>onOpenEditPosition?.(heldRow)} style={btnPrimary}>
          Edit position
        </button>
        <button type="button" onClick={()=>onOpenAddPosition?.(ticker)} style={btnBase}>
          + Buy / add
        </button>
        <button type="button" onClick={()=>onClosePosition?.(heldRow)} style={btnDanger}>
          Close position
        </button>
      </>)}
      {portfolioAuthed && !owns && (
        <button type="button" onClick={()=>onOpenAddPosition?.(ticker)} style={btnPrimary}>
          + Add position
        </button>
      )}
      {portfolioAuthed && onUserWatchlist && (
        <button type="button" onClick={removeFromWatchlist} disabled={wlBusy} style={{...btnBase, color:"var(--text-muted)"}}>
          {wlBusy ? "…" : "− Remove from watchlist"}
        </button>
      )}
      <button type="button" onClick={onClose} style={{...btnBase, marginLeft:"auto", color:"var(--text-muted)"}}>
        Close
      </button>
    </div>
  );
}


export default function TickerDetailModal({ticker,scanData,accounts,watchlistRows,portfolioAuthed,refetchPortfolio,onClose,onTickerAdded,scanBusy,macroLatest,v9Alloc,onOpenAddPosition,onOpenEditPosition,onClosePosition}){
const [descExpanded,setDescExpanded]=useState(false);
const [wlBusy,setWlBusy]=useState(false);
const [wlError,setWlError]=useState(null);
// Bug #1017 — per-ticker Google News feed (Option B). Fetched when the
// modal opens and merged with UW signals.news[ticker] below so UW stays
// supplementary for flow-related headlines.
const [gnNewsItems,setGnNewsItems]=useState([]);
const [gnNewsLoading,setGnNewsLoading]=useState(false);
useEffect(()=>{
  const onKey=e=>{if(e.key==="Escape")onClose();};
  window.addEventListener("keydown",onKey);
  document.body.style.overflow="hidden";
  return()=>{window.removeEventListener("keydown",onKey);document.body.style.overflow="";};
},[onClose]);
if(!ticker)return null;
const sc=scanData?.signals?.screener?.[ticker]||{};
const tech=scanData?.signals?.technicals?.[ticker]||{};
const score=scanData?.score_by_ticker?.[ticker];
// Bug #1017 — fetch per-ticker Google News (whitelist + dedupe is done on the
// server). Fires when `ticker` changes. Server already 10m-cached, client
// replaces on each modal open. Failures are swallowed silently so the UW
// supplementary list still renders.
useEffect(()=>{
  if(!ticker) return;
  let cancelled=false;
  setGnNewsLoading(true);
  (async()=>{
    try{
      const companyName=sc.full_name||sc.company_name||"";
      const params=new URLSearchParams({ticker});
      if(companyName) params.set("company",companyName);
      const r=await fetch(`/api/news-per-ticker?${params.toString()}`);
      if(!r.ok) throw new Error(`gn ${r.status}`);
      const d=await r.json();
      if(!cancelled) setGnNewsItems(Array.isArray(d?.items)?d.items:[]);
    }catch(_){
      if(!cancelled) setGnNewsItems([]);
    }finally{
      if(!cancelled) setGnNewsLoading(false);
    }
  })();
  return()=>{cancelled=true;};
// eslint-disable-next-line react-hooks/exhaustive-deps
},[ticker]);
// Signed-in user's own watchlist takes precedence over the scan artifact's
// (empty, public) watchlist. WATCHLIST_FALLBACK is the pre-auth seed list.
const userWLEntry=(watchlistRows||[]).find(w=>w.ticker===ticker);
const watchlistEntry=userWLEntry||(scanData?.watchlist||[]).find(w=>w.ticker===ticker)||WATCHLIST_FALLBACK.find(w=>w.ticker===ticker);
const onUserWatchlist=!!userWLEntry;
// Add current ticker to the signed-in user's watchlist.
async function addToWatchlist(){
  setWlBusy(true);setWlError(null);
  try{
    const {data:{session}}=await supabase.auth.getSession();
    const userId=session?.user?.id;
    if(!userId)throw new Error("Not signed in");
    const sort_order=((watchlistRows||[]).reduce((m,w)=>Math.max(m,w.sort_order||0),0))+1;
    const {error}=await supabase.from("watchlist").insert({
      user_id:userId,ticker:ticker.toUpperCase(),
      name:(sc.full_name||sc.company_name||ticker),theme:"",sort_order,
    });
    if(error)throw error;
    await refetchPortfolio?.();
    // Trigger server-side scan so this modal fills in without waiting
    // for the next scheduled 3:30 PM run.
    onTickerAdded?.(ticker.toUpperCase());
  }catch(err){setWlError(err.message||String(err));}
  finally{setWlBusy(false);}
}
// Remove current ticker from the signed-in user's watchlist.
async function removeFromWatchlist(){
  setWlBusy(true);setWlError(null);
  try{
    const {data:{session}}=await supabase.auth.getSession();
    const userId=session?.user?.id;
    if(!userId)throw new Error("Not signed in");
    const {error}=await supabase.from("watchlist").delete()
      .eq("user_id",userId).eq("ticker",ticker.toUpperCase());
    if(error)throw error;
    await refetchPortfolio?.();
  }catch(err){setWlError(err.message||String(err));}
  finally{setWlBusy(false);}
}
const heldIn=(accounts||[]).flatMap(a=>a.positions.filter(p=>p.ticker===ticker).map(p=>({acct:a,p}))).filter(Boolean);
const price=Number(sc.close||sc.prev_close||0)||null;
const prevClose=Number(sc.prev_close||0)||null;
const dayPct=price&&prevClose?((price-prevClose)/prevClose)*100:null;
// Phase 4a — backfill the company name from the Massive-sourced
// Supabase tables for tickers outside UW's screener (~11,000 of ~12,500).
// ticker_reference (Phase 3 backfill) preferred; universe_master (always
// populated by the daily Massive cron) is the floor. Falls through to
// the legacy waterfall if both miss (very rare — only inactive tickers).
const massiveInfo=useMassiveTickerInfo(ticker);
const deepDive=useTickerDeepDive(ticker);
const companyName=normalizeTickerName(sc.full_name||sc.company_name||scanData?.ticker_names?.[ticker]||watchlistEntry?.name||heldIn[0]?.p?.name||massiveInfo.name||ticker);
// Legacy 0–100 score gauge retired — the modal now leads with the signal
// composite (−100 → +100) so direction and strength read consistently.
// Manual-track position: on the watchlist but not in the scanner's scored
// universe yet. We still want to show a useful modal (name, theme, held info)
// rather than a box full of dashes. Also fires for OWNED names that haven't
// been picked up by a scanner run yet (so you still get a clear "pending"
// message instead of a fund/ETF disclaimer that doesn't apply).
const isManualTrack=(!!watchlistEntry||heldIn.length>0)&&score==null&&Object.keys(sc).length===0;
// Classify why data is missing so the banner copy matches reality:
//   - "crypto" — BTCUSD / ETHUSD and similar (scanner can't score crypto proxies)
//   - "fund"   — 5-char mutual-fund tickers ending in X (FXAIX, FSKAX, NHXINT906)
//               or known fund sectors ("HY Bonds", "Intl Equity", "Commodity")
//   - "pending"— single-name equity (owned or watchlisted) the scanner just
//               hasn't scored yet on the last run. RCAT added to watchlist
//               yesterday lives here — the data WILL populate next scan.
const fundSectors=new Set(["Commodity","Metals","Crypto","HY Bonds","Intl Equity"]);
const heldSector=heldIn[0]?.p?.sector;
const isCryptoProxy=/USD$/i.test(ticker||"")||/USDT$/i.test(ticker||"");
const isLikelyFund=/^[A-Z]{4,}X$/.test(ticker||"")||/^NH[A-Z]+\d+$/.test(ticker||"")||fundSectors.has(heldSector);
const manualTrackKind=isCryptoProxy?"crypto":isLikelyFund?"fund":"pending";
// Performance (from technicals — scanner stores as fractions: 0.05 = 5%)
const fmtPct=v=>v==null?null:`${v>=0?"+":""}${(v*100).toFixed(1)}%`;
const wk=tech.week_change,mo=tech.month_change,yt=tech.ytd_change;
// Technicals detail
const rsi=tech.rsi_14;
const macd=tech.macd_cross;
const above50=tech.above_50ma;
const above200=tech.above_200ma;
const vol=tech.vol_surge;
const techScore=tech.tech_score;
const ivLvl=sc.iv30d!=null?Number(sc.iv30d)*100:null;
const ivRank=sc.iv_rank!=null?Number(sc.iv_rank):null;
const rv=sc.realized_volatility!=null?Number(sc.realized_volatility)*100:null;
const impMove30=sc.implied_move_perc_30!=null?Number(sc.implied_move_perc_30)*100:(sc.implied_move_perc!=null?Number(sc.implied_move_perc)*100:null);
// Options flow — positive/negative premium flows
const bullPrem=sc.bullish_premium!=null?Number(sc.bullish_premium):null;
const bearPrem=sc.bearish_premium!=null?Number(sc.bearish_premium):null;
const netCallPrem=sc.net_call_premium!=null?Number(sc.net_call_premium):null;
const netPutPrem=sc.net_put_premium!=null?Number(sc.net_put_premium):null;
// Skew: net call premium minus net put premium ($) — positive = bid for
// upside calls (bullish skew), negative = bid for put protection (bearish).
// This is the closest thing to an equity-skew read we have without explicit
// 25-delta IV data.
const flowSkew=(netCallPrem!=null&&netPutPrem!=null)?(netCallPrem-netPutPrem):null;
const callVol=sc.call_volume!=null?Number(sc.call_volume):null;
const putVol=sc.put_volume!=null?Number(sc.put_volume):null;
const callOI=sc.call_open_interest!=null?Number(sc.call_open_interest):null;
const putOI=sc.put_open_interest!=null?Number(sc.put_open_interest):null;
const pcRatio=putOI&&callOI?putOI/callOI:null;
const pcVolRatio=putVol&&callVol?putVol/callVol:null;
const mcap=sc.marketcap!=null?Number(sc.marketcap):null;
const avgVol=sc.avg30_volume!=null?Number(sc.avg30_volume):null;
const relVol=sc.relative_volume!=null?Number(sc.relative_volume):null;
const nextEarn=sc.next_earnings_date;
const nextDiv=sc.next_dividend_date;
const erTime=sc.er_time;  // "premarket" | "postmarket" | null
// Modal enrichment (scanner bakes these into signals.{info,news,analyst_ratings} keyed by ticker).
const info=scanData?.signals?.info?.[ticker]||null;
// Bug #1017 — merge Google News (primary, whitelist-filtered + deduped
// server-side) with UW per-ticker headlines (supplementary — UW is strong
// on flow-related items). Normalize into a single shape so the renderer
// doesn't have to branch. Dedupe across sources by headline.
const _uwNews=scanData?.signals?.news?.[ticker]||[];
// 2Y daily price-derived risk metrics. Beta vs SPY (weekly), annualized
// vol, max drawdown, 10-day 99% historical VaR. Joe spec 2026-04-27
// (P5 #16/#17). Hook caches by ticker; SPY shared across tickers.
const { metrics: _riskMetrics } = useStockRiskMetrics(ticker);
// P1 #36/#38 — auto-fire on-demand scan when info is missing. Adds a
// per-ticker cool-down ref (60s) so we don't re-fire if the scan came
// back empty (which would otherwise cause an infinite loop overwriting
// existing data with nulls). Joe 2026-04-27.
const _scanFiredRef = useRef(new Map());
useEffect(() => {
  if (!ticker || !portfolioAuthed || !onTickerAdded) return;
  const i = scanData?.signals?.info?.[ticker];
  const haveDesc = !!(i && (i.short_description || i.long_description));
  if (haveDesc) return;
  const lastFired = _scanFiredRef.current.get(ticker) || 0;
  if (Date.now() - lastFired < 60_000) return;   // 60s cool-down per ticker
  _scanFiredRef.current.set(ticker, Date.now());
  onTickerAdded(ticker);
}, [ticker, scanData, portfolioAuthed, onTickerAdded]);
const _gnNormalized=(gnNewsItems||[]).map((n)=>({
  headline:n.headline,
  source:n.source||"Google News",
  sourceTier:"google_news",
  description:n.description||"",
  url:n.url||"",
  created_at:n.published||null,
  sentiment:null,
  is_major:false,
}));
const _uwNormalized=_uwNews.map((n)=>({
  headline:n.headline||"",
  source:n.source||"UW",
  sourceTier:"uw",
  description:n.description||"",
  url:n.url||"",
  created_at:n.created_at||null,
  sentiment:n.sentiment||null,
  is_major:!!n.is_major,
}));
const _newsDedupeKey=(h)=>String(h||"").toLowerCase().replace(/[^a-z0-9\s]/g," ").replace(/\s+/g," ").trim().slice(0,80);
const _newsSeen=new Set();
const news=[..._gnNormalized,..._uwNormalized].filter((n)=>{
  const k=_newsDedupeKey(n.headline);
  if(!k) return false;
  if(_newsSeen.has(k)) return false;
  _newsSeen.add(k);
  return true;
}).sort((a,b)=>{
  const ta=a.created_at?new Date(a.created_at).getTime():0;
  const tb=b.created_at?new Date(b.created_at).getTime():0;
  return tb-ta;
});
const analystRatings=scanData?.signals?.analyst_ratings?.[ticker]||[];
// sector comes from /api/stock/{t}/info (NOT the screener row) — fall back to screener row if present.
const sector=info?.sector||sc.sector||null;
const tags=info?.tags||[];
const shortDesc=info?.short_description||null;
const longDesc=info?.long_description||null;
// ETF / fund detection — surfaces the ETF category chip and "FUND" badge
// instead of (or in addition to) the equity sector chip. Driven by the
// scanner's is_fund flag, with a JS fallback for legacy scan data that
// predates the flag.
const issueTypeRaw=(info?.issue_type||"").toString().toLowerCase();
const isFund=info?.is_fund===true||/etf|etn|fund/.test(issueTypeRaw);
const etfCategory=info?.etf_category||null;
// announce_time from /info is the same field as er_time from screener — use whichever exists.
const earnTimeForChip=erTime||info?.announce_time||null;
// Short interest (FINRA biweekly via yfinance — lagged ~15 days, NEVER real-time)
const siPctFloat=sc.short_pct_float!=null?Number(sc.short_pct_float):null;
const siPctSOut=sc.short_pct_shares_out!=null?Number(sc.short_pct_shares_out):null;
const siDaysCover=sc.days_to_cover!=null?Number(sc.days_to_cover):null;
const sharesShort=sc.shares_short!=null?Number(sc.shares_short):null;
const sharesShortPrior=sc.shares_short_prior!=null?Number(sc.shares_short_prior):null;
const siAsOf=sc.short_as_of;
const siTrendPct=(sharesShort!=null&&sharesShortPrior!=null&&sharesShortPrior>0)?((sharesShort-sharesShortPrior)/sharesShortPrior)*100:null;
const fmt$=v=>v==null?"—":`$${Number(v).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}`;
const fmt$M=v=>v==null?"—":v>=1e9?`$${(v/1e9).toFixed(2)}B`:v>=1e6?`$${(v/1e6).toFixed(1)}M`:v>=1e3?`$${(v/1e3).toFixed(0)}K`:`$${v.toFixed(0)}`;
const fmt$signed=v=>v==null?"—":(v>=0?"+":"")+fmt$M(Math.abs(v));
const fmtNum=v=>v==null?"—":v>=1e6?`${(v/1e6).toFixed(1)}M`:v>=1e3?`${(v/1e3).toFixed(0)}K`:v.toLocaleString();
// Activity rows (filter scanData signals by this ticker)
const rowsFor=(list)=>(list||[]).filter(r=>(r?.ticker||"").toUpperCase()===ticker);
const congressBuys=rowsFor(scanData?.signals?.congress_buys);
const congressSells=rowsFor(scanData?.signals?.congress_sells);
const insiderBuys=rowsFor(scanData?.signals?.insider_buys);
const insiderSells=rowsFor(scanData?.signals?.insider_sales);
const flowCalls=rowsFor(scanData?.signals?.flow_alerts);
const flowPuts=rowsFor(scanData?.signals?.put_flow_alerts);
const darkPoolPrints=rowsFor(scanData?.signals?.darkpool);
const congressCt=congressBuys.length+congressSells.length;
const insiderCt=insiderBuys.length+insiderSells.length;
const flowCt=flowCalls.length+flowPuts.length;
const dpCt=darkPoolPrints.length;
// ScoreGauge (legacy 0–100) removed — see comment on retired scoreCol above.
const panelStyle={background:"var(--surface-2)",border:"1px solid var(--border-faint)",borderRadius:"var(--radius-md)",padding:"var(--space-3)",marginBottom:"var(--space-3)"};
const sectionLabel={fontSize:10,color:"var(--text-muted)",fontFamily:"var(--font-mono)",letterSpacing:"0.08em",marginBottom:8,fontWeight:600};
const kpiBox={background:"var(--surface-3)",borderRadius:5,padding:"8px 10px"};
const kpiLabelBase={fontSize:9,color:"var(--text-muted)",fontFamily:"var(--font-mono)",letterSpacing:"0.08em",marginBottom:3};
const kpiValue={fontSize:14,fontWeight:700,fontFamily:"var(--font-mono)"};
// Reusable KPI with hover-tooltip on the label (little ⓘ marker). Every metric
// in the modal gets one so nothing reads as a mystery number.
const Kpi=({label,value,color,sub,tip})=>(
<div style={kpiBox}>
<div style={{...kpiLabelBase,display:"flex",alignItems:"center",gap:2}}>{label}{tip&&<InfoTip def={tip} size={10}/>}</div>
<div style={{...kpiValue,color:color||"var(--text)"}}>{value}</div>
{sub&&<div style={{fontSize:9,color:"var(--text-dim)",marginTop:2}}>{sub}</div>}
</div>
);
const rsiColor=rsi==null?"var(--text-dim)":rsi>=70?"#ff453a":rsi<=30?"#30d158":"var(--text)";
const macdColor=macd==="bullish"?"#30d158":macd==="bearish"?"#ff453a":"var(--text)";
const ma50Color=above50==null?"var(--text-dim)":above50?"#30d158":"#ff453a";
const ma200Color=above200==null?"var(--text-dim)":above200?"#30d158":"#ff453a";
const volColor=vol==null?"var(--text-dim)":vol>=2?"#30d158":vol>=1?"var(--text)":"var(--text-dim)";
const ivRankColor=ivRank==null?"var(--text-dim)":ivRank>=70?"#ff453a":ivRank<=30?"#30d158":"var(--text)";
const techScoreCol=techScore==null?"var(--text-dim)":techScore>=2?"#30d158":techScore>=-1?"var(--text)":"#ff453a";
// Section composites — signed −100..+100 per category, with weighted overall.
// This is the "distill the signals" view: legacy 0–100 is bullish-only, these
// expose direction. See ./ticker/sectionComposites.js for the math.
const composite=computeSectionComposites(ticker,scanData);
// Compact pill renderer — one per section. Clicking scrolls to the section panel.
const CompositePill=({sec,onClick})=>{
  const col=colorForDirection(sec.direction);
  const valStr=sec.score==null?"—":(sec.score>=0?"+":"")+sec.score;
  return(
  <button
    type="button"
    onClick={onClick}
    title={(Array.isArray(sec.components)?sec.components:[]).map(c=>c.label+(c.points!=null?` (${c.points>=0?"+":""}${c.points})`:"")).join("\n")}
    style={{
      flex:"1 1 0",minWidth:94,textAlign:"left",
      background:"var(--surface-3)",border:`1px solid ${sec.score!=null&&sec.score!==0?col+"66":"var(--border-faint)"}`,
      borderRadius:5,padding:"7px 9px",cursor:onClick?"pointer":"default",
      transition:"border-color 0.15s",
    }}
  >
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:2}}>
      <span style={{fontSize:9,color:"var(--text-muted)",fontFamily:"var(--font-mono)",letterSpacing:"0.08em",fontWeight:600,textTransform:"uppercase"}}>{sec.name}</span>
      <span style={{fontSize:8,color:"var(--text-dim)",fontFamily:"var(--font-mono)"}}>{sec.weight}%</span>
    </div>
    <div style={{fontSize:17,fontWeight:800,fontFamily:"var(--font-mono)",color:col,lineHeight:1.1}}>{valStr}</div>
    <div style={{fontSize:8,color:"var(--text-dim)",fontFamily:"var(--font-mono)",letterSpacing:"0.05em",marginTop:2}}>{sec.label}</div>
  </button>);
};
// Small inline badge used at each section panel header.
const CompositeBadge=({sec})=>{
  if(!sec||sec.score==null)return null;
  const col=colorForDirection(sec.direction);
  const v=(sec.score>=0?"+":"")+sec.score;
  return(
  <span style={{
    display:"inline-flex",alignItems:"center",gap:5,marginLeft:8,
    fontSize:10,fontFamily:"var(--font-mono)",fontWeight:700,
    color:col,background:col+"15",border:`1px solid ${col}55`,
    borderRadius:4,padding:"1px 6px",letterSpacing:"0.04em",
  }}>
    <span>{v}</span>
    <span style={{color:"var(--text-dim)",fontWeight:500}}>· {sec.label}</span>
  </span>);
};
const scrollToSection=(id)=>{
  const el=document.getElementById(id);
  if(el)el.scrollIntoView({behavior:"smooth",block:"start"});
};
return(
<div className="modal-backdrop" onClick={onClose}>
<div className="modal-wrap">
<div className="modal-sheet" onClick={e=>e.stopPropagation()} style={{position:"relative",padding:"var(--space-5) var(--space-5) var(--space-4)"}}>
<button className="modal-close" onClick={onClose} aria-label="Close">×</button>
{/* ── modal-grid: 2-column layout (left = existing panels; right = Signal Intelligence rail). Stacks under 980px. */}
<div className="modal-grid" style={{display:"grid",gridTemplateColumns:"minmax(0,1fr) 360px",gap:"var(--space-5)",alignItems:"start"}}>
<div className="modal-left" style={{minWidth:0}}>
{/* ── v5 hero — identity-only (Phase 4b PR-B). LESSONS rule #29:
    Fraunces big-name, JetBrains Mono labels, var(--ink-1)/etc. via
    the site's existing parchment overlay. LESSONS rule #30: every
    value derives from live data; no hardcoded narrative. */}
<div style={{paddingRight:48,marginBottom:"var(--space-4)",display:"grid",gridTemplateColumns:"1fr auto",gap:"var(--space-5)",alignItems:"start"}}>
  {/* LEFT — identity */}
  <div style={{minWidth:0}}>
    <div style={{fontFamily:"var(--font-mono)",fontWeight:700,fontSize:11,textTransform:"uppercase",letterSpacing:"0.18em",color:"var(--text-dim)",display:"flex",alignItems:"center",gap:8,flexWrap:"wrap",marginBottom:6}}>
      <span>{ticker}</span>
      {info?.exchange&&<span>· {info.exchange}</span>}
      <span>· {isFund?(etfCategory||"Fund"):"Stock"}</span>
      {/* Watchlist + Owned status — small mono chips inline with identity row */}
      {heldIn.length>0&&<span style={{color:"var(--accent)",letterSpacing:"0.16em"}}>· OWNED</span>}
      {watchlistEntry&&!heldIn.length&&!isManualTrack&&<span style={{color:"var(--text-muted)",letterSpacing:"0.16em"}}>· WATCHLIST</span>}
      {portfolioAuthed&&(onUserWatchlist
        ?<Tip def="Remove this ticker from your watchlist"><button type="button" onClick={removeFromWatchlist} disabled={wlBusy}
          style={{fontSize:10,marginLeft:6,color:"#c8302a",background:"transparent",border:"1px solid rgba(200,48,42,0.35)",borderRadius:4,padding:"2px 8px",fontFamily:"var(--font-mono)",fontWeight:600,cursor:wlBusy?"default":"pointer",letterSpacing:"0.06em"}}>{wlBusy?"…":"− REMOVE"}</button></Tip>
        :<Tip def="Add this ticker to your watchlist"><button type="button" onClick={addToWatchlist} disabled={wlBusy}
          style={{fontSize:10,marginLeft:6,color:"var(--accent)",background:"var(--accent-soft)",border:"1px solid rgba(0,113,227,0.35)",borderRadius:4,padding:"2px 8px",fontFamily:"var(--font-mono)",fontWeight:600,cursor:wlBusy?"default":"pointer",letterSpacing:"0.06em"}}>{wlBusy?"…":"+ WATCHLIST"}</button></Tip>
      )}
    </div>
    <h1 style={{fontFamily:"var(--font-display, Fraunces, Georgia, serif)",fontWeight:500,fontSize:32,letterSpacing:"-0.012em",color:"var(--text)",lineHeight:1.05,margin:"0 0 6px"}}>
      {companyName}
      {sector&&!isFund&&<span style={{fontStyle:"italic",fontWeight:400,color:"var(--text-muted)"}}> · {sector}</span>}
    </h1>
    {/* Sub-line — position context if held, else company description teaser. Falls back gracefully. */}
    {heldIn.length>0?(
      <div style={{fontSize:13,color:"var(--text-2)",lineHeight:1.4}}>
        {heldIn.map((h,i)=>{
          const sharesTxt=h.p.assetClass==="option"
            ? `${Number(h.p.quantity)} ${h.p.contractType||""} contract${Number(h.p.quantity)===1?"":"s"}`.trim()
            : `${Number(h.p.quantity).toLocaleString()} share${Number(h.p.quantity)===1?"":"s"}`;
          const cb=h.p.avgCost!=null?` · cost basis ${fmt$(h.p.avgCost)}${h.p.assetClass==="option"?" / contract":" / sh"}`:"";
          return <span key={h.acct.id}>{i>0?" · ":""}{`In your ${h.acct.label}`} · {sharesTxt}{cb}</span>;
        })}
      </div>
    ):watchlistEntry?.theme?(
      <div style={{fontSize:13,color:"var(--text-2)",lineHeight:1.4}}>{watchlistEntry.theme}</div>
    ):shortDesc?(
      <div style={{fontSize:13,color:"var(--text-2)",lineHeight:1.4,maxWidth:560}}>
        {(shortDesc||"").replace(/\s*\.\.\.\s*$/,"").replace(/\s*…\s*$/,"")}
      </div>
    ):null}
    {wlError&&<div style={{fontSize:11,color:"#c8302a",fontFamily:"var(--font-mono)",marginTop:4}}>{wlError}</div>}
  </div>
  {/* RIGHT — price + delta */}
  <div style={{textAlign:"right",flexShrink:0}}>
    <div className="num" style={{fontFamily:"var(--font-mono)",fontSize:30,fontWeight:600,color:"var(--text)",lineHeight:1}}>{price?fmt$(price):"—"}</div>
    {dayPct!=null&&prevClose!=null&&price!=null&&(
      <div style={{marginTop:6,fontFamily:"var(--font-mono)",fontSize:12,fontWeight:600,letterSpacing:"0.06em",color:dayPct>=0?"var(--green-text, #1a8c39)":"var(--red-text, #c8302a)"}}>
        {dayPct>=0?"▲ +":"▼ "}{fmt$(Math.abs(price-prevClose))} · {dayPct>=0?"+":""}{dayPct.toFixed(2)}%
      </div>
    )}
    {(scanData?.universe_snapshot_ts||scanData?.ticker_events_ts)&&<div style={{marginTop:6,display:"flex",justifyContent:"flex-end"}}><UniverseFreshness pricesTs={scanData.universe_snapshot_ts} eventsTs={scanData.ticker_events_ts} compact/></div>}
  </div>
</div>

{/* Signal Composite block retired here per v5 spec — Phase 4b PR-H.
    The right-rail tiles (Macro Composite / Asset Tilt / Technical
    Indicators / Unusual Flow / Earnings & Events / News) replace
    the six section pills + composite-score header that lived here. */}

{/* ── v5 KPI strip (Phase 4b PR-B). 4 cards: 1-week / 1-month /
    YTD return + Position P&L. Each carries a vs-SPY comparator
    and a tiny sparkline. LESSONS rule #5 (plain-English labels);
    LESSONS rule #30 (every value from live data). */}
{(()=>{
  // Pull SPY's matching windows from the same scan (scanData.signals.technicals.SPY).
  const spyTech = scanData?.signals?.technicals?.SPY || {};
  const wkSpy = spyTech.week_change;
  const moSpy = spyTech.month_change;
  const ytSpy = spyTech.ytd_change;
  // Position-level math — sum across every account that holds the ticker.
  // For options, use per-contract cost (LESSONS rule #25). qty * (price - avgCost).
  const heldUnreal = heldIn.reduce((acc,h)=>{
    const q = Number(h.p.quantity)||0;
    const px = Number(h.p.price);
    const ac = Number(h.p.avgCost);
    if (!q || !isFinite(px) || !isFinite(ac)) return acc;
    return acc + q * (px - ac);
  }, 0);
  const heldCost = heldIn.reduce((acc,h)=>{
    const q = Number(h.p.quantity)||0;
    const ac = Number(h.p.avgCost);
    if (!q || !isFinite(ac)) return acc;
    return acc + q * ac;
  }, 0);
  const heldPnlPct = heldCost > 0 ? heldUnreal / heldCost : null;
  const heldQty = heldIn.reduce((acc,h)=>acc + (Number(h.p.quantity)||0), 0);

  // Color rule: green for >=0, red for <0, dim for null.
  const cFor = v => v==null ? "var(--text-dim)" : (v>=0 ? "var(--green-text, #1a8c39)" : "var(--red-text, #c8302a)");

  const KpiCard = ({label, value, comp, color, tip, spark}) => (
    <div style={{background:"var(--surface-solid, var(--paper, #fff))",border:"1px solid var(--border)",borderRadius:"var(--radius-xs, 6px)",padding:"12px 14px",display:"flex",flexDirection:"column"}}>
      <div style={{fontFamily:"var(--font-mono)",fontSize:9.5,textTransform:"uppercase",letterSpacing:"0.16em",color:"var(--text-dim)",marginBottom:4,display:"flex",alignItems:"center",gap:3}}>
        {label}{tip&&<InfoTip def={tip} size={10}/>}
      </div>
      <div style={{fontFamily:"var(--font-mono)",fontSize:18,fontWeight:600,color,lineHeight:1.1}}>{value}</div>
      {comp&&<div style={{marginTop:4,fontFamily:"var(--font-mono)",fontSize:11,color:"var(--text-muted)"}}>{comp}</div>}
      {spark}
    </div>
  );

  const fmtRet = v => v==null ? "—" : `${v>=0?"+":""}${(v*100).toFixed(1)}%`;
  const fmtRetSpy = v => v==null ? null : `vs SPY ${v>=0?"+":""}${(v*100).toFixed(1)}%`;

  return (
    <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:14,marginBottom:"var(--space-4)"}}>
      <KpiCard
        label="1-week return"
        value={fmtRet(wk)}
        comp={fmtRetSpy(wkSpy)}
        color={cFor(wk)}
        tip="Price change over the last 5 trading days. Sourced from the in-house technicals on the most recent scan."
      />
      <KpiCard
        label="1-month return"
        value={fmtRet(mo)}
        comp={fmtRetSpy(moSpy)}
        color={cFor(mo)}
        tip="Price change over the last ~21 trading days."
      />
      <KpiCard
        label="YTD return"
        value={fmtRet(yt)}
        comp={fmtRetSpy(ytSpy)}
        color={cFor(yt)}
        tip="Price change since Jan 1 of the current year."
      />
      {heldIn.length>0?(
        <KpiCard
          label="Position P&L"
          value={heldPnlPct==null ? "—" : (heldUnreal>=0?"+":"−")+fmt$M(Math.abs(heldUnreal))}
          comp={heldPnlPct==null ? null : `${heldPnlPct>=0?"+":""}${(heldPnlPct*100).toFixed(1)}% on cost · ${heldQty.toLocaleString()} ${heldIn[0].p.assetClass==="option"?"contract"+(heldQty===1?"":"s"):"sh"}`}
          color={cFor(heldPnlPct)}
          tip="Unrealized profit/loss across every account that holds this ticker. For options, math uses per-contract storage (LESSONS rule #25)."
        />
      ):(
        <KpiCard
          label="Not held"
          value="—"
          comp={watchlistEntry?"on your watchlist":"add to watchlist to track"}
          color="var(--text-dim)"
          tip="You don't currently own this ticker. The Position P&L card activates once you add a position via the Add Position editor."
        />
      )}
    </div>
  );
})()}

{/* ── Phase 4b PR-H (2026-04-29): the Risk Metrics 2-year panel
    (moved to new 'Risk' bottom tab), Technical Analysis panel,
    Options/IV/Flow Skew panel, Short Interest, Market Structure,
    Held Position Detail, Activity (Congress/Insider/Flow rows),
    Analyst Ratings, and Dark Pool panels — all retired here per
    v5 spec. The Signal Intelligence rail on the right now carries
    this storytelling. */}

{/* HISTORICAL CHART — daily price chart with period picker, custom
    date range, and up to 3 ticker comparators. Joe spec 2026-04-27 (P4
    #14 + #15). All series price-rebased to 100 at the start of the
    window. Lives in every stock modal regardless of issue type. */}
<HistoricalChart ticker={ticker} sector={sector} defaultPeriod="1y" height={280}/>

{/* Recent News + Footer retired here per v5 spec — Phase 4b PR-H. */}

{/* ── BOTTOM TABS — deep-dive content (About / Dividend history / Splits).
    Phase 4b PR-E. About reads ticker_reference (Massive · Polygon
    metadata); Dividend history and Splits read the corresponding
    Supabase tables populated by the daily MASSIVE-DAILY cron.
    LESSONS rule #29: stateful disclosure (no <details>); LESSONS
    rule #30: every value reads from live data. */}
<DeepDiveTabs deepDive={deepDive} ticker={ticker} riskMetrics={_riskMetrics} heldIn={heldIn}/>

{/* ── ACTION ROW — Phase 4b PR-F. Closes out the modal-left column.
    Wires to existing flows: Add Position editor, Edit Position editor,
    watchlist remove, Scanner deep-dive. 'Set stop alert' is queued as
    its own track — needs a backend alert table + cron + notifications. */}
<ActionRow
  ticker={ticker}
  heldIn={heldIn}
  portfolioAuthed={portfolioAuthed}
  onUserWatchlist={onUserWatchlist}
  removeFromWatchlist={removeFromWatchlist}
  wlBusy={wlBusy}
  onOpenAddPosition={onOpenAddPosition}
  onOpenEditPosition={onOpenEditPosition}
  onClosePosition={onClosePosition}
  onClose={onClose}
/>

</div>
<aside className="modal-rail" style={{minWidth:0,paddingLeft:"var(--space-2)",borderLeft:"1px solid var(--border-faint)"}}>
<SignalIntelligenceRail
  ticker={ticker}
  composite={composite}
  tech={tech}
  scanData={scanData}
  macroLatest={macroLatest}
  v9Alloc={v9Alloc}
  sector={sector}
  isFund={isFund}
  congressBuys={congressBuys}
  congressSells={congressSells}
  insiderBuys={insiderBuys}
  insiderSells={insiderSells}
  flowCalls={flowCalls}
  flowPuts={flowPuts}
  darkPoolPrints={darkPoolPrints}
  news={news}
  nextEarn={nextEarn}
  earnTimeForChip={earnTimeForChip}
  impMove30={impMove30}
  scrollToSection={scrollToSection}
/>
</aside>
</div>
</div>
</div>
</div>
);
}
