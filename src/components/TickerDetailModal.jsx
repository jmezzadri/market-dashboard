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


export default function TickerDetailModal({ticker,scanData,accounts,watchlistRows,portfolioAuthed,refetchPortfolio,onClose,onTickerAdded,scanBusy,macroLatest,v9Alloc}){
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

{/* Score Gauge + Signal Breakdown. Tickers that the scanner can't score
    (funds, ETFs, crypto proxies, or symbols outside yfinance/UW coverage)
    get the same composite frame rendered with "—" placeholders + a small
    banner explaining why. Keeps every modal structurally consistent. */}
<div style={panelStyle}>
{isManualTrack&&(
<div style={{fontSize:11,color:"var(--text-muted)",background:"var(--surface-3)",border:"1px solid var(--border-faint)",borderRadius:5,padding:"7px 10px",marginBottom:10,lineHeight:1.45}}>
{scanBusy&&manualTrackKind==="pending"?(
<><span style={{color:"var(--text)",fontWeight:600}}>Scanning fresh data…</span> {watchlistEntry?.theme?`${watchlistEntry.theme} — `:""}Pulling news, company info, analyst ratings, and screener stats from Unusual Whales — usually 3–5 seconds. Technical indicators (TECH subcomposite) populate on the next scheduled scan.</>
):manualTrackKind==="pending"?(
<><span style={{color:"var(--text)",fontWeight:600}}>Scanner data pending.</span> {watchlistEntry?.theme?`${watchlistEntry.theme} — `:""}This ticker isn't in the last scan yet — directional scores will populate on the next run. News, analyst ratings, and {heldIn.length>0?"position detail":"watchlist context"} still render below if available.</>
):manualTrackKind==="crypto"?(
<><span style={{color:"var(--text)",fontWeight:600}}>No subcomposite data.</span> {watchlistEntry?.theme?`${watchlistEntry.theme} — `:""}Crypto proxies (BTCUSD / ETHUSD) don't have the single-name equity signals (options flow, insider/congress filings, analyst ratings) the composite blends, so directional scores stay blank. Hold info and watchlist context still render above.</>
):(
<><span style={{color:"var(--text)",fontWeight:600}}>No subcomposite data.</span> {watchlistEntry?.theme?`${watchlistEntry.theme} — `:""}Subcomposite scores are computed for single-name equities only — not mutual funds, ETFs, or broad-index funds. Hold info and watchlist context still render above; directional scores will stay blank for this symbol.</>
)}
</div>
)}
<div style={{display:"flex",alignItems:"baseline",gap:12,marginBottom:10,flexWrap:"wrap"}}>
<div style={{fontSize:10,color:"var(--text-muted)",fontFamily:"var(--font-mono)",letterSpacing:"0.08em",fontWeight:600}}>SIGNAL COMPOSITE</div>
{composite?.overall?.score!=null?(<>
<span style={{fontSize:30,fontWeight:800,color:colorForDirection(composite.overall.direction),fontFamily:"var(--font-mono)",lineHeight:1}}>
{composite.overall.score>=0?"+":""}{composite.overall.score}
</span>
<span style={{fontSize:11,color:colorForDirection(composite.overall.direction),fontFamily:"var(--font-mono)",letterSpacing:"0.08em",fontWeight:600}}>
{composite.overall.label}
</span>
</>):composite?(
<span style={{fontSize:30,fontWeight:800,color:"var(--text-dim)",fontFamily:"var(--font-mono)",lineHeight:1}}>—</span>
):null}
<div style={{flexBasis:"100%",fontSize:11,color:"var(--text-muted)",lineHeight:1.4,marginTop:2}}>
Weighted blend of the six sections below (−100 bearish … +100 bullish) so you can see direction AND strength at a glance. Click a pill to jump to the section.
</div>
</div>
{composite&&(
<div style={{display:"flex",flexWrap:"wrap",gap:6}}>
{composite.order.map(k=>{
  const sec=composite.sections[k];
  const anchorMap={technicals:"sec-technical",options:"sec-options",insider:"sec-activity",congress:"sec-activity",analyst:"sec-analyst",darkpool:"sec-darkpool"};
  return <CompositePill key={k} sec={sec} onClick={()=>scrollToSection(anchorMap[k])}/>;
})}
</div>
)}
</div>

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
  // Tiny sparkline: scale the return into a 0-100 / 4-20 svg path. Slope reflects
  // sign + magnitude. Not historical — a stylistic trend cue. The historical
  // 30-day sparkline ships in PR-D (chart Compare bar restyle).
  const Spark = ({v, color}) => {
    if (v == null) return null;
    const slope = Math.max(-1, Math.min(1, v * 6)); // amplify so small returns show
    const y0 = 18 - slope * 12;
    const y1 = 18 + slope * 12;
    return (<svg viewBox="0 0 100 24" preserveAspectRatio="none" style={{width:"100%",height:24,marginTop:6,display:"block"}}>
      <polyline points={`0,${y1.toFixed(1)} 50,${(18-slope*4).toFixed(1)} 100,${y0.toFixed(1)}`} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round"/>
    </svg>);
  };

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
        spark={<Spark v={wk} color={cFor(wk)}/>}
      />
      <KpiCard
        label="1-month return"
        value={fmtRet(mo)}
        comp={fmtRetSpy(moSpy)}
        color={cFor(mo)}
        tip="Price change over the last ~21 trading days."
        spark={<Spark v={mo} color={cFor(mo)}/>}
      />
      <KpiCard
        label="YTD return"
        value={fmtRet(yt)}
        comp={fmtRetSpy(ytSpy)}
        color={cFor(yt)}
        tip="Price change since Jan 1 of the current year."
        spark={<Spark v={yt} color={cFor(yt)}/>}
      />
      {heldIn.length>0?(
        <KpiCard
          label="Position P&L"
          value={heldPnlPct==null ? "—" : (heldUnreal>=0?"+":"−")+fmt$M(Math.abs(heldUnreal))}
          comp={heldPnlPct==null ? null : `${heldPnlPct>=0?"+":""}${(heldPnlPct*100).toFixed(1)}% on cost · ${heldQty.toLocaleString()} ${heldIn[0].p.assetClass==="option"?"contract"+(heldQty===1?"":"s"):"sh"}`}
          color={cFor(heldPnlPct)}
          tip="Unrealized profit/loss across every account that holds this ticker. For options, math uses per-contract storage (LESSONS rule #25)."
          spark={<Spark v={heldPnlPct} color={cFor(heldPnlPct)}/>}
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


{/* Risk metrics — Beta, Vol, Max DD, 10-day 99% VaR. Computed from
    2Y of daily Yahoo price data. Always renders so users see this on
    every stock modal regardless of issue type. Joe spec 2026-04-27
    (P5 #16/#17). */}
<div id="sec-risk" style={panelStyle}>
<div style={sectionLabel}>RISK METRICS · 2-YEAR</div>
<div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))",gap:8}}>
{(()=>{
  const m=_riskMetrics;
  const fmtPctMag=v=>v==null?"—":(v*100).toFixed(2)+"%";
  const fmtBeta=v=>v==null?"—":v.toFixed(2);
  const heldVal=heldIn[0]?.p?.value||null;
  const var$=m?.var10d99!=null&&heldVal?heldVal*m.var10d99:null;
  const fmt$=v=>v==null?null:`$${Math.round(v).toLocaleString()}`;
  const betaCol=m?.beta==null?"var(--text-dim)":m.beta>1.3?"#ff9f0a":m.beta<0.6?"#B8860B":"var(--text)";
  const volCol=m?.annVol==null?"var(--text-dim)":m.annVol>0.40?"#ff453a":m.annVol>0.25?"#ff9f0a":"var(--text)";
  const ddCol=m?.maxDD==null?"var(--text-dim)":m.maxDD>0.40?"#ff453a":m.maxDD>0.25?"#ff9f0a":"var(--text)";
  const varCol=m?.var10d99==null?"var(--text-dim)":m.var10d99>0.20?"#ff453a":m.var10d99>0.10?"#ff9f0a":"var(--text)";
  return(<>
    <Kpi label="BETA · vs SPY" value={fmtBeta(m?.beta)} color={betaCol} sub="2Y weekly OLS" tip="Beta vs S&P 500 (SPY). Computed from 2 years of weekly returns via ordinary least squares. Beta of 1.0 = moves with the market; >1.0 amplifies; <1.0 dampens. Negative beta is rare and means inverse correlation."/>
    <Kpi label="ANN VOL" value={fmtPctMag(m?.annVol)} color={volCol} sub="2Y daily × √252" tip="Annualized volatility = standard deviation of daily returns over 2Y, scaled by √252 (trading days/yr). Roughly: 15-25% normal for diversified equities, 25-40% elevated, >40% high-beta single names."/>
    <Kpi label="MAX DRAWDOWN" value={fmtPctMag(m?.maxDD)} color={ddCol} sub="peak → trough, 2Y" tip="Largest peak-to-trough decline as a fraction of the prior peak over the last 2Y. Captures the worst capital impairment a holder could have experienced without selling."/>
    <Kpi label="10D 99% VaR" value={fmtPctMag(m?.var10d99)} color={varCol} sub={var$?"approx "+fmt$(var$)+" on this position":"% of position"} tip="10-day 99% historical Value-at-Risk. Using 2Y daily returns, take rolling 10-day returns, sort, find the 1st-percentile worst outcome. Translates to: with 99% confidence the position should not lose more than this over 10 trading days. Loss EXCEEDS this 1% of the time historically."/>
  </>);
})()}
</div>
{_riskMetrics?.sourceWindow && <div style={{fontSize:9,color:"var(--text-dim)",fontFamily:"var(--font-mono)",letterSpacing:"0.04em",marginTop:6}}>Source: Yahoo daily · {_riskMetrics.sourceWindow}</div>}
</div>

{/* Technicals — hide entirely for manual-track tickers where every field is null */}
{(rsi!=null||macd!=null||above50!=null||above200!=null||vol!=null||rv!=null)&&(
<div id="sec-technical" style={panelStyle}>
<div style={{...sectionLabel,display:"flex",alignItems:"center"}}><span>TECHNICAL ANALYSIS</span><CompositeBadge sec={composite?.sections?.technicals}/></div>
<div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(130px,1fr))",gap:8}}>
{rsi!=null&&<Kpi label="RSI-14" value={rsi.toFixed(1)} color={rsiColor} sub={rsi>=70?"overbought":rsi<=30?"oversold":"neutral"} tip="Relative Strength Index over 14 days. Oscillator from 0-100. Above 70 is traditionally 'overbought' (stretched, prone to pullback); below 30 is 'oversold' (bid for a bounce). Between 30-70 is neutral momentum."/>}
{macd!=null&&<Kpi label="MACD CROSS" value={macd} color={macdColor} tip="Moving Average Convergence Divergence. 'bullish' = the 12-day EMA just crossed ABOVE the 26-day EMA in the last 3 days (momentum shift up). 'bearish' = crossed below (momentum down). 'neutral' = no recent cross."/>}
{above50!=null&&<Kpi label="VS 50-DAY MA" value={above50?"above":"below"} color={ma50Color} tip="Is the price above or below its 50-day simple moving average? Above = short-term uptrend. Below = short-term downtrend."/>}
{above200!=null&&<Kpi label="VS 200-DAY MA" value={above200?"above":"below"} color={ma200Color} tip="Is the price above or below its 200-day simple moving average? Above = long-term bull trend (institutional reference line). Below = long-term bear / correction."/>}
{vol!=null&&<Kpi label="VOL SURGE" value={`${vol.toFixed(2)}×`} color={volColor} sub="vs 30d avg" tip="Today's trading volume divided by the 20-day average. 1.0× = normal day. >2× = heavy interest (often tied to news, breakouts, or institutional activity). <0.5× = quiet."/>}
{rv!=null&&<Kpi label="REALIZED VOL 30D" value={`${rv.toFixed(0)}%`} color="var(--text)" tip="Actual price volatility observed over the past 30 days (annualized). Compare to implied vol to see if options are priced richer or cheaper than the stock's recent behavior."/>}
</div>
</div>
)}

{/* Options — IV + flow skew */}
{(ivLvl!=null||ivRank!=null||bullPrem!=null||flowSkew!=null||impMove30!=null||pcRatio!=null)&&(
<div id="sec-options" style={panelStyle}>
<div style={{...sectionLabel,display:"flex",alignItems:"center"}}><span>OPTIONS · IV · FLOW SKEW</span><CompositeBadge sec={composite?.sections?.options}/></div>
<div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))",gap:8}}>
{ivRank!=null&&<Kpi label="IV RANK" value={`${ivRank.toFixed(0)}`} color={ivRankColor} sub={ivRank>=70?"IV expensive":ivRank<=30?"IV cheap":"mid-range"} tip="Where current 30-day implied volatility sits in its 52-week range, 0-100. IV Rank 0 = IV is at a 1-year LOW (options cheap, favors buying calls/puts). IV Rank 100 = IV is at a 1-year HIGH (options expensive, favors premium selling — covered calls, cash-secured puts). >70 is the scanner's threshold to screen for covered-call setups."/>}
{ivLvl!=null&&<Kpi label="IV 30D LEVEL" value={`${ivLvl.toFixed(0)}%`} color="var(--text)" tip={`Annualized implied volatility priced into 30-day options (${ivLvl.toFixed(0)}%). Interpretation: the options market expects the stock to move roughly ±${(ivLvl/Math.sqrt(12)).toFixed(0)}% over the next month (1σ). Higher = more expected motion. Compare to realized vol to see the vol premium.`}/>}
{impMove30!=null&&<Kpi label="IMPLIED MOVE 30D" value={`±${impMove30.toFixed(1)}%`} color="var(--text)" tip="Expected price range over the next 30 days implied by at-the-money option prices (1σ). E.g. ±6% means the options market is pricing ~68% probability the stock stays within ±6% over a month."/>}
{flowSkew!=null&&<Kpi label="FLOW SKEW" value={fmt$signed(flowSkew)} color={flowSkew>=0?"#30d158":"#ff453a"} sub={flowSkew>=0?"bid for upside":"bid for downside"} tip="Net call premium minus net put premium (dollars). Positive = today's options flow is net paying for upside exposure (calls); negative = net paying for downside protection (puts). This is the scanner's closest equity-skew read — more positive = more bullish flow."/>}
{netCallPrem!=null&&<Kpi label="NET CALL PREM" value={fmt$signed(netCallPrem)} color={netCallPrem>=0?"#30d158":"var(--text-dim)"} tip="Dollar premium paid for calls at the ask MINUS premium hit at the bid. Positive = aggressive call buying; negative = net call selling."/>}
{netPutPrem!=null&&<Kpi label="NET PUT PREM" value={fmt$signed(netPutPrem)} color={netPutPrem>=0?"#ff453a":"var(--text-dim)"} tip="Dollar premium paid for puts at the ask MINUS premium hit at the bid. Positive = aggressive put buying (hedging or directional bear bets); negative = net put selling (often income / yield)."/>}
{pcRatio!=null&&<Kpi label="PUT/CALL OI" value={pcRatio.toFixed(2)} color={pcRatio>1?"#ff453a":pcRatio<0.7?"#30d158":"var(--text)"} sub={`calls ${fmtNum(callOI)} · puts ${fmtNum(putOI)}`} tip="Put open interest divided by call open interest. >1.0 means more put positioning than call (often hedged long books or bearish); <0.7 skews bullish. Extreme values (>2 or <0.3) can be contrarian signals."/>}
{pcVolRatio!=null&&<Kpi label="PUT/CALL VOL" value={pcVolRatio.toFixed(2)} color={pcVolRatio>1?"#ff453a":pcVolRatio<0.7?"#30d158":"var(--text)"} sub="today's flow direction" tip="Today's put volume divided by call volume. Measures today's directional flow (vs OI which measures accumulated positioning). Moving above 1 intraday often signals stress buying; below 0.7 signals call chase."/>}
</div>
</div>
)}

{/* Short interest — FINRA biweekly, ~15-day lag, NEVER real-time */}
{(siPctFloat!=null||siPctSOut!=null||siDaysCover!=null)&&(()=>{
  const pf=siPctFloat!=null?siPctFloat:siPctSOut;  // prefer % of float, fall back to % of shares out
  const pfPct=pf!=null?pf*100:null;
  const siCol=pfPct==null?"var(--text-dim)":pfPct>=25?"#ff453a":pfPct>=15?"#ff9f0a":pfPct>=5?"#B8860B":"#30d158";
  const siLabel=pfPct==null?"":pfPct>=25?"squeeze setup":pfPct>=15?"elevated":pfPct>=5?"moderate":"low";
  const dtcCol=siDaysCover==null?"var(--text-dim)":siDaysCover>=7?"#ff453a":siDaysCover>=3?"#ff9f0a":"var(--text)";
  const trendCol=siTrendPct==null?"var(--text-dim)":siTrendPct>=10?"#ff453a":siTrendPct<=-10?"#30d158":"var(--text)";
  const usingSOut=siPctFloat==null&&siPctSOut!=null;
  return(
  <div style={panelStyle}>
  <div style={sectionLabel}>SHORT INTEREST {siAsOf?`· as of ${siAsOf}`:""}</div>
  <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))",gap:8}}>
  {pfPct!=null&&<Kpi label={usingSOut?"SI % SHARES OUT":"SI % FLOAT"} value={`${pfPct.toFixed(1)}%`} color={siCol} sub={siLabel} tip={`Short interest as a percentage of ${usingSOut?"shares outstanding":"float"}. The classic squeeze indicator — high SI on a name showing bullish setup (rising price, positive flow, congress/insider buys) is a setup for a short squeeze. Buckets: <5% low (no edge); 5–15% moderate; 15–25% elevated (worth watching); >25% squeeze setup (GME peak was 140%+).${siPctFloat==null?" Note: this ticker only reports % of shares outstanding, not float.":""}`}/>}
  {siDaysCover!=null&&<Kpi label="DAYS TO COVER" value={`${siDaysCover.toFixed(1)}d`} color={dtcCol} sub={siDaysCover>=7?"hard to exit":siDaysCover>=3?"meaningful":"easy to cover"} tip="Short interest divided by 30-day average daily share volume — how many trading days it would take shorts to fully cover at typical volume. Low days-to-cover (<3) means shorts can exit cleanly; high (>7) means any squeeze gets violent because shorts can't get out fast enough."/>}
  {sharesShort!=null&&<Kpi label="SHARES SHORT" value={fmtNum(sharesShort)} color="var(--text)" sub={siTrendPct!=null?`${siTrendPct>=0?"+":""}${siTrendPct.toFixed(1)}% vs prior`:""} tip="Total shares sold short at the last FINRA report (biweekly). Compare to prior-month figure (sub-text) to see if shorts are pressing the trade or covering — bears doubling down (rising SI) into a rising price is a classic squeeze setup."/>}
  {siTrendPct!=null&&<Kpi label="SI TREND" value={`${siTrendPct>=0?"+":""}${siTrendPct.toFixed(1)}%`} color={trendCol} sub={siTrendPct>=10?"shorts pressing":siTrendPct<=-10?"shorts covering":"flat"} tip="Change in shares short vs the prior bi-weekly report. Rising SI (>+10%) into a rising price = bears doubling down (squeeze fuel). Falling SI (<-10%) = shorts already covering (squeeze likely played out)."/>}
  </div>
  <div style={{fontSize:9,color:"var(--text-dim)",marginTop:8,fontStyle:"italic"}}>FINRA reports SI biweekly with a ~15-day lag — this data is never real-time.</div>
  </div>
  );
})()}

{/* Market structure */}
{(mcap!=null||avgVol!=null||nextEarn||nextDiv)&&(
<div style={panelStyle}>
<div style={sectionLabel}>MARKET STRUCTURE</div>
<div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(130px,1fr))",gap:8}}>
{mcap!=null&&<Kpi label="MARKET CAP" value={fmt$M(mcap)} color="var(--text)" tip="Total market capitalization (shares × price). Rough size buckets: <$300M microcap, $300M-2B small, $2-10B mid, $10-200B large, >$200B mega."/>}
{avgVol!=null&&price!=null&&<Kpi label="AVG $VOL 30D" value={fmt$M(avgVol*price)} color="var(--text)" sub="liquidity, last 30d" tip="Average daily DOLLAR volume over the past 30 days (avg shares × close). This is the comparable liquidity read across tickers — raw share counts don't compare (a $0.50 penny stock can trade more shares than BRK.A). Rough institutional buckets: <$10M illiquid (wide spreads, slippage on size); $10M-100M tradable but be careful with size; >$100M deep enough for most positions; >$1B mega-liquid."/>}
{relVol!=null&&<Kpi label="RELATIVE VOL" value={`${relVol.toFixed(2)}×`} color={relVol>=2?"#30d158":relVol>=1?"var(--text)":"var(--text-dim)"} sub="vs 30d avg" tip="End-of-session relative volume from the daily 3:30 PM ET scan: prior session's full-day volume divided by the 30-day average. >1× = heavier than typical (often news/catalyst); <1× = quieter than typical. NOT a real-time intraday pace — the dashboard is fed by a once-daily scan."/>}
{(nextEarn||info?.next_earnings_date)&&<Kpi label="NEXT EARNINGS" value={String(nextEarn||info?.next_earnings_date).slice(0,10)} color="var(--text)" sub={earnTimeForChip==="premarket"?"before open":earnTimeForChip==="postmarket"?"after close":""} tip={`Next scheduled earnings release date${earnTimeForChip?` (${earnTimeForChip==="premarket"?"reports before the open":"reports after the close"})`:""}. IV often inflates into earnings and crushes immediately after — relevant for any options trades.`}/>}
{nextDiv&&<Kpi label="NEXT DIVIDEND" value={String(nextDiv).slice(0,10)} color="var(--text)" tip="Next ex-dividend date. Covered-call writers should be aware — American-style calls that are deep-ITM may be exercised early before the ex-dividend date."/>}
</div>
</div>
)}

{/* Held position detail (if owned) */}
{heldIn.length>0&&(
<div style={panelStyle}>
<div style={sectionLabel}>HELD · {heldIn.length===1?heldIn[0].acct.label:`${heldIn.length} accounts`}</div>
{heldIn.map(({acct,p})=>{
  const pnlPct=p.avgCost?((p.price/p.avgCost-1)*100):null;
  const col=pnlPct==null?"var(--text-muted)":pnlPct>=0?"#30d158":"#ff453a";
  return(
  <div key={acct.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"6px 0",borderBottom:"1px solid var(--border-faint)",fontSize:12,fontFamily:"var(--font-mono)",gap:8,flexWrap:"wrap"}}>
  <span style={{color:"var(--text)"}}>{acct.label}</span>
  <span style={{color:"var(--text-muted)"}}>{p.quantity.toLocaleString()} qty · cost {fmt$(p.avgCost)}</span>
  <span style={{color:"var(--text)",fontWeight:700}}>{fmt$(p.value)}</span>
  {pnlPct!=null&&<span style={{color:col,fontWeight:600}}>{pnlPct>=0?"+":""}{pnlPct.toFixed(1)}%</span>}
  </div>
  );
})}
</div>
)}

{/* Activity: Congress / Insider / Flow rows — full scanner detail, inlined */}
{(congressCt>0||insiderCt>0||flowCt>0)&&(
<div id="sec-activity" style={panelStyle}>
<div style={{...sectionLabel,display:"flex",alignItems:"center",flexWrap:"wrap"}}>
<span>ACTIVITY</span>
{congressCt>0&&<CompositeBadge sec={composite?.sections?.congress}/>}
{insiderCt>0&&<CompositeBadge sec={composite?.sections?.insider}/>}
</div>
{congressBuys.length+congressSells.length>0&&(
<div style={{marginBottom:10}}>
<div style={{fontSize:10,color:"var(--blue)",fontFamily:"var(--font-mono)",letterSpacing:"0.08em",fontWeight:700,marginBottom:4}}>CONGRESSIONAL TRADES ({congressCt})</div>
<div style={{display:"flex",flexDirection:"column",gap:3}}>
{[...congressBuys.map(r=>({...r,kind:"BUY"})),...congressSells.map(r=>({...r,kind:"SELL"}))].slice(0,8).map((r,i)=>(
<div key={i} style={{display:"flex",gap:8,fontSize:11,fontFamily:"var(--font-mono)",alignItems:"center",padding:"3px 6px",background:"var(--surface-3)",borderRadius:3}}>
<span style={{fontSize:9,fontWeight:700,color:r.kind==="BUY"?"#30d158":"#ff453a",minWidth:28}}>{r.kind}</span>
<span style={{color:"var(--text)",flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r.name||r.reporter||"—"}{r.member_type?<span style={{color:"var(--text-dim)",marginLeft:6,textTransform:"capitalize"}}>· {r.member_type}</span>:null}</span>
<span style={{color:"var(--text-muted)"}}>{r.amounts||r.amount||r.disclosed_amount||"—"}</span>
<span style={{color:"var(--text-dim)"}}>{String(r.transaction_date||r.filed_at_date||r.disclosure_date||"").slice(0,10)}</span>
</div>
))}
</div>
</div>
)}
{insiderBuys.length+insiderSells.length>0&&(
<div style={{marginBottom:10}}>
<div style={{fontSize:10,color:"var(--purple)",fontFamily:"var(--font-mono)",letterSpacing:"0.08em",fontWeight:700,marginBottom:4}}>INSIDER TRANSACTIONS ({insiderCt})</div>
<div style={{display:"flex",flexDirection:"column",gap:3}}>
{[...insiderBuys.map(r=>({...r,kind:"BUY"})),...insiderSells.map(r=>({...r,kind:"SELL"}))].slice(0,8).map((r,i)=>{
  // Real scan-data fields: owner_name, officer_title, shares_owned_before/after, price/price_per_share/stock_price, transaction_date, filing_date
  const insiderName=r.owner_name||r.insider_name||r.name||"—";
  const insiderTitle=r.officer_title||r.insider_title||(r.is_director?"Director":r.is_ten_percent_owner?"10% owner":"");
  const priceN=r.price_per_share?Number(r.price_per_share):r.price?Number(r.price):r.stock_price?Number(r.stock_price):null;
  const sharesBefore=r.shares_owned_before!=null?Number(r.shares_owned_before):null;
  const sharesAfter=r.shares_owned_after!=null?Number(r.shares_owned_after):null;
  const rawShares=r.quantity!=null?Number(r.quantity):(r.amount!=null?Number(r.amount):null);
  const sharesTraded=(sharesBefore!=null&&sharesAfter!=null)?Math.abs(sharesAfter-sharesBefore):rawShares;
  const value=(sharesTraded!=null&&priceN!=null)?sharesTraded*priceN:null;
  const dateStr=String(r.filing_date||r.transaction_date||"").slice(0,10);
  return(
  <div key={i} style={{display:"flex",gap:8,fontSize:11,fontFamily:"var(--font-mono)",alignItems:"center",padding:"3px 6px",background:"var(--surface-3)",borderRadius:3}}>
  <span style={{fontSize:9,fontWeight:700,color:r.kind==="BUY"?"#30d158":"#ff453a",minWidth:28}}>{r.kind}</span>
  <span style={{color:"var(--text)",flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{insiderName}{insiderTitle?<span style={{color:"var(--text-dim)",marginLeft:6}}>· {insiderTitle}</span>:null}</span>
  <span style={{color:"var(--text-muted)"}}>{value!=null?fmt$M(value):sharesTraded!=null?`${fmtNum(sharesTraded)} sh`:"—"}</span>
  <span style={{color:"var(--text-dim)"}}>{dateStr}</span>
  </div>
  );
})}
</div>
</div>
)}
{flowCalls.length+flowPuts.length>0&&(
<div>
<div style={{fontSize:10,color:"var(--orange)",fontFamily:"var(--font-mono)",letterSpacing:"0.08em",fontWeight:700,marginBottom:4}}>UNUSUAL OPTIONS FLOW ({flowCt})</div>
<div style={{display:"flex",flexDirection:"column",gap:3}}>
{[...flowCalls.map(r=>({...r,side:"CALL"})),...flowPuts.map(r=>({...r,side:"PUT"}))].slice(0,8).map((r,i)=>{
  const isCall=r.side==="CALL";
  const mono=r.strike&&r.underlying_price?((Number(r.strike)-Number(r.underlying_price))/Number(r.underlying_price)*100):null;
  return(
  <div key={i} style={{display:"flex",gap:8,fontSize:11,fontFamily:"var(--font-mono)",alignItems:"center",padding:"3px 6px",background:"var(--surface-3)",borderRadius:3}}>
  <span style={{fontSize:9,fontWeight:700,color:isCall?"#30d158":"#ff453a",minWidth:28}}>{r.side}</span>
  <span style={{color:"var(--text)"}}>{r.strike?fmt$(Number(r.strike)):"—"} {r.expiry||r.expires?`exp ${String(r.expiry||r.expires).slice(0,10)}`:""}</span>
  <span style={{color:"var(--text-muted)",flex:1}}>{mono!=null?`${mono>=0?"+":""}${mono.toFixed(1)}% OTM`:""}</span>
  <span style={{color:isCall?"#30d158":"#ff453a",fontWeight:700}}>{r.total_premium?fmt$M(Number(r.total_premium)):"—"}</span>
  </div>
  );
})}
</div>
</div>
)}
</div>
)}

{/* ANALYST RATINGS — aggregated buy/hold/sell counts + avg price target,
    then 5 most recent rating actions. Data from UW /api/screener/analysts. */}
{/* Dark Pool activity — tiebreaker-only signal (max ±20 in composite). */}
{dpCt>0&&(()=>{
  const totalPrem=darkPoolPrints.reduce((s,r)=>s+(Number(r.premium)||0),0);
  // Direction proxy via NBBO-midpoint relationship (match composite logic).
  let bull=0,bear=0;
  for(const r of darkPoolPrints){
    const b=Number(r.nbbo_bid),a=Number(r.nbbo_ask),p=Number(r.price);
    if(b>0&&a>0&&p>0){const m=(b+a)/2;if(p>m)bull++;else if(p<m)bear++;}
  }
  return(
  <div id="sec-darkpool" style={panelStyle}>
  <div style={{...sectionLabel,display:"flex",alignItems:"center"}}>
  <span>DARK POOL PRINTS · {dpCt}</span>
  <CompositeBadge sec={composite?.sections?.darkpool}/>
  </div>
  <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(130px,1fr))",gap:8,marginBottom:8}}>
  <Kpi label="PRINTS TODAY" value={dpCt} color="var(--text)" tip="Count of large off-exchange (dark pool) prints matched to this ticker in today's scan."/>
  <Kpi label="TOTAL PREMIUM" value={fmt$M(totalPrem)} color="var(--text)" tip="Sum of notional (price × size) across today's dark pool prints for this ticker."/>
  <Kpi label="DIRECTION" value={bull>bear?"bid-lifted":bear>bull?"bid-hit":"mixed"} color={bull>bear?"#30d158":bear>bull?"#ff453a":"var(--text-muted)"} sub={`${bull} above-mid · ${bear} below-mid`} tip="Heuristic: print price vs NBBO midpoint. Above midpoint = buyer lifted the offer (accumulation bias). Below midpoint = seller hit the bid (distribution bias). Dark pool is always a weak signal — use as a tiebreaker only."/>
  </div>
  <div style={{display:"flex",flexDirection:"column",gap:3}}>
  {darkPoolPrints.slice(0,5).map((r,i)=>{
    const b=Number(r.nbbo_bid),a=Number(r.nbbo_ask),p=Number(r.price);
    const mid=(b>0&&a>0)?(b+a)/2:null;
    const vsMid=mid?p-mid:null;
    const tag=vsMid==null?"":vsMid>0?"▲ ask":vsMid<0?"▼ bid":"= mid";
    const col=vsMid==null?"var(--text-muted)":vsMid>0?"#30d158":vsMid<0?"#ff453a":"var(--text-muted)";
    return(
    <div key={i} style={{display:"flex",gap:8,fontSize:11,fontFamily:"var(--font-mono)",alignItems:"center",padding:"3px 6px",background:"var(--surface-3)",borderRadius:3}}>
    <span style={{color:col,fontWeight:700,minWidth:48}}>{tag}</span>
    <span style={{color:"var(--text)",flex:1}}>{Number(r.size).toLocaleString()} sh @ {fmt$(p)}</span>
    <span style={{color:"var(--text-muted)"}}>{fmt$M(Number(r.premium)||0)}</span>
    <span style={{color:"var(--text-dim)"}}>{String(r.executed_at||"").slice(11,16)}</span>
    </div>);
  })}
  </div>
  <div style={{fontSize:9,color:"var(--text-dim)",marginTop:8,fontStyle:"italic"}}>Dark pool is a weak signal — capped at ±20 in the section composite.</div>
  </div>);
})()}

{analystRatings.length>0&&(()=>{
  const recs=analystRatings.map(r=>(r.recommendation||"").toLowerCase());
  const nBuy=recs.filter(r=>r==="buy"||r==="strong_buy"||r==="overweight").length;
  const nHold=recs.filter(r=>r==="hold"||r==="neutral").length;
  const nSell=recs.filter(r=>r==="sell"||r==="strong_sell"||r==="underweight").length;
  const targets=analystRatings.map(r=>parseFloat(r.target)).filter(v=>!isNaN(v)&&v>0);
  const avgTarget=targets.length?targets.reduce((a,b)=>a+b,0)/targets.length:null;
  const upside=(avgTarget&&price)?((avgTarget-price)/price)*100:null;
  const lastDate=analystRatings[0]?.timestamp?String(analystRatings[0].timestamp).slice(0,10):null;
  return(
  <div id="sec-analyst" style={panelStyle}>
  <div style={{...sectionLabel,display:"flex",alignItems:"center"}}>
  <span>ANALYST RATINGS · {analystRatings.length} recent</span>
  <CompositeBadge sec={composite?.sections?.analyst}/>
  </div>
  <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(110px,1fr))",gap:8,marginBottom:10}}>
    <Kpi label="BUY" value={nBuy} color={nBuy>0?"#30d158":"var(--text-dim)"} tip="Count of recent analyst ratings in the buy/outperform/overweight category."/>
    <Kpi label="HOLD" value={nHold} color={nHold>0?"var(--text)":"var(--text-dim)"} tip="Count of recent analyst ratings in the hold/neutral category."/>
    <Kpi label="SELL" value={nSell} color={nSell>0?"#ff453a":"var(--text-dim)"} tip="Count of recent analyst ratings in the sell/underweight category."/>
    {avgTarget!=null&&<Kpi label="AVG TARGET" value={fmt$(avgTarget)} color={upside!=null?(upside>=0?"#30d158":"#ff453a"):"var(--text)"} sub={upside!=null?`${upside>=0?"+":""}${upside.toFixed(1)}% vs current`:null} tip="Mean of disclosed analyst price targets across the recent ratings listed. Compare to current price for implied upside/downside."/>}
    {lastDate&&<Kpi label="LAST ACTION" value={lastDate} color="var(--text)" tip="Date of the most recent analyst action in this list."/>}
  </div>
  <div style={{display:"flex",flexDirection:"column",gap:3}}>
    {analystRatings.slice(0,5).map((r,i)=>{
      const rec=(r.recommendation||"").toLowerCase();
      const recCol=rec==="buy"||rec==="strong_buy"||rec==="overweight"?"#30d158":rec==="sell"||rec==="strong_sell"||rec==="underweight"?"#ff453a":"var(--text-muted)";
      const tgt=parseFloat(r.target);
      return(
      <div key={i} style={{display:"flex",gap:8,fontSize:11,fontFamily:"var(--font-mono)",alignItems:"center",padding:"4px 6px",background:"var(--surface-3)",borderRadius:3}}>
      <span style={{color:"var(--text-dim)",minWidth:70}}>{r.timestamp?String(r.timestamp).slice(0,10):"—"}</span>
      <span style={{color:"var(--text)",flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r.firm||"—"}{r.analyst_name?` · ${r.analyst_name}`:""}</span>
      <span style={{fontSize:9,color:"var(--text-muted)",textTransform:"uppercase",minWidth:66,textAlign:"right"}}>{r.action||""}</span>
      <span style={{color:recCol,fontWeight:700,textTransform:"uppercase",minWidth:56,textAlign:"right"}}>{r.recommendation||"—"}</span>
      <span style={{color:"var(--text)",fontWeight:700,minWidth:56,textAlign:"right"}}>{!isNaN(tgt)&&tgt>0?fmt$(tgt):"—"}</span>
      </div>);
    })}
  </div>
  </div>);
})()}

{/* HISTORICAL CHART — daily price chart with period picker, custom
    date range, and up to 3 ticker comparators. Joe spec 2026-04-27 (P4
    #14 + #15). All series price-rebased to 100 at the start of the
    window. Lives in every stock modal regardless of issue type. */}
<HistoricalChart ticker={ticker} defaultPeriod="1y" height={280}/>

{/* RECENT NEWS — UW /api/news/headlines. Headlines may reference multiple
    tickers; we filter UW-side via ?ticker= so the list is this-ticker-relevant.
    Each item shows headline, publisher's own description (if UW returns one),
    source/date, and an outbound link to the article. We don't run an LLM
    summary — kept the cost/latency at zero per Joe's preference. */}
{news.length>0&&(
<div style={panelStyle}>
<div style={sectionLabel}>RECENT NEWS · {news.length} headline{news.length===1?"":"s"}</div>
<div style={{display:"flex",flexDirection:"column",gap:6}}>
  {news.slice(0,6).map((n,i)=>{
    const sent=(n.sentiment||"").toLowerCase();
    const sentCol=sent==="positive"||sent==="bullish"?"#30d158":sent==="negative"||sent==="bearish"?"#ff453a":"var(--text-muted)";
    const sentLabel=sent==="positive"||sent==="bullish"?"+":sent==="negative"||sent==="bearish"?"−":"·";
    const dt=n.created_at?new Date(n.created_at):null;
    const dateStr=dt?dt.toLocaleDateString(undefined,{month:"short",day:"numeric"}):"";
    // UW's /api/news/headlines does NOT include article URLs (verified
     // against API 2026-04-19). Fall back to a Google News search on the
     // headline so Joe can still click through instead of dead-ending on
     // a headline. If UW ever starts returning urls we prefer the real one.
    const realUrl=n.url||"";
    const url=realUrl||`https://www.google.com/search?tbm=nws&q=${encodeURIComponent(n.headline||"")}`;
    const linkLabel=realUrl?"Read full article →":"Find article →";
    // Headline becomes a link out (new tab, noopener). The whole card is
    // NOT clickable — that would conflict with text-select and the ticker
    // modal's other clickables.
    const HeadlineEl=<a href={url} target="_blank" rel="noopener noreferrer" style={{color:"var(--text)",textDecoration:"none",borderBottom:"1px dotted var(--text-muted)"}} onClick={e=>e.stopPropagation()}>{n.headline}</a>;
    return(
    <div key={i} style={{display:"flex",gap:8,alignItems:"flex-start",padding:"6px 8px",background:"var(--surface-3)",borderRadius:4,fontSize:12,lineHeight:1.4,maxWidth:"100%",boxSizing:"border-box"}}>
    <span style={{color:sentCol,fontWeight:800,fontSize:13,fontFamily:"var(--font-mono)",flexShrink:0,minWidth:10,textAlign:"center"}}>{sentLabel}</span>
    {/* minWidth:0 lets text wrap inside flex; overflowWrap+wordBreak handle
        long unbreakable strings (URLs, hashtags, foreign-language tokens)
        that were running off the modal — Joe flagged 2026-04-27. */}
    <div style={{flex:1,minWidth:0,overflowWrap:"anywhere",wordBreak:"break-word"}}>
    <div style={{color:"var(--text)",marginBottom:2}}>{HeadlineEl}{n.is_major&&<span style={{marginLeft:6,fontSize:9,color:"var(--orange)",fontFamily:"var(--font-mono)",border:"1px solid var(--orange)",borderRadius:3,padding:"1px 4px",fontWeight:700,verticalAlign:"middle",whiteSpace:"nowrap"}}>MAJOR</span>}</div>
    {(()=>{const cleanDesc=String(n.description||"").replace(/<[^>]*>/g,"").replace(/&nbsp;/g," ").replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&apos;/g,"'").replace(/\s+/g," ").trim();return cleanDesc?<div style={{fontSize:11,color:"var(--text-2)",lineHeight:1.5,marginBottom:3}}>{cleanDesc}</div>:null;})()}
    <div style={{fontSize:10,color:"var(--text-dim)",fontFamily:"var(--font-mono)",display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
      <span
        style={{
          fontSize:10,fontFamily:"var(--font-mono)",
          color:n.sourceTier==="google_news"?"var(--accent)":"var(--text-muted)",
          border:`1px solid ${n.sourceTier==="google_news"?"var(--accent)":"var(--border)"}`,
          borderRadius:3,padding:"0 5px",letterSpacing:"0.04em",fontWeight:700,
          textTransform:"uppercase",
        }}
      >{n.source||"—"}</span>
      <span style={{color:"var(--text-dim)"}}>{dateStr}</span>
      <a href={url} target="_blank" rel="noopener noreferrer" style={{color:"var(--accent)",textDecoration:"none"}} onClick={e=>e.stopPropagation()}>{linkLabel}</a>
    </div>
    </div>
    </div>);
  })}
</div>
</div>
)}

{/* Footer — just a timestamp, no escape hatch */}
<div style={{marginTop:"var(--space-2)",fontSize:10,color:"var(--text-dim)",fontFamily:"var(--font-mono)",textAlign:"right"}}>
Scan: {scanData?.date_label||"—"} · Data from latest scanner run
</div>
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
