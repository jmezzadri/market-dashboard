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
import DataFreshness from "./DataFreshness";
import { computeSectionComposites, colorForDirection } from "../ticker/sectionComposites";
import { normalizeTickerName } from "../lib/nameFormat";
import { supabase } from "../lib/supabase";
import useMassiveTickerInfo from "../hooks/useMassiveTickerInfo";
import useStockRiskMetrics from "../hooks/useStockRiskMetrics";
import useTickerDeepDive from "../hooks/useTickerDeepDive";
import useTickerEodPrice from "../hooks/useTickerEodPrice";
import { useEarningsHistory } from "../hooks/useEarningsHistory";
import { WATCHLIST_FALLBACK } from "../data/watchlistFallback";



// ============================================================================
// SignalIntelligenceRail — Phase 4b PR-C
// 6 RAG tiles: Macro Composite · Asset Tilt · Technical Indicators ·
// Unusual Flow · Earnings & Events · News.
// LESSONS rule #29: stateful disclosure pattern (no <details>), Fraunces +
// JetBrains Mono + parchment via site CSS vars.
// LESSONS rule #30: every value derives from live data (composite,
// cycleBoardSnap, v9Alloc, scanData feeds); no hardcoded narrative.
// ============================================================================
// ─── SHARED CAPTION BUILDERS ────────────────────────────────────────────
// Single source of truth for the underline / caption text under each
// signal's value, used by BOTH the MacroTilt Signal panel rows AND the
// standalone tiles below. Built 2026-05-12 (Joe directive after the ORCL
// "+68 next to no unusual flow today" episode) so the two surfaces can't
// drift again.
//
// Each function takes a scorer_components[signal] block and returns a
// plain-English string, or null when there's nothing to say. Callers
// decide how to render no-data states (vendor-limited, ADR, etc) — these
// helpers only describe data that IS present.
function _fmtMoneyShort(n) {
  const a = Math.abs(Number(n));
  if (!Number.isFinite(a)) return null;
  if (a >= 1_000_000) return `$${(n/1_000_000).toFixed(1)}M`;
  if (a >= 1_000)     return `$${Math.round(n/1_000)}K`;
  return `$${Math.round(n)}`;
}

const captionFor = {
  insider(comps) {
    if (!comps || typeof comps !== "object") return null;
    const buys  = Number(comps.buy_count  || 0);
    const sells = Number(comps.sell_count || 0);
    if (buys || sells) {
      const buy$  = comps.buy_dollar_total  ? ` (${_fmtMoneyShort(comps.buy_dollar_total)})`  : "";
      const sell$ = comps.sell_dollar_total ? ` (${_fmtMoneyShort(comps.sell_dollar_total)})` : "";
      const parts = [];
      if (buys)  parts.push(`${buys} buy${buys===1?"":"s"}${buy$}`);
      if (sells) parts.push(`${sells} sell${sells===1?"":"s"}${sell$}`);
      if (comps.first_buy_fires) parts.push("first buy in 12 months");
      return parts.join(" · ");
    }
    return "no Form 4 events in 30d";
  },
  congress(comps) {
    if (!comps || typeof comps !== "object") return null;
    const buys  = Number(comps.buy_count  || 0);
    const sells = Number(comps.sell_count || 0);
    if (buys || sells) return `${buys} buy${buys===1?"":"s"} · ${sells} sell${sells===1?"":"s"} in 90d`;
    return "no congressional trades in 90d";
  },
  options(comps) {
    if (!comps || typeof comps !== "object") return null;
    // Alert counts come first when present.
    const callCt = Number(comps.call_alert_count || 0);
    const putCt  = Number(comps.put_alert_count  || 0);
    if (callCt || putCt) return `${callCt} call · ${putCt} put alerts`;
    // Otherwise read the SAME fields the v5 options scorer reads.
    const unusualN = Number(comps.unusual_count || 0);
    const callPrem = Number(comps.call_premium  || 0);
    const putPrem  = Number(comps.put_premium   || 0);
    const askPrem  = Number(comps.ask_side_premium || 0);
    const bidPrem  = Number(comps.bid_side_premium || 0);
    const totalPrem = callPrem + putPrem;
    if (unusualN > 0 || totalPrem > 0 || askPrem > 0 || bidPrem > 0) {
      let side = "";
      if (callPrem > putPrem * 2)      side = " · call-heavy";
      else if (putPrem > callPrem * 2) side = " · put-heavy";
      const parts = [];
      if (unusualN > 0)  parts.push(`${unusualN} unusual event${unusualN===1?"":"s"}`);
      if (totalPrem > 0) parts.push(`${_fmtMoneyShort(totalPrem)} premium`);
      if (askPrem > 0)   parts.push(`${_fmtMoneyShort(askPrem)} ask-side`);
      return parts.join(" · ") + side;
    }
    return "no unusual flow today";
  },
  analyst(comps) {
    if (!comps || typeof comps !== "object") return null;
    // Field name is action_count (singular) — the producer uses this.
    const n  = Number(comps.action_count || 0);
    const up = Number(comps.upgrades     || 0);
    const dn = Number(comps.downgrades   || 0);
    if (n > 0 || up > 0 || dn > 0) {
      const parts = [];
      if (up > 0) parts.push(`${up} upgrade${up===1?"":"s"}`);
      if (dn > 0) parts.push(`${dn} downgrade${dn===1?"":"s"}`);
      if (parts.length === 0 && n > 0) parts.push(`${n} action${n===1?"":"s"} in 90d`);
      const gap = Number(comps.pt_gap_pct);
      if (Number.isFinite(gap) && Math.abs(gap) >= 1) {
        parts.push(`target ${gap > 0 ? "+" : ""}${gap.toFixed(0)}% vs spot`);
      }
      return parts.join(" · ");
    }
    return "no analyst actions in 90d";
  },
  technicals(comps) {
    if (!comps || typeof comps !== "object") return null;
    const parts = [];
    const rsi = Number(comps.rsi14);
    if (Number.isFinite(rsi)) parts.push(`RSI ${rsi.toFixed(0)}`);
    return parts.length ? parts.join(" · ") : null;
  },
  short_interest(comps) {
    if (!comps || typeof comps !== "object") return null;
    const siPct  = comps.latest_si_pct_of_float;
    const ctb    = comps.latest_ctb_pct;
    const regime = comps.regime;
    const parts  = [];
    if (siPct != null) parts.push(`${Number(siPct).toFixed(1)}% of float short`);
    if (ctb   != null) parts.push(`cost-to-borrow ${Number(ctb).toFixed(1)}%`);
    if (regime) parts.push(String(regime).replace(/_/g, " "));
    return parts.length ? parts.join(" · ") : null;
  },
};

function SignalIntelligenceRail({
  ticker, composite, tech, scanData, sc, cycleBoardSnap, v9Alloc, mtSignal,
  riskMetrics, heldIn,
  sector, isFund,
  congressBuys, congressSells, insiderBuys, insiderSells,
  flowCalls, flowPuts, darkPoolPrints, news,
  nextEarn, earnTimeForChip, impMove30, scrollToSection,
}) {
  // Last-4-quarters earnings strip — reads from public.earnings_history,
  // which is refreshed weekly by trading-scanner/run_earnings_history.py.
  const earningsHist = useEarningsHistory(ticker);
  const fmtSigned = v => v == null ? "—" : `${v >= 0 ? "+" : ""}${v}`;
  const ragColor = state => state === "green" ? "var(--green-text, #1a8c39)"
                          : state === "amber" ? "var(--yellow-text, #B8860B)"
                          : state === "red"   ? "var(--red-text, var(--red))"
                          : "var(--text-dim)";

  // Tile 1 — Macro Cycle Board (v11). Reads the same six-mechanism snapshot
  // that drives the Macro Overview page. Bands per v11 footer: 0-25 Risk-on,
  // 25-50 Neutral, 50-75 Caution, 75-100 Risk-off (lower = better, opposite of
  // the deprecated 3-composite scale).
  // Tile 1 — MacroTilt Signal (v5 — six signals + bidirectional bands).
  // Reads from signal_intel_v5_daily.
  //
  // v5.1 fixes (2026-05-10, per Joe's UAT):
  //   - Default state collapsed (defaultOpen removed at render site).
  //   - Generic signal descriptions moved to hover tooltips.
  //   - Per-signal row shows ACTUAL numbers (e.g. "3 buys / 1 sell" for
  //     insider) from `diagnostic.scorer_components`, not a generic blurb.
  //   - Insider weight readout now reads `weights_used.insider` directly
  //     instead of recomputing 0.363 * capDisc (which diverged from the
  //     table when the daily scan ran on equal-weight defaults).
  //   - Handles the new "Insufficient Data" band emitted when coverage
  //     drops below the honest-score threshold (3 of 6 signals AND >=40%
  //     of combined weight).
  const mtSignalTile = (() => {
    const sig = mtSignal;
    if (!sig) return { state: "loading", value: "...", meta: "Loading MacroTilt signal", detail: null };
    const subs    = sig.sub_scores || {};
    const weights = sig.weights_used || {};
    const capDisc = Number(sig.cap_discount);
    const mcap    = Number(sig.market_cap);
    const comps   = (sig.diagnostic && sig.diagnostic.scorer_components) || {};
    const score   = Number(sig.mt_score);
    const band    = sig.band || (Number.isFinite(score) ? "Neutral" : "No Data");

    // Five-band coloring + 7th "Insufficient Data" amber.
    const stateForBand = (b) =>
      b === "Strong Buy"        ? "green"
    : b === "Watch Buy"         ? "amber"
    : b === "Strong Sell"       ? "red"
    : b === "Watch Sell"        ? "amber"
    : b === "Insufficient Data" ? "amber"
    : "neutral";
    const state = stateForBand(band);

    // Headline value: numeric score OR "—" for missing/insufficient.
    const value = Number.isFinite(score)
      ? `${score > 0 ? "+" : ""}${score.toFixed(0)}`
      : "—";
    // v5.1 (e): Joe wants the so_what summary OUT of the tile header strip
    // (was reading like a sentence-long header). The plain band label is
    // enough at a glance; the full so_what stays inside the expanded panel.
    const meta = band;

    // Format helpers.
    const fmtSub = (v) => {
      if (v == null || !Number.isFinite(Number(v))) return null;
      const n = Number(v);
      return `${n > 0 ? "+" : ""}${n.toFixed(0)}`;
    };
    const subColor = (v) => {
      if (v == null || !Number.isFinite(Number(v))) return "var(--text-dim)";
      const n = Number(v);
      if (n >=  50) return "var(--green-text, var(--green))";
      if (n >=  20) return "var(--yellow-text, var(--text))";
      if (n <= -50) return "var(--red-text, var(--red))";
      if (n <= -20) return "var(--yellow-text, var(--text))";
      return "var(--text-muted)";
    };
    const fmtWeight = (w) => {
      if (w == null || !Number.isFinite(Number(w))) return "—";
      return `${(Number(w) * 100).toFixed(1)}%`;
    };
    const fmtMoney = (n) => {
      const x = Number(n);
      if (!Number.isFinite(x) || x === 0) return null;
      if (Math.abs(x) >= 1e9) return `$${(x/1e9).toFixed(1)}B`;
      if (Math.abs(x) >= 1e6) return `$${(x/1e6).toFixed(1)}M`;
      if (Math.abs(x) >= 1e3) return `$${(x/1e3).toFixed(0)}K`;
      return `$${x.toFixed(0)}`;
    };

    // Per-signal "actual result" line — built from diagnostic.scorer_components.
    // Falls back to "—" when no data.
    const resultLine = (key) => {
      const c = comps[key] || {};
      if (key === "insider") {
        const buys  = Number(c.buy_count || 0);
        const sells = Number(c.sell_count || 0);
        if (buys === 0 && sells === 0) return null;
        const buy$  = fmtMoney(c.buy_dollar_total);
        const sell$ = fmtMoney(c.sell_dollar_total);
        const firstBuy = c.first_buy_fires ? " · first buy in 12mo" : "";
        const parts = [];
        if (buys)  parts.push(`${buys} buy${buys===1?"":"s"}${buy$  ? ` (${buy$})`  : ""}`);
        if (sells) parts.push(`${sells} sell${sells===1?"":"s"}${sell$ ? ` (${sell$})` : ""}`);
        return parts.join(" · ") + firstBuy;
      }
      if (key === "analyst") {
        const n   = Number(c.action_count || 0);
        if (n === 0) return null;
        const gap = c.pt_gap_pct;
        const gapStr = (gap != null && Number.isFinite(Number(gap)))
          ? ` · target ${Number(gap) >= 0 ? "+" : ""}${Number(gap).toFixed(0)}% vs spot`
          : "";
        return `${n} action${n===1?"":"s"} in 90d${gapStr}`;
      }
      if (key === "technicals") {
        const rsi  = c.rsi14;
        const bw   = c.bb_bandwidth;
        const rv   = c.rvol_20d;
        const parts = [];
        if (rsi != null) parts.push(`RSI ${Number(rsi).toFixed(0)}`);
        if (bw  != null) parts.push(`band width ${(Number(bw)*100).toFixed(1)}%`);
        if (rv  != null) parts.push(`RVOL ${Number(rv).toFixed(2)}×`);
        return parts.length ? parts.join(" · ") : null;
      }
      if (key === "options") {
        const callP = Number(c.call_premium || 0);
        const putP  = Number(c.put_premium  || 0);
        const sw    = Number(c.sweep_count   || 0);
        if (callP === 0 && putP === 0 && sw === 0) return null;
        const parts = [];
        const callStr = fmtMoney(callP);
        const putStr  = fmtMoney(putP);
        if (callStr) parts.push(`calls ${callStr}`);
        if (putStr)  parts.push(`puts ${putStr}`);
        if (sw)      parts.push(`${sw} sweep${sw===1?"":"s"}`);
        return parts.join(" · ");
      }
      if (key === "congress") {
        const b = Number(c.buy_count || 0);
        const s = Number(c.sell_count || 0);
        const u = Number(c.unique_buyers || 0);
        if (b === 0 && s === 0) return null;
        const parts = [];
        if (b) parts.push(`${b} buy${b===1?"":"s"}`);
        if (s) parts.push(`${s} sell${s===1?"":"s"}`);
        if (u) parts.push(`${u} unique members`);
        return parts.join(" · ");
      }
      if (key === "short_interest") {
        const si  = c.latest_si_pct_of_float;
        const ctb = c.latest_ctb_pct;
        const reg = c.regime;
        const parts = [];
        if (si  != null) parts.push(`${Number(si).toFixed(1)}% of float short`);
        if (ctb != null) parts.push(`cost-to-borrow ${Number(ctb).toFixed(1)}%`);
        if (reg)         parts.push(String(reg).replace(/_/g, " "));
        return parts.length ? parts.join(" · ") : null;
      }
      return null;
    };

    // Signal display order + label + hover tooltip text.
    // v5.1 (e): the native title attribute fires after ~1.5s of dwell and
    // sometimes not at all -- Joe couldn't get tooltips to show in UAT.
    // Switched to a React-controlled hover popover via the local
    // HoverTip component below.
    // v5.3: each tooltip now spells out the gate / trigger thresholds we
    // use, not just what the signal is.
    const SIGNAL_ORDER = [
      { key: "insider",        label: "Insider buying",
        tip: "Form 4 open-market buys and sells by officers and directors over the trailing 30 days. Sub-score scales with dollar size as a fraction of market cap, capped at +/-100. 10b5-1 routine sales are filtered out. Bullish if buys dominate (positive sub-score); bearish if sells dominate. A 'first buy in 12 months' classifier amplifies the signal when an officer who hasn't bought recently steps in." },
      { key: "technicals",     label: "Technicals",
        tip: "Composite of four readings: 14-day RSI (overbought >70, oversold <30), Bollinger band-width (squeeze setup when <5% of price), distance to the 50-day moving average (above = trend, below = breakdown), and 20-day relative volume (unusual activity >=1.5x average). Each contributes points toward a -100/+100 sub-score." },
      { key: "analyst",        label: "Analyst actions",
        tip: "Net upgrades minus downgrades over the trailing 90 days, weighted by broker tier (top firms count 1.0x, major 0.7x, others 0.5x). Combined with the average price-target gap vs spot: targets >=15% above spot saturate bullish, <=-15% saturate bearish." },
      { key: "options",        label: "Options flow",
        tip: "30-day call vs put premium ratio (log-scale), ask-side vs bid-side bias, and unusual-size sweep count. Bullish when calls dominate AND sweeps hit the ask; bearish when puts dominate AND sweeps hit the bid. Calibration pending while the daily history backfills." },
      { key: "congress",       label: "Congress trades",
        tip: "Disclosed buy and sell trades by US senators and representatives over the trailing 90 days, weighted by tier and amount band. Cluster bonus when multiple unique members trade the same name in the same direction. Calibration pending -- thin history per name." },
      { key: "short_interest", label: "Short interest",
        tip: "Percent of float sold short and cost-to-borrow trend. Three regimes: rising SI + rising CTB above the 50-day moving average = bearish (smart money short); high SI + cheap borrow into earnings = bullish squeeze setup; falling SI + rising price = bullish capitulation. Calibration pending -- sparse coverage today." },
    ];

    // Cap-discount chip for mega-caps -- now reads weights_used.insider
    // directly so it matches the table column exactly, AND uses the real
    // Tip component (portal-rendered, fast hover) instead of the title
    // attribute (slow OS-level tooltip that Joe couldn't get to fire).
    const liveInsiderW = Number(weights.insider);
    const showCapNote =
      Number.isFinite(capDisc) && capDisc < 0.999 && Number.isFinite(liveInsiderW);
    const capNote = showCapNote ? (() => {
      const capStr = Number.isFinite(mcap) && mcap > 0
        ? (mcap >= 1e12 ? `$${(mcap/1e12).toFixed(1)}T` : mcap >= 1e9 ? `$${(mcap/1e9).toFixed(0)}B` : `$${(mcap/1e6).toFixed(0)}M`)
        : "this cap";
      return (
        <Tip
          label="Insider cap-discount mechanism"
          def={"At a $500M cap the insider weight is at full strength. By $50B it has dropped to half, and by $500B it is one-quarter. The freed weight is redistributed pro-rata to the other five signals so the total always sums to 100%. Anchor: Lakonishok & Lee 2001 -- a $1M insider buy moves the dial at a $500M company but is rounding error at $500B."}
        >
          <span style={{display:"inline-flex",alignItems:"center",gap:6,padding:"4px 9px",borderRadius:999,background:"var(--surface-3)",border:"1px solid var(--border-faint, var(--border))",color:"var(--text-2)",fontSize:11,lineHeight:1.3,cursor:"help",fontWeight:600}}>
            Insider weight {(liveInsiderW * 100).toFixed(1)}% at {capStr}
            <span style={{width:13,height:13,borderRadius:"50%",border:"1px solid var(--text-dim)",color:"var(--text-dim)",fontSize:9,display:"inline-flex",alignItems:"center",justifyContent:"center",lineHeight:1,fontWeight:400}}>i</span>
          </span>
        </Tip>
      );
    })() : null;

    // v5.2: no more Insufficient Data banner -- every stock gets a score
    // under the simpler "missing = 0 contribution" math.
    const insufficientNote = null;

    // v5.1 (e): the so_what plain-English summary that used to sit in the
    // tile header (`band - so_what`) now lives inside the expanded panel,
    // above the signals table. Joe wanted the header strip stripped down
    // to just the band.
    const soWhatLine = sig.so_what && band !== "Insufficient Data" ? (
      <div style={{padding:"8px 10px",borderRadius:8,background:"var(--surface-3)",border:"1px solid var(--border-faint, var(--border))",color:"var(--text-2)",fontSize:12,lineHeight:1.45,fontStyle:"italic"}}>
        {sig.so_what}
      </div>
    ) : null;

    // v5.1 (e): MT Signal tile is now just the COMPOSITE math (no per-signal
    // "today's reading" -- that data lives in the dedicated Insider / Analyst /
    // Short Interest / Technical Indicators / Unusual Flow tiles below).
    // Joe rightly pointed out we had Technical Indicators + Unusual Flow as
    // separate tiles AND were re-rendering the same data inside MT Signal,
    // which made the tile look like a crammed catch-all.
    const detail = (
      <div style={{display:"flex",flexDirection:"column",gap:10,fontSize:12}}>
        {insufficientNote}
        {soWhatLine}
        {capNote}
        <div>
          <div style={{display:"grid",gridTemplateColumns:"170px 80px 80px",gap:8,padding:"3px 0",fontFamily:"var(--font-mono)",fontSize:9.5,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.12em",color:"var(--text-dim)",borderBottom:"1px solid var(--border-faint, var(--border))"}}>
            <span>Signal</span>
            <span style={{textAlign:"right"}}>Sub-score</span>
            <span style={{textAlign:"right"}}>Weight</span>
          </div>
          {SIGNAL_ORDER.map((s, i) => {
            const sub = subs[s.key];
            const w   = weights[s.key];
            const subStr = fmtSub(sub);
            const isLast = i === SIGNAL_ORDER.length - 1;
            // 2026-05-12 Joe directive: when sub_score is a real number,
            // show the actual underlying data on a tiny second line below
            // the score so "Short Interest: 0" doesn't read as "MSFT has
            // zero short interest." MSFT's underlying is "1.1% of float,
            // 2.8d to cover" — neutral signal, but data exists. Same idea
            // for the other signals. Sourced from scorer_components.
            //
            // TDZ FIX 2026-05-12 — read scorer_components directly from sig
            // (which IS in scope here). The earlier version of this code
            // referenced the local `compsForTiles` variable that gets
            // declared further down in this function, causing a "Cannot
            // access 'L' before initialization" crash on MSFT (and any
            // other ticker that opened the modal expanded). LESSONS rule:
            // const inside function scope must be declared above its IIFE
            // consumers. Bypassing compsForTiles avoids the same bug.
            const comps = sig && sig.diagnostic && sig.diagnostic.scorer_components
              ? sig.diagnostic.scorer_components[s.key]
              : null;
            // 2026-05-12 — single-source-of-truth captionFor helper
            // (shared with the standalone tiles). The previous inline IIFE
            // here had drifted from the tile builders' caption logic on
            // Options/Analyst/Insider. Both surfaces now read the same
            // function so they can't disagree.
            const subUnderline = (sub == null || comps == null)
              ? null
              : (captionFor[s.key] ? captionFor[s.key](comps) : null);
            return (
              <div key={"sig"+i} style={{display:"grid",gridTemplateColumns:"170px 80px 80px",gap:8,alignItems:"baseline",padding:"6px 0",borderBottom: isLast ? "none" : "1px solid var(--border-faint, var(--border))"}}>
                <Tip label={s.label} def={s.tip}>
                  <span style={{fontFamily:"var(--font-mono)",fontSize:10,letterSpacing:"0.04em",color:"var(--text-2)",textTransform:"uppercase",fontWeight:600,cursor:"help",borderBottom:"1px dotted var(--text-dim)"}}>{s.label}</span>
                </Tip>
                {/* 2026-05-12 Joe directive: three distinct visual states.
                    1. Numeric score (have data; might be neutral 0 or have a signal +/-X)
                    2. ⊘ icon — "Not in scanned universe" (signal vendor doesn't cover this ticker)
                    3. ⚠ icon — "Data fetch failed" (signal has full universe coverage; null means broken)

                    Which fall into which (when sub_score is null):
                    - analyst, options: vendor-restricted (~2,000 covered names).
                      Null = ticker is genuinely outside the vendor's coverage universe.
                    - insider, technicals, congress, short_interest: full universe
                      (SEC Form 4, Polygon EOD, congress disclosures, FINRA). Null is
                      a fetch failure or pipeline gap, not a coverage thing.

                    Source-of-truth lives in the SIGNAL_COVERAGE map below; if you add
                    a signal, decide which bucket it lives in. */}
                {(() => {
                  // Inline render — keeps the existing surrounding grid intact.
                  if (subStr != null) {
                    return (
                      <Tip
                        label={`${s.label} sub-score`}
                        def={Number(sub) === 0
                          ? `We have the data — the signal is neutral today (no bullish or bearish information from this feed).`
                          : `Composite sub-score from -100 to +100. ${Number(sub) > 0 ? 'Positive = bullish for ' + s.label.toLowerCase() : 'Negative = bearish for ' + s.label.toLowerCase()}.`
                        }
                      >
                        <span style={{display:"inline-flex",flexDirection:"column",alignItems:"flex-end",cursor:"help",width:"100%"}}>
                          <span style={{color: subColor(sub), fontWeight:600, fontFamily:"var(--font-mono)"}}>{subStr}</span>
                          {subUnderline && (
                            <span style={{fontSize:9,color:"var(--text-dim)",fontFamily:"var(--font-mono)",marginTop:1,whiteSpace:"nowrap"}}>{subUnderline}</span>
                          )}
                        </span>
                      </Tip>
                    );
                  }
                  const VENDOR_LIMITED = new Set(["analyst", "options"]);
                  const isVendorLimited = VENDOR_LIMITED.has(s.key);
                  const VENDOR_NAME = {
                    analyst: "broker analyst coverage (~2,000 names)",
                    options: "Unusual Whales options coverage (~2,000 names with active options markets)",
                  };
                  if (isVendorLimited) {
                    return (
                      <Tip
                        label={`${s.label} — not in scanned universe`}
                        def={`This ticker is outside the ${VENDOR_NAME[s.key] || s.label.toLowerCase() + " universe"}. The data feed only covers a subset of US-listed equities; this name isn't one of them. This is expected — not a bug.`}
                      >
                        <span style={{
                          fontFamily:"var(--font-mono)", fontSize:14,
                          color:"var(--text-dim)", fontWeight:400,
                          cursor:"help", borderBottom:"1px dotted var(--text-dim)",
                          textAlign:"right", display:"inline-block", width:"100%",
                          letterSpacing:0,
                        }}
                        aria-label="not in scanned universe">⊘</span>
                      </Tip>
                    );
                  }
                  // Full-universe signal with null sub_score. The producer
                  // sometimes tells us WHY it returned null via
                  // diagnostic.scorer_components[key].reason. Joe directive
                  // 2026-05-12 — surface those reasons honestly instead of
                  // showing a generic "fetch failed" red triangle for what's
                  // actually a coverage-gap or backfill-pending state.
                  const reason = comps && typeof comps === "object" ? comps.reason : null;
                  if (s.key === "technicals" && reason === "too_few_closes") {
                    return (
                      <Tip
                        label="Technicals — backfill pending"
                        def="Need ~60 trading days of daily closes to score this signal; this ticker has fewer than that in our prices database. A backfill is in progress. Once enough history loads, the score will populate on the next scan."
                      >
                        <span style={{
                          fontFamily:"var(--font-mono)", fontSize:13,
                          color:"var(--text-muted)", fontWeight:500,
                          cursor:"help", borderBottom:"1px dotted var(--text-dim)",
                          textAlign:"right", display:"inline-block", width:"100%",
                          letterSpacing:0,
                        }}
                        aria-label="backfill pending">⧗</span>
                      </Tip>
                    );
                  }
                  if (s.key === "insider" && comps && typeof comps === "object" &&
                      ((Number(comps.buy_count || 0) > 0) || (Number(comps.sell_count || 0) > 0))) {
                    // Joe ORCL case 2026-05-12: insider sub_score is null
                    // (the v2_signal computation declined to produce a value),
                    // but the underlying data IS present — buy_count or
                    // sell_count is non-zero. The legacy fallback rendered
                    // the generic "data fetch failed" red triangle, which
                    // contradicts the caption two pixels below it. Honest
                    // render: show that we have the events and that the
                    // composite couldn't make a directional call.
                    const buys = Number(comps.buy_count || 0);
                    const sells = Number(comps.sell_count || 0);
                    return (
                      <Tip
                        label="Insider — events present, no directional read"
                        def={`We have the Form 4 data (${buys} buy${buys===1?"":"s"} · ${sells} sell${sells===1?"":"s"} in 30d), but the composite scorer couldn\u2019t derive a clean bullish/bearish signal from the volume / size pattern. Treat as neutral, not as a fetch failure.`}
                      >
                        <span style={{
                          fontFamily:"var(--font-mono)", fontSize:14,
                          color:"var(--text-muted)", fontWeight:500,
                          cursor:"help", borderBottom:"1px dotted var(--text-dim)",
                          textAlign:"right", display:"inline-block", width:"100%",
                          letterSpacing:0,
                        }}
                        aria-label="events present, neutral read">~</span>
                      </Tip>
                    );
                  }
                  if (s.key === "short_interest" && reason === "no_si_data") {
                    return (
                      <Tip
                        label="Short Interest — not reported"
                        def="FINRA short interest data only covers US domestic equities. This ticker is likely an ADR or foreign issuer where short interest isn't reported through FINRA. This is expected — not a bug."
                      >
                        <span style={{
                          fontFamily:"var(--font-mono)", fontSize:14,
                          color:"var(--text-dim)", fontWeight:400,
                          cursor:"help", borderBottom:"1px dotted var(--text-dim)",
                          textAlign:"right", display:"inline-block", width:"100%",
                          letterSpacing:0,
                        }}
                        aria-label="not reported for this ticker">⊘</span>
                      </Tip>
                    );
                  }
                  return (
                    <Tip
                      label={`${s.label} — data missing`}
                      def={`We should have ${s.label.toLowerCase()} data for this ticker (the underlying feed covers every US-listed equity). The latest scanner run didn't return a value — likely a pipeline gap. Engineering will catch this on the next freshness sweep.`}
                    >
                      <span style={{
                        fontFamily:"var(--font-mono)", fontSize:14,
                        color:"var(--red-text, var(--red))", fontWeight:600,
                        cursor:"help", borderBottom:"1px dotted var(--red-text, var(--red))",
                        textAlign:"right", display:"inline-block", width:"100%",
                        letterSpacing:0,
                      }}
                      aria-label="data fetch failed">⚠</span>
                    </Tip>
                  );
                })()}
                <span style={{color:"var(--text-muted)", fontFamily:"var(--font-mono)", fontSize:11,textAlign:"right"}}>{fmtWeight(w)}</span>
              </div>
            );
          })}
        </div>
        <div style={{fontSize:10.5,color:"var(--text-dim)",fontStyle:"italic",lineHeight:1.4}}>
          Today's per-signal readings live in the dedicated tiles below (Insider Activity, Analyst Actions, Short Interest, Technical Indicators, Unusual Flow). Backtest stats and weight calibration live on the Methodology page.
        </div>
      </div>
    );
    return { state, value, meta, detail, _comps: comps, _subs: subs, _weights: weights };
  })();

  // ─── Dedicated per-signal tiles (v5.1 e) ────────────────────────────────
  // Joe's UX complaint: Technical Indicators and Unusual Flow already exist
  // as separate tiles; Insider / Analyst / Short Interest deserve the same
  // treatment instead of being crammed into MacroTilt Signal. These three
  // tiles read straight from mtSignal.diagnostic.scorer_components.
  const sig = mtSignal;
  const subsForTiles    = (sig && sig.sub_scores) || {};
  const weightsForTiles = (sig && sig.weights_used) || {};
  const compsForTiles   = (sig && sig.diagnostic && sig.diagnostic.scorer_components) || {};

  const subStateColor = (v) => {
    if (v == null || !Number.isFinite(Number(v))) return "neutral";
    const n = Number(v);
    if (n >=  50) return "green";
    if (n >=  20) return "amber";
    if (n <= -50) return "red";
    if (n <= -20) return "amber";
    return "neutral";
  };
  const fmtSubSimple = (v) => {
    if (v == null || !Number.isFinite(Number(v))) return "—";
    const n = Number(v);
    return `${n > 0 ? "+" : ""}${n.toFixed(0)}`;
  };
  const fmtMoneyT = (n) => {
    const x = Number(n);
    if (!Number.isFinite(x) || x === 0) return null;
    if (Math.abs(x) >= 1e9) return `$${(x/1e9).toFixed(1)}B`;
    if (Math.abs(x) >= 1e6) return `$${(x/1e6).toFixed(1)}M`;
    if (Math.abs(x) >= 1e3) return `$${(x/1e3).toFixed(0)}K`;
    return `$${x.toFixed(0)}`;
  };

  // Insider Activity ----------------------------------------------------
  // v5.2 (a): distinguish "data unavailable" (pipeline gap; components
  // block missing or has no buy_count field at all) from "no signal"
  // (data fetched cleanly, just no Form 4 events to report).
  const insiderTile = (() => {
    if (!sig) return { state: "loading", value: "…", meta: "Loading insider signal", detail: null };
    const compsBlock = (sig && sig.diagnostic && sig.diagnostic.scorer_components) || null;
    const c = compsForTiles.insider || null;
    const sub = subsForTiles.insider;
    const w   = weightsForTiles.insider;
    // Pipeline gap: the scan didn't write an insider components block at all.
    if (!c || c.buy_count == null) {
      // 2026-05-12 Joe directive — full coverage signal (SEC Form 4 covers
      // every US-listed equity), so null = pipeline gap, not a coverage
      // gap. Tile renders ⚠ to match the summary row above.
      return { state: "neutral", value: "⚠", meta: "Data missing — Form 4 ingest didn't return rows for this ticker. Engineering will catch on next freshness sweep.", detail: null };
    }
    const buys  = Number(c.buy_count || 0);
    const sells = Number(c.sell_count || 0);
    // Confirmed quiet: data fetched, no Form 4 events.
    if (buys === 0 && sells === 0) {
      return { state: "neutral", value: "0", meta: "No Form 4 buys or sells in the last 30 days", detail: null };
    }
    // 2026-05-12 — when sub is null but we have events, that means the v2
    // signal returned None (typically because remaining transactions are all
    // 10b5-1 routine sales after filtering, or any other filtered-to-zero
    // outcome). The honest tile value is "0" (data fetched, signal nets
    // out) with the bullets describing what was filtered, not "—".
    const value = sub != null ? fmtSubSimple(sub) : "0";
    const buy$  = fmtMoneyT(c.buy_dollar_total);
    const sell$ = fmtMoneyT(c.sell_dollar_total);
    const bullets = [];
    if (buys)  bullets.push(`${buys} buy${buys===1?"":"s"}${buy$  ? ` (${buy$})`  : ""}`);
    if (sells) bullets.push(`${sells} sell${sells===1?"":"s"}${sell$ ? ` (${sell$})` : ""}`);
    if (c.first_buy_fires) bullets.push("first buy in 12 months");
    const meta = bullets.length ? bullets.join(" · ") : "no Form 4 events";
    // v5.4 (item 11): list the individual Form 4 events when expanded.
    const fmtDate = d => {
      if (!d) return "";
      const dt = new Date(String(d).slice(0,10) + "T00:00:00Z");
      return dt.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    };
    const events = [...(insiderBuys || []).map(e => ({...e, _dir: 'buy'})),
                    ...(insiderSells || []).map(e => ({...e, _dir: 'sell'}))]
      .sort((a, b) => String(b.date || b.transaction_date || '').localeCompare(String(a.date || a.transaction_date || '')))
      .slice(0, 12);
    const eventList = events.length ? (
      <div style={{marginTop:6,gridColumn:"1 / -1"}}>
        <div style={{fontFamily:"var(--font-mono)",fontSize:9.5,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.12em",color:"var(--text-dim)",marginBottom:4}}>
          Recent Form 4 events
        </div>
        {events.map((e, i) => {
          const who = e.name || e.officer_name || e.insider || "Insider";
          const date = fmtDate(e.date || e.transaction_date);
          const amt = e.value || e.dollar_value || e.amount;
          const dollars = amt ? fmtMoneyT(amt) : null;
          const dir = e._dir === 'buy' ? "BUY" : "SELL";
          const col = e._dir === 'buy' ? "var(--green-text, var(--green))" : "var(--red-text, var(--red))";
          return (
            <div key={i} style={{display:"grid",gridTemplateColumns:"42px 1fr auto auto",gap:8,alignItems:"baseline",padding:"3px 0",fontSize:11.5,borderBottom: i < events.length - 1 ? "1px solid var(--border-faint, var(--border))" : "none"}}>
              <span style={{fontFamily:"var(--font-mono)",fontSize:9.5,color: col,fontWeight:600}}>{dir}</span>
              <span style={{color:"var(--text-2)"}} title={who}>{String(who).slice(0,32)}</span>
              <span style={{fontFamily:"var(--font-mono)",color:"var(--text-muted)"}}>{date}</span>
              <span style={{fontFamily:"var(--font-mono)",fontWeight:600,color:col,minWidth:60,textAlign:"right"}}>{dollars || "—"}</span>
            </div>
          );
        })}
      </div>
    ) : null;
    const detail = (
      <div style={{display:"grid",gridTemplateColumns:"1fr auto",gap:6,fontSize:12,lineHeight:1.45}}>
        <span style={{color:"var(--text-muted)"}}>Sub-score</span><span style={{fontFamily:"var(--font-mono)",fontWeight:600,textAlign:"right"}}>{value}</span>
        <span style={{color:"var(--text-muted)"}}>Weight in composite</span><span style={{fontFamily:"var(--font-mono)",fontWeight:600,textAlign:"right"}}>{Number.isFinite(Number(w)) ? `${(Number(w)*100).toFixed(1)}%` : "—"}</span>
        <span style={{color:"var(--text-muted)"}}>Buys</span><span style={{textAlign:"right"}}>{buys}{buy$  ? ` (${buy$})`  : ""}</span>
        <span style={{color:"var(--text-muted)"}}>Sells (ex-10b5-1)</span><span style={{textAlign:"right"}}>{sells}{sell$ ? ` (${sell$})` : ""}</span>
        <span style={{color:"var(--text-muted)"}}>First buy in 12 months?</span><span style={{textAlign:"right"}}>{c.first_buy_fires ? "yes" : "no"}</span>
        {c.buy_bps_of_mcap != null && (
          <><span style={{color:"var(--text-muted)"}}>Buy $ as bps of mkt cap</span><span style={{fontFamily:"var(--font-mono)",textAlign:"right"}}>{Number(c.buy_bps_of_mcap).toFixed(2)} bps</span></>
        )}
        {eventList}
        <span style={{gridColumn:"1 / -1",color:"var(--text-dim)",fontSize:10.5,fontStyle:"italic",marginTop:4}}>
          Source: SEC EDGAR Form 4, last 30 days. Sells are filtered to remove 10b5-1 routine plan disposals.
        </span>
      </div>
    );
    return { state: subStateColor(sub), value, meta, detail };
  })();

  // Congress Trades --------------------------------------------------------
  // v5.4 (item 11): dedicated tile, separate from Unusual Flow. Shows the
  // disclosed trades (member, date, direction, amount).
  const congressTile = (() => {
    const cBuys  = congressBuys  || [];
    const cSells = congressSells || [];
    const compC  = compsForTiles.congress || null;
    const sub    = subsForTiles.congress;
    const w      = weightsForTiles.congress;
    if ((!compC || compC.buy_count == null) && cBuys.length === 0 && cSells.length === 0) {
      // 2026-05-12 — full coverage signal (every disclosed congressional trade
      // lands in congress_trades_daily), so null = pipeline gap.
      return { state: "neutral", value: "⚠", meta: "Data missing — congress disclosures ingest didn't return rows for this ticker. Engineering will catch on next freshness sweep.", detail: null };
    }
    const buys  = compC ? Number(compC.buy_count  || 0) : cBuys.length;
    const sells = compC ? Number(compC.sell_count || 0) : cSells.length;
    if (buys === 0 && sells === 0) {
      return { state: "neutral", value: "0", meta: "No disclosed congressional trades in the last 90 days", detail: null };
    }
    const value = sub != null ? fmtSubSimple(sub) : `${buys}/${sells}`;
    const meta = [
      buys  ? `${buys} buy${buys===1?"":"s"}`   : null,
      sells ? `${sells} sell${sells===1?"":"s"}` : null,
      compC?.unique_buyers ? `${compC.unique_buyers} unique members` : null,
    ].filter(Boolean).join(" · ") || "no congress signal";
    const fmtD = d => {
      if (!d) return "";
      const dt = new Date(String(d).slice(0,10) + "T00:00:00Z");
      return dt.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    };
    const allRows = [...cBuys.map(e => ({...e,_d:'buy'})), ...cSells.map(e => ({...e,_d:'sell'}))]
      .sort((a,b) => String(b.trade_date||b.disclosure_date||b.date||'').localeCompare(String(a.trade_date||a.disclosure_date||a.date||'')))
      .slice(0, 12);
    const eventList = allRows.length ? (
      <div style={{marginTop:6,gridColumn:"1 / -1"}}>
        <div style={{fontFamily:"var(--font-mono)",fontSize:9.5,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.12em",color:"var(--text-dim)",marginBottom:4}}>
          Disclosed congressional trades
        </div>
        {allRows.map((e, i) => {
          const who = e.member || e.representative || e.senator || e.name || "Member";
          const date = fmtD(e.trade_date || e.disclosure_date || e.date);
          const amt = e.amount_max || e.amount || e.amount_range || e.value;
          const dollars = (typeof amt === 'number') ? fmtMoneyT(amt) : (typeof amt === 'string' ? amt : null);
          const dir = e._d === 'buy' ? "BUY" : "SELL";
          const col = e._d === 'buy' ? "var(--green-text, var(--green))" : "var(--red-text, var(--red))";
          return (
            <div key={i} style={{display:"grid",gridTemplateColumns:"42px 1fr auto auto",gap:8,alignItems:"baseline",padding:"3px 0",fontSize:11.5,borderBottom: i < allRows.length - 1 ? "1px solid var(--border-faint, var(--border))" : "none"}}>
              <span style={{fontFamily:"var(--font-mono)",fontSize:9.5,color:col,fontWeight:600}}>{dir}</span>
              <span style={{color:"var(--text-2)"}} title={who}>{String(who).slice(0,32)}</span>
              <span style={{fontFamily:"var(--font-mono)",color:"var(--text-muted)"}}>{date}</span>
              <span style={{fontFamily:"var(--font-mono)",color:col,minWidth:60,textAlign:"right"}}>{dollars || "—"}</span>
            </div>
          );
        })}
      </div>
    ) : null;
    const detail = (
      <div style={{display:"grid",gridTemplateColumns:"1fr auto",gap:6,fontSize:12,lineHeight:1.45}}>
        <span style={{color:"var(--text-muted)"}}>Sub-score</span><span style={{fontFamily:"var(--font-mono)",fontWeight:600,textAlign:"right"}}>{sub != null ? fmtSubSimple(sub) : "—"}</span>
        <span style={{color:"var(--text-muted)"}}>Weight in composite</span><span style={{fontFamily:"var(--font-mono)",fontWeight:600,textAlign:"right"}}>{Number.isFinite(Number(w)) ? `${(Number(w)*100).toFixed(1)}%` : "—"}</span>
        <span style={{color:"var(--text-muted)"}}>Buys</span><span style={{textAlign:"right"}}>{buys}</span>
        <span style={{color:"var(--text-muted)"}}>Sells</span><span style={{textAlign:"right"}}>{sells}</span>
        {compC?.unique_buyers != null && <><span style={{color:"var(--text-muted)"}}>Unique members</span><span style={{textAlign:"right"}}>{compC.unique_buyers}</span></>}
        {eventList}
        <span style={{gridColumn:"1 / -1",color:"var(--text-dim)",fontSize:10.5,fontStyle:"italic",marginTop:4}}>
          Source: STOCK Act disclosures, last 90 days. Amounts are reported as ranges; the upper bound is shown.
        </span>
      </div>
    );
    return { state: sub == null ? "neutral" : subStateColor(sub), value, meta, detail };
  })();

  // Options Flow ------------------------------------------------------
  // v5.4 (item 11): dedicated tile for unusual options flow events
  // (calls / puts / sweeps). Split from the lumped Unusual Flow tile.
  const optionsTile = (() => {
    const fCalls = flowCalls || [];
    const fPuts  = flowPuts  || [];
    const compO  = compsForTiles.options || null;
    const sub    = subsForTiles.options;
    const w      = weightsForTiles.options;
    if (!compO && fCalls.length === 0 && fPuts.length === 0) {
      // 2026-05-12 — Options Flow is VENDOR-RESTRICTED (Unusual Whales tracks
      // ~2,000 names with active options markets). Null = ticker outside that
      // universe, not a pipeline gap. Render ⊘.
      return { state: "neutral", value: "⊘", meta: "Not in scanned universe — this ticker is outside Unusual Whales' options coverage (~2,000 names with active options markets). Expected, not a bug.", detail: null };
    }
    const callCt = fCalls.length;
    const putCt  = fPuts.length;
    // captionFor.options is the shared truth — same function the row
    // caption above uses. Reads alert counts → premium → ask-side in
    // priority order.
    const sharedCap = captionFor.options(compO);

    // ── Detail builder (Joe directive 2026-05-12): every tile opens
    // with details — the Options tile is no exception. Build the detail
    // panel from compO + alert events whenever we have any of them, and
    // attach it to every "we have data" return below.
    const fmtD = d => {
      if (!d) return "";
      const dt = new Date(String(d).slice(0,10) + "T00:00:00Z");
      return dt.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    };
    const allEvents = [...fCalls.map(e => ({...e,_d:'call'})), ...fPuts.map(e => ({...e,_d:'put'}))]
      .sort((a,b) => String(b.alert_time||b.date||'').localeCompare(String(a.alert_time||a.date||'')))
      .slice(0, 12);
    const eventList = allEvents.length ? (
      <div style={{marginTop:6,gridColumn:"1 / -1"}}>
        <div style={{fontFamily:"var(--font-mono)",fontSize:9.5,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.12em",color:"var(--text-dim)",marginBottom:4}}>
          Unusual flow alerts
        </div>
        {allEvents.map((e, i) => {
          const date = fmtD(e.alert_time || e.date);
          const strike = e.strike || e.strike_price;
          const expiry = e.expiry || e.expiration;
          const prem   = e.total_premium || e.premium || e.notional;
          const dollars = prem ? fmtMoneyT(prem) : null;
          const dir = e._d === 'call' ? "CALL" : "PUT";
          const col = e._d === 'call' ? "var(--green-text, var(--green))" : "var(--red-text, var(--red))";
          const desc = strike ? `$${strike}${expiry ? ` exp ${expiry.slice(0,10)}` : ""}` : (e.title || "alert");
          return (
            <div key={i} style={{display:"grid",gridTemplateColumns:"42px 1fr auto auto",gap:8,alignItems:"baseline",padding:"3px 0",fontSize:11.5,borderBottom: i < allEvents.length - 1 ? "1px solid var(--border-faint, var(--border))" : "none"}}>
              <span style={{fontFamily:"var(--font-mono)",fontSize:9.5,color:col,fontWeight:600}}>{dir}</span>
              <span style={{color:"var(--text-2)"}} title={desc}>{String(desc).slice(0,32)}</span>
              <span style={{fontFamily:"var(--font-mono)",color:"var(--text-muted)"}}>{date}</span>
              <span style={{fontFamily:"var(--font-mono)",color:col,minWidth:60,textAlign:"right"}}>{dollars || "—"}</span>
            </div>
          );
        })}
      </div>
    ) : null;
    const callPrem = compO ? Number(compO.call_premium || 0) : 0;
    const putPrem  = compO ? Number(compO.put_premium  || 0) : 0;
    const askPrem  = compO ? Number(compO.ask_side_premium || 0) : 0;
    const bidPrem  = compO ? Number(compO.bid_side_premium || 0) : 0;
    const unusualN = compO ? Number(compO.unusual_count || 0) : 0;
    const ratio    = compO ? compO.ratio_log10 : null;
    const askBias  = compO ? compO.ask_bias : null;
    const buildDetail = () => (
      <div style={{display:"grid",gridTemplateColumns:"1fr auto",gap:6,fontSize:12,lineHeight:1.45}}>
        <span style={{color:"var(--text-muted)"}}>Sub-score</span><span style={{fontFamily:"var(--font-mono)",fontWeight:600,textAlign:"right"}}>{sub != null ? fmtSubSimple(sub) : "—"}</span>
        <span style={{color:"var(--text-muted)"}}>Weight in composite</span><span style={{fontFamily:"var(--font-mono)",fontWeight:600,textAlign:"right"}}>{Number.isFinite(Number(w)) ? `${(Number(w)*100).toFixed(1)}%` : "—"}</span>
        {compO && <>
          <span style={{color:"var(--text-muted)"}}>Unusual events</span><span style={{textAlign:"right",fontFamily:"var(--font-mono)"}}>{unusualN}</span>
          {callPrem > 0 && <><span style={{color:"var(--text-muted)"}}>Call premium</span><span style={{textAlign:"right",fontFamily:"var(--font-mono)",color:"var(--green-text, var(--green))"}}>{fmtMoneyT(callPrem)}</span></>}
          {putPrem  > 0 && <><span style={{color:"var(--text-muted)"}}>Put premium</span><span style={{textAlign:"right",fontFamily:"var(--font-mono)",color:"var(--red-text, var(--red))"}}>{fmtMoneyT(putPrem)}</span></>}
          {askPrem  > 0 && <><span style={{color:"var(--text-muted)"}}>Ask-side premium</span><span style={{textAlign:"right",fontFamily:"var(--font-mono)"}}>{fmtMoneyT(askPrem)}</span></>}
          {bidPrem  > 0 && <><span style={{color:"var(--text-muted)"}}>Bid-side premium</span><span style={{textAlign:"right",fontFamily:"var(--font-mono)"}}>{fmtMoneyT(bidPrem)}</span></>}
          {Number.isFinite(Number(ratio)) && <><span style={{color:"var(--text-muted)"}}>Call/put premium ratio</span><span style={{textAlign:"right",fontFamily:"var(--font-mono)"}}>10^{Number(ratio).toFixed(2)}</span></>}
          {Number.isFinite(Number(askBias)) && <><span style={{color:"var(--text-muted)"}}>Ask-side bias</span><span style={{textAlign:"right",fontFamily:"var(--font-mono)"}}>{(Number(askBias)*100).toFixed(0)}%</span></>}
          {compO.sweep_count != null && <><span style={{color:"var(--text-muted)"}}>Sweep orders</span><span style={{textAlign:"right",fontFamily:"var(--font-mono)"}}>{compO.sweep_count}</span></>}
        </>}
        <span style={{color:"var(--text-muted)"}}>Call alerts</span><span style={{textAlign:"right",fontFamily:"var(--font-mono)",color:callCt>0?"var(--green-text, var(--green))":"var(--text-2)"}}>{callCt}</span>
        <span style={{color:"var(--text-muted)"}}>Put alerts</span><span style={{textAlign:"right",fontFamily:"var(--font-mono)",color:putCt>0?"var(--red-text, var(--red))":"var(--text-2)"}}>{putCt}</span>
        {eventList}
        <span style={{gridColumn:"1 / -1",color:"var(--text-dim)",fontSize:10.5,fontStyle:"italic",marginTop:4}}>
          Source: Unusual Whales unusual options activity feed. Score blends unusual-event count, call/put premium ratio, ask-side bias, and sweep order count.
        </span>
      </div>
    );

    if (callCt === 0 && putCt === 0) {
      if (sharedCap && sharedCap !== "no unusual flow today") {
        const v = sub != null ? fmtSubSimple(sub) : (unusualN > 0 ? String(unusualN) : "—");
        return { state: subStateColor(sub), value: v, meta: sharedCap, detail: buildDetail() };
      }
      // True quiet — compO exists but everything's zero. Still expose the
      // detail panel so the user can SEE that everything's zero (instead
      // of having to take "no flow" on faith).
      return { state: "neutral", value: "0", meta: "No unusual options flow events in last scan", detail: compO ? buildDetail() : null };
    }
    const value = sub != null ? fmtSubSimple(sub) : `${callCt}/${putCt}`;
    const meta = sharedCap || `${callCt} call · ${putCt} put alerts`;
    return { state: sub == null ? "neutral" : subStateColor(sub), value, meta, detail: buildDetail() };
  })();

  // Analyst Actions -----------------------------------------------------
  const analystTile = (() => {
    if (!sig) return { state: "loading", value: "…", meta: "Loading analyst signal", detail: null };
    const c = compsForTiles.analyst || null;
    const sub = subsForTiles.analyst;
    const w   = weightsForTiles.analyst;
    if (!c || c.action_count == null) {
      // 2026-05-12 — Analyst Actions is VENDOR-RESTRICTED (~2,000 covered
      // names with broker analyst coverage). Null usually = ticker not
      // covered by analysts, not a pipeline gap. Render ⊘.
      return { state: "neutral", value: "⊘", meta: "Not in scanned universe — this ticker is outside broker analyst coverage (~2,000 covered names). Expected, not a bug.", detail: null };
    }
    const n = Number(c.action_count || 0);
    if (n === 0) {
      return { state: "neutral", value: "0", meta: "No analyst upgrades, downgrades, or price-target changes in the last 90 days", detail: null };
    }
    const value = fmtSubSimple(sub);
    const gap = c.pt_gap_pct;
    const ups   = Number(c.upgrades   || 0);
    const downs = Number(c.downgrades || 0);
    const inits = Number(c.initiations || 0);
    const mts   = Number(c.maintained || 0);
    // captionFor.analyst is the shared truth — same function the row above uses.
    const meta = captionFor.analyst(c) || "no analyst signal";
    const detail = (
      <div style={{display:"grid",gridTemplateColumns:"1fr auto",gap:6,fontSize:12,lineHeight:1.45}}>
        <span style={{color:"var(--text-muted)"}}>Sub-score</span><span style={{fontFamily:"var(--font-mono)",fontWeight:600,textAlign:"right"}}>{value}</span>
        <span style={{color:"var(--text-muted)"}}>Weight in composite</span><span style={{fontFamily:"var(--font-mono)",fontWeight:600,textAlign:"right"}}>{Number.isFinite(Number(w)) ? `${(Number(w)*100).toFixed(1)}%` : "—"}</span>
        <span style={{color:"var(--text-muted)"}}>Total actions in last 90d</span><span style={{textAlign:"right"}}>{n}</span>
        <span style={{color:"var(--text-muted)"}}>Upgrades</span><span style={{textAlign:"right",color: ups > 0 ? "var(--green-text, var(--green))" : "var(--text-2)"}}>{ups}</span>
        <span style={{color:"var(--text-muted)"}}>Downgrades</span><span style={{textAlign:"right",color: downs > 0 ? "var(--red-text, var(--red))" : "var(--text-2)"}}>{downs}</span>
        <span style={{color:"var(--text-muted)"}}>Initiations</span><span style={{textAlign:"right"}}>{inits}</span>
        <span style={{color:"var(--text-muted)"}}>Maintained / reiterated</span><span style={{textAlign:"right"}}>{mts}</span>
        {c.spot != null && <><span style={{color:"var(--text-muted)"}}>Spot</span><span style={{textAlign:"right",fontFamily:"var(--font-mono)"}}>${Number(c.spot).toFixed(2)}</span></>}
        {c.avg_target != null && <><span style={{color:"var(--text-muted)"}}>Avg price target</span><span style={{textAlign:"right",fontFamily:"var(--font-mono)"}}>${Number(c.avg_target).toFixed(2)}</span></>}
        {gap != null && Number.isFinite(Number(gap)) && (
          <><span style={{color:"var(--text-muted)"}}>Target vs spot</span><span style={{textAlign:"right",fontFamily:"var(--font-mono)",fontWeight:600,color:Number(gap)>0?"var(--green-text,var(--green))":Number(gap)<0?"var(--red-text,var(--red))":"var(--text)"}}>{Number(gap)>=0?"+":""}{Number(gap).toFixed(1)}%</span></>
        )}
        <span style={{gridColumn:"1 / -1",color:"var(--text-dim)",fontSize:10.5,fontStyle:"italic",marginTop:4}}>
          Net upgrades minus downgrades, weighted by analyst tier; combined with the average price-target gap to spot.
        </span>
      </div>
    );
    return { state: subStateColor(sub), value, meta, detail };
  })();

  // Short Interest ------------------------------------------------------
  const siTile = (() => {
    if (!sig) return { state: "loading", value: "…", meta: "Loading short interest", detail: null };
    const c = compsForTiles.short_interest || null;
    const sub = subsForTiles.short_interest;
    const w   = weightsForTiles.short_interest;
    if (!c || (c.latest_si_pct_of_float == null && c.latest_ctb_pct == null)) {
      // 2026-05-12 (revision) — Joe directive: when the v5 scorer set
      // reason='no_si_data' it's telling us this ticker isn't covered by
      // FINRA at all (ADRs / foreign issuers), not that the ingest broke.
      // Show the "not covered" circle-slash with honest copy in that case;
      // keep the red triangle for the genuine pipeline-gap case.
      if (c && c.reason === "no_si_data") {
        return { state: "neutral", value: "⊘", meta: "Not reported — FINRA short interest only covers US domestic equities. This ticker is likely an ADR or foreign issuer where short interest isn't reported through FINRA.", detail: null };
      }
      return { state: "neutral", value: "⚠", meta: "Data missing — FINRA short interest ingest didn't return rows for this ticker. Engineering will catch on next freshness sweep.", detail: null };
    }
    const siPct = c.latest_si_pct_of_float;
    const ctb   = c.latest_ctb_pct;
    const regime = c.regime;
    const value = fmtSubSimple(sub);
    // captionFor.short_interest is the shared truth — same function the row above uses.
    const meta = captionFor.short_interest(c) || "no short interest signal";
    const detail = (
      <div style={{display:"grid",gridTemplateColumns:"1fr auto",gap:6,fontSize:12,lineHeight:1.45}}>
        <span style={{color:"var(--text-muted)"}}>Sub-score</span><span style={{fontFamily:"var(--font-mono)",fontWeight:600,textAlign:"right"}}>{value}</span>
        <span style={{color:"var(--text-muted)"}}>Weight in composite</span><span style={{fontFamily:"var(--font-mono)",fontWeight:600,textAlign:"right"}}>{Number.isFinite(Number(w)) ? `${(Number(w)*100).toFixed(1)}%` : "—"}</span>
        {siPct != null && <><span style={{color:"var(--text-muted)"}}>% of float short (latest)</span><span style={{textAlign:"right",fontFamily:"var(--font-mono)"}}>{Number(siPct).toFixed(1)}%</span></>}
        {c.prev_si_pct_of_float != null && <><span style={{color:"var(--text-muted)"}}>% of float short (prior)</span><span style={{textAlign:"right",fontFamily:"var(--font-mono)"}}>{Number(c.prev_si_pct_of_float).toFixed(1)}%</span></>}
        {c.rising_si_pp != null && <><span style={{color:"var(--text-muted)"}}>Change in SI %</span><span style={{textAlign:"right",fontFamily:"var(--font-mono)"}}>{Number(c.rising_si_pp) >= 0 ? "+" : ""}{Number(c.rising_si_pp).toFixed(2)}pp</span></>}
        {ctb != null && <><span style={{color:"var(--text-muted)"}}>Cost-to-borrow</span><span style={{textAlign:"right",fontFamily:"var(--font-mono)"}}>{Number(ctb).toFixed(2)}%</span></>}
        {c.days_to_earnings != null && <><span style={{color:"var(--text-muted)"}}>Days to earnings</span><span style={{textAlign:"right",fontFamily:"var(--font-mono)"}}>{Number(c.days_to_earnings)}</span></>}
        {regime && <><span style={{color:"var(--text-muted)"}}>Regime</span><span style={{textAlign:"right"}}>{String(regime).replace(/_/g, " ")}</span></>}
        <span style={{gridColumn:"1 / -1",color:"var(--text-dim)",fontSize:10.5,fontStyle:"italic",marginTop:4}}>
          Three regimes: high SI + rising cost-to-borrow above 50-SMA = bearish; high SI + cheap borrow into earnings = squeeze setup; falling SI + rising price = capitulation.
        </span>
      </div>
    );
    return { state: subStateColor(sub), value, meta, detail };
  })();

  const macroTile = (() => {
    if (!cycleBoardSnap) return { state: "loading", value: "…", meta: "Loading cycle board", detail: null };
    const mechs = cycleBoardSnap.mechanisms || [];
    const live = mechs.filter(m => Number.isFinite(Number(m.score)));
    if (live.length === 0) return { state: "loading", value: "…", meta: "No mechanism scores yet", detail: null };
    const avg = live.reduce((a,m)=>a + Number(m.score), 0) / live.length;
    const rounded = Math.round(avg);
    // 0-25 Risk-on (green), 25-50 Neutral (amber), 50-75 Caution (amber), 75-100 Risk-off (red).
    const state = avg < 25 ? "green" : avg < 75 ? "amber" : "red";
    const label = avg < 25 ? "Risk-on" : avg < 50 ? "Neutral" : avg < 75 ? "Caution" : "Risk-off";
    const value = `${rounded}/100`;
    const meta = `${label} regime · ${live.length}/${mechs.length} mechanisms live`;
    const lev   = Number(v9Alloc?.leverage);
    const eqShr = Number(v9Alloc?.equity_share);
    const levTxt = Number.isFinite(lev) && Number.isFinite(eqShr)
      ? `Leverage ${lev.toFixed(2)}× · equity share ${(eqShr*100).toFixed(0)}%${eqShr < 1 ? ` · defensive sleeve ${((1-eqShr)*100).toFixed(0)}%` : " · no defensive sleeve"}.`
      : null;
    const implication = state === "green"
      ? `Macro tailwind — most mechanisms read benign. No model-level reason to underweight ${ticker}.`
      : state === "red"
      ? `Macro stress — multiple mechanisms in the upper quartile. Defensive posture warranted; ${ticker} weighs against the regime.`
      : `Mixed regime — selective heat in a few mechanisms. ${ticker} should be evaluated on bottom-up signals (the rest of the rail).`;
    return {
      state, value, meta,
      detail: (
        <div style={{display:"flex",flexDirection:"column",gap:6}}>
          <div>{mechs.map((m, i) => {
            const s = Number.isFinite(Number(m.score)) ? Math.round(Number(m.score)) : null;
            const nm = m.name || m.id || "—";
            return <span key={i}><b>{nm}</b> {s == null ? "—" : s}{i < mechs.length - 1 ? " · " : ""}</span>;
          })}</div>
          {levTxt && <div style={{color:"var(--text-2)"}}>{levTxt}</div>}
          <div style={{fontStyle:"italic",color:"var(--accent)"}}>{implication}</div>
        </div>
      ),
    };
  })();

  // Tile 2 — Asset Tilt
  const tiltTile = (() => {
    if (!v9Alloc) return { state: "loading", value: "…", meta: "Loading allocation model", detail: null };
    const picks = v9Alloc.picks || [];
    const defens = v9Alloc.defensive || [];
    const directPick = picks.find(p => (p.ticker || "").toUpperCase() === (ticker || "").toUpperCase())
                    || defens.find(p => (p.ticker || "").toUpperCase() === (ticker || "").toUpperCase());
    const sectorPick = sector ? picks.find(p => (p.name || "").toLowerCase() === sector.toLowerCase()
                                              || (p.fund || "").toLowerCase().includes(sector.toLowerCase())) : null;
    const owns = (heldIn?.length || 0) > 0;
    const align = owns
      ? <div style={{fontStyle:"italic",color:"var(--accent)"}}>Matches your held position.</div>
      : null;
    if (directPick) {
      const w = (Number(directPick.weight) || 0) * 100;
      const state = w >= 5 ? "green" : "amber";
      return {
        state, value: `${w >= 0 ? "+" : ""}${w.toFixed(1)}% of model`,
        meta: `Direct pick · ${directPick.fund || directPick.name || ticker}`,
        detail: (
          <div style={{display:"flex",flexDirection:"column",gap:6}}>
            <div>The model leverages this name directly. Weight <b>{w.toFixed(1)}%</b> of total portfolio. Indicator rank <b>{directPick.indicator_rank ?? "—"}</b>, momentum rank <b>{directPick.momentum_rank ?? "—"}</b>.</div>
            {align}
          </div>
        ),
      };
    }
    if (sectorPick) {
      const w = (Number(sectorPick.weight) || 0) * 100;
      return {
        state: w >= 5 ? "green" : "amber",
        value: `${w >= 0 ? "+" : ""}${w.toFixed(1)}% sector O/W`,
        meta: `${sector} sleeve · proxy ${sectorPick.ticker}`,
        detail: (
          <div style={{display:"flex",flexDirection:"column",gap:6}}>
            <div>The model is overweight the <b>{sector}</b> sector via {sectorPick.fund || sectorPick.ticker} ({w.toFixed(1)}% of portfolio). The model leans toward this sector but does not single-name {ticker}.</div>
            {align}
          </div>
        ),
      };
    }
    return {
      state: "loading", value: "Not in model", meta: "Outside the model's picks",
      detail: (
        <div style={{display:"flex",flexDirection:"column",gap:6}}>
          <div>The model has not selected {ticker}{sector ? ` or its sector (${sector})` : ""} this rebalance.</div>
          <div style={{fontStyle:"italic",color:"var(--accent)"}}>{owns ? "Holding it is a discretionary bet vs the model." : "Adding it would be a discretionary bet vs the model."}</div>
        </div>
      ),
    };
  })();

  // Tile 3 — Technical Indicators
  //
  // v5.1 fix (2026-05-10): when opened from the v5 Trading Opportunities
  // page, the legacy `tech` (from scanData.signals.technicals) and
  // `composite.sections.technicals` are often empty for mega-cap names
  // not in the v4 screener universe. We now fall back to the v5
  // `mtSignal.diagnostic.scorer_components.technicals` block, which is
  // populated for every name in the v5 universe (~3,300 names).
  const techTile = (() => {
    const techSec = composite?.sections?.technicals;
    // v5 fallback: pull the technicals component block when legacy is missing.
    const v5Tech = (mtSignal && mtSignal.diagnostic && mtSignal.diagnostic.scorer_components)
      ? (mtSignal.diagnostic.scorer_components.technicals || {})
      : {};
    // Prefer the v5 sub-score (range -100..+100) when no legacy composite score is present.
    const v5SubScore = (mtSignal && mtSignal.sub_scores) ? mtSignal.sub_scores.technicals : null;
    const score = techSec?.score != null ? techSec.score
                : (v5SubScore != null ? Number(v5SubScore) : null);
    const state = score == null ? "loading"
                : score >= 25 ? "green"
                : score <= -25 ? "red"
                : "amber";
    const value = score == null ? "…" : fmtSigned(score);
    const rows = [];

    // ── v5-component-sourced rows (mega-cap fallback path) ──
    // Mirror the rows the legacy block produces so the layout looks the same.
    if (v5Tech.rsi14 != null && tech?.rsi_14 == null) {
      const rsi = Number(v5Tech.rsi14);
      rows.push({ label: "RSI(14)", val: rsi.toFixed(0), color: rsi >= 70 ? "red" : rsi <= 30 ? "amber" : "green" });
    }
    if (v5Tech.sma50 != null && v5Tech.today_close != null && tech?.pct_vs_50ma == null) {
      const c = Number(v5Tech.today_close), s = Number(v5Tech.sma50);
      if (s > 0) {
        const p = ((c - s) / s) * 100;
        rows.push({ label: "% vs 50d MA", val: `${p>=0?"+":""}${p.toFixed(1)}%`, color: p > 5 ? "green" : p < -5 ? "red" : "amber" });
      }
    }
    if (v5Tech.sma200 != null && v5Tech.today_close != null && tech?.pct_vs_200ma == null) {
      const c = Number(v5Tech.today_close), s = Number(v5Tech.sma200);
      if (s > 0) {
        const p = ((c - s) / s) * 100;
        rows.push({ label: "% vs 200d MA", val: `${p>=0?"+":""}${p.toFixed(1)}%`, color: p > 10 ? "green" : p < -10 ? "red" : "amber" });
      }
    }
    if (v5Tech.bb_bandwidth != null) {
      const bw = Number(v5Tech.bb_bandwidth) * 100;
      // Squeeze regime: band-width < 5% historically tight.
      rows.push({ label: "Bollinger band-width", val: `${bw.toFixed(2)}%`, color: bw < 5 ? "amber" : "green" });
    }
    if (v5Tech.rvol_20d != null && tech?.vol_surge == null) {
      const rv = Number(v5Tech.rvol_20d);
      rows.push({ label: "Relative volume (20d)", val: `${rv.toFixed(2)}× avg`, color: rv >= 1.5 ? "green" : rv < 0.7 ? "amber" : "amber" });
    }
    // Render every technical the scanner emits — the data shape is fixed in
    // trading-scanner/scanner/screener_unusual_whales.py / technicals.py and
    // we surface every field that's populated. Color = direction.
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
    if (tech?.pct_vs_50ma != null) {
      const p = Number(tech.pct_vs_50ma);
      rows.push({ label: "% vs 50d MA", val: `${p>=0?"+":""}${p.toFixed(1)}%`, color: p > 5 ? "green" : p < -5 ? "red" : "amber" });
    }
    if (tech?.pct_vs_200ma != null) {
      const p = Number(tech.pct_vs_200ma);
      rows.push({ label: "% vs 200d MA", val: `${p>=0?"+":""}${p.toFixed(1)}%`, color: p > 10 ? "green" : p < -10 ? "red" : "amber" });
    }
    if (tech?.adx_14 != null) {
      const adx = Number(tech.adx_14);
      rows.push({ label: "ADX(14)", val: adx.toFixed(0), color: adx >= 25 ? "green" : "amber" });
    }
    if (tech?.vol_surge != null) {
      const vs = Number(tech.vol_surge);
      rows.push({ label: "Volume surge", val: `${vs.toFixed(2)}× avg`, color: vs >= 1.5 ? "green" : vs < 0.7 ? "amber" : "amber" });
    }
    if (tech?.week_change != null) {
      const p = Number(tech.week_change);
      rows.push({ label: "1-week change", val: `${p>=0?"+":""}${p.toFixed(1)}%`, color: p >= 0 ? "green" : "red" });
    }
    if (tech?.month_change != null) {
      const p = Number(tech.month_change);
      rows.push({ label: "1-month change", val: `${p>=0?"+":""}${p.toFixed(1)}%`, color: p >= 0 ? "green" : "red" });
    }
    if (tech?.ytd_change != null) {
      const p = Number(tech.ytd_change);
      rows.push({ label: "YTD change", val: `${p>=0?"+":""}${p.toFixed(1)}%`, color: p >= 0 ? "green" : "red" });
    }
    if (tech?.spy_relative_month != null) {
      const p = Number(tech.spy_relative_month);
      rows.push({ label: "1-month vs SPY", val: `${p>=0?"+":""}${p.toFixed(1)}%`, color: p >= 0 ? "green" : "red" });
    }
    if (tech?.spy_relative_ytd != null) {
      const p = Number(tech.spy_relative_ytd);
      rows.push({ label: "YTD vs SPY", val: `${p>=0?"+":""}${p.toFixed(1)}%`, color: p >= 0 ? "green" : "red" });
    }
    if (tech?.tech_summary != null) {
      const s = String(tech.tech_summary);
      rows.push({ label: "Scanner summary", val: s, color: /strong|bull/i.test(s) ? "green" : /weak|bear/i.test(s) ? "red" : "amber" });
    }
    // Optional fields the scanner sometimes includes (kept for forward-compat)
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
    // v5.1 (d): cleaner empty state when the technicals scorer skipped this
    // name (e.g. reason='too_few_closes'). Show a plain "No technicals data"
    // line instead of "Composite ... 0 indicators in scope" which read like
    // a broken tile during Joe's UAT.
    if (rows.length === 0) {
      const v5SkipReason = v5Tech && v5Tech.reason ? String(v5Tech.reason).replace(/_/g, ' ') : null;
      return {
        state: score == null ? "loading" : state,
        value: score == null ? "—" : value,
        meta: v5SkipReason
          ? `No technicals data (${v5SkipReason})`
          : "No technicals data on this name today",
        detail: rows,
      };
    }
    return { state, value, meta: `Composite ${value} · ${rows.length} indicators in scope`, detail: rows };
  })();

  // Tile 4 — Unusual Flow (renders actual event rows from each source)
  const flowTile = (() => {
    const cBuys  = congressBuys  || [];
    const cSells = congressSells || [];
    const iBuys  = insiderBuys   || [];
    const iSells = insiderSells  || [];
    const fCalls = flowCalls     || [];
    const fPuts  = flowPuts      || [];
    const dp     = darkPoolPrints || [];
    const total  = cBuys.length + cSells.length + iBuys.length + iSells.length + fCalls.length + fPuts.length + dp.length;
    const netBull = (cBuys.length - cSells.length) + (iBuys.length - iSells.length) + (fCalls.length - fPuts.length);
    // Align state color with the verbal headline. Tile must not say 'Net
    // bullish' (positive) while the dot is amber (caution); pick one and
    // stick to it. Direction trumps magnitude — if events skew positive,
    // we are 'Net bullish' and the dot is green even on small samples.
    let state, value;
    if (total === 0) {
      state = "loading"; value = "Quiet";
    } else if (netBull > 0) {
      state = "green";   value = "Net bullish";
    } else if (netBull < 0) {
      state = "red";     value = "Net bearish";
    } else {
      state = "amber";   value = "Mixed";
    }
    const meta = total === 0
      ? "No unusual flow events in last scan"
      : `${total} events · Congress ${cBuys.length + cSells.length} · Insider ${iBuys.length + iSells.length} · Options ${fCalls.length + fPuts.length} · Dark pool ${dp.length}`;
    return { state, value, meta, detail: { cBuys, cSells, iBuys, iSells, fCalls, fPuts, dp, total } };
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
    const epsExp = sc?.eps_estimate ?? sc?.next_eps_estimate ?? null;
    const revExp = sc?.revenue_estimate ?? sc?.next_revenue_estimate ?? null;
    return {
      state,
      value: days < 0 ? "Reported" : days === 0 ? "Today" : `${days} day${days === 1 ? "" : "s"}`,
      meta: `Next report: ${dateLabel}${timeLabel ? ` (${timeLabel})` : ""}`,
      detail: { days, dateLabel, timeLabel, impMove30, epsExp, revExp },
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
      <SignalCard title="MacroTilt Signal" {...mtSignalTile} ragColor={ragColor} />
      <SignalCard title="Insider Activity" {...insiderTile} ragColor={ragColor} />
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
      <SignalCard title="Analyst Actions" {...analystTile} ragColor={ragColor} />
      <SignalCard title="Options Flow" {...optionsTile} ragColor={ragColor} />
      <SignalCard title="Congress Trades" {...congressTile} ragColor={ragColor} />
      {false && <SignalCard title="Unusual Flow" {...flowTile} ragColor={ragColor} renderDetail={detail => {
        // LESSONS rule #33 — every category section ALWAYS renders with an
        // explicit empty-state line when no events. Never silently hide a
        // section just because it has zero events for this ticker.
        const fmtMoney = v => {
          const n = Number(v);
          if (!Number.isFinite(n) || n === 0) return null;
          if (Math.abs(n) >= 1e6) return `$${(n/1e6).toFixed(1)}M`;
          if (Math.abs(n) >= 1e3) return `$${(n/1e3).toFixed(0)}K`;
          return `$${n.toFixed(0)}`;
        };
        const fmtDate = d => {
          if (!d) return "";
          const dt = new Date(String(d).slice(0,10) + "T00:00:00Z");
          return dt.toLocaleDateString(undefined, { month: "short", day: "numeric" });
        };
        const Section = ({ label, children }) => (
          <div style={{marginTop:8}}>
            <div style={{fontFamily:"var(--font-mono)",fontSize:9.5,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.14em",color:"var(--text-dim)",marginBottom:5}}>{label}</div>
            {children}
          </div>
        );
        const Empty = ({ msg }) => <div style={{fontSize:11.5,color:"var(--text-muted)",fontStyle:"italic"}}>{msg}</div>;
        const Row = ({ who, what, amt, sign }) => {
          const c = sign === "pos" ? "var(--green-text, #1a8c39)"
                  : sign === "neg" ? "var(--red-text, var(--red))"
                  : "var(--text)";
          return (
            <div style={{display:"grid",gridTemplateColumns:"1fr auto",gap:8,alignItems:"baseline",fontSize:12,padding:"3px 0"}}>
              <span style={{color:"var(--text-2)",lineHeight:1.4}}>
                <span style={{fontWeight:600,color:"var(--text)"}}>{who}</span>
                {what ? <span style={{color:"var(--text-muted)"}}> · {what}</span> : null}
              </span>
              <span style={{fontFamily:"var(--font-mono)",fontWeight:600,color:c,whiteSpace:"nowrap"}}>{amt}</span>
            </div>
          );
        };
        return (
          <div style={{display:"flex",flexDirection:"column",gap:0,fontSize:12}}>
            <Section label="Congress">
              {detail.cBuys.length === 0 && detail.cSells.length === 0
                ? <Empty msg="No congress trades in last scan." />
                : null}
              {detail.cBuys.slice(0,3).map((r,i)=>(
                <Row key={"cb"+i} who={r.reporter || r.name}
                     what={`BUY · ${r.amounts || ""} · ${fmtDate(r.transaction_date)}${r.member_type ? " · " + r.member_type : ""}`.replace(/\s+·\s+·/g," ·").trim()}
                     sign="pos" amt="↑ buy" />
              ))}
              {detail.cSells.slice(0,3).map((r,i)=>(
                <Row key={"cs"+i} who={r.reporter || r.name}
                     what={`SELL · ${r.amounts || ""} · ${fmtDate(r.transaction_date)}${r.member_type ? " · " + r.member_type : ""}`.replace(/\s+·\s+·/g," ·").trim()}
                     sign="neg" amt="↓ sell" />
              ))}
            </Section>
            <Section label="Insider">
              {detail.iBuys.length === 0 && detail.iSells.length === 0
                ? <Empty msg="No insider Form 4s in last scan." />
                : null}
              {detail.iBuys.slice(0,3).map((r,i)=>(
                <Row key={"ib"+i} who={r.insider_name || r.name || r.reporter || "Insider"}
                     what={`Form 4 · BUY${r.shares ? " " + Number(r.shares).toLocaleString() + " sh" : ""}${r.price ? " @ $" + Number(r.price).toFixed(2) : ""}${r.transaction_date ? " · " + fmtDate(r.transaction_date) : ""}`}
                     sign="pos" amt={fmtMoney(r.value || r.transaction_value || r.total_value) || "↑ buy"} />
              ))}
              {detail.iSells.slice(0,3).map((r,i)=>(
                <Row key={"is"+i} who={r.insider_name || r.name || r.reporter || "Insider"}
                     what={`Form 4 · SELL${r.shares ? " " + Number(r.shares).toLocaleString() + " sh" : ""}${r.price ? " @ $" + Number(r.price).toFixed(2) : ""}${r.transaction_date ? " · " + fmtDate(r.transaction_date) : ""}`}
                     sign="neg" amt={fmtMoney(r.value || r.transaction_value || r.total_value) || "↓ sell"} />
              ))}
            </Section>
            <Section label="Option flow">
              {detail.fCalls.length === 0 && detail.fPuts.length === 0
                ? <Empty msg="No unusual options in last scan." />
                : null}
              {detail.fCalls.slice(0,3).map((r,i)=>(
                <Row key={"fc"+i}
                     who={`${r.has_sweep ? "Sweep " : ""}${r.volume || ""} ${r.expiry ? fmtDate(r.expiry) : ""} ${r.strike || ""}C`.replace(/\s+/g," ").trim()}
                     what={`${r.alert_rule || ""}${r.iv_end ? " · IV " + (Number(r.iv_end)*100).toFixed(0) + "%" : ""}`}
                     sign="pos" amt={fmtMoney(r.total_premium) || "—"} />
              ))}
              {detail.fPuts.slice(0,3).map((r,i)=>(
                <Row key={"fp"+i}
                     who={`${r.has_sweep ? "Sweep " : ""}${r.volume || ""} ${r.expiry ? fmtDate(r.expiry) : ""} ${r.strike || ""}P`.replace(/\s+/g," ").trim()}
                     what={`${r.alert_rule || ""}${r.iv_end ? " · IV " + (Number(r.iv_end)*100).toFixed(0) + "%" : ""}`}
                     sign="neg" amt={fmtMoney(r.total_premium) || "—"} />
              ))}
            </Section>
            <Section label="Dark pool prints">
              {detail.dp.length === 0
                ? <Empty msg="No dark-pool prints in last scan." />
                : null}
              {detail.dp.slice(0,3).map((r,i)=>(
                <Row key={"dp"+i}
                     who={`${Number(r.size || 0).toLocaleString()} sh @ $${Number(r.price).toFixed(2)}`}
                     what={`${r.executed_at ? fmtDate(r.executed_at) : ""}${r.market_center ? " · venue " + r.market_center : ""}`}
                     sign="neutral" amt={fmtMoney(r.premium) || "—"} />
              ))}
            </Section>
          </div>
        );
      }} />}
      <SignalCard title="Short Interest" {...siTile} ragColor={ragColor} />
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
      <SignalCard title="Earnings & Events" {...earningsTile} ragColor={ragColor} renderDetail={detail => detail && (
        <div style={{display:"flex",flexDirection:"column",gap:10,fontSize:12,color:"var(--text-2)",lineHeight:1.5}}>
          <div>
            <span style={{fontFamily:"var(--font-mono)",fontSize:9.5,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.14em",color:"var(--text-dim)",marginRight:8}}>Next report</span>
            <b>{detail.dateLabel}</b>{detail.timeLabel ? ` · ${detail.timeLabel}` : ""}{detail.days > 0 ? ` · in ${detail.days} day${detail.days === 1 ? "" : "s"}` : detail.days === 0 ? " · today" : " · already reported"}
          </div>

          {detail.impMove30 != null
            ? <div>
                <span style={{fontFamily:"var(--font-mono)",fontSize:9.5,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.14em",color:"var(--text-dim)",marginRight:8}}>Implied move (30d)</span>
                <b>±{Number(detail.impMove30).toFixed(1)}%</b> from at-the-money options
              </div>
            : <div style={{color:"var(--text-muted)"}}>
                <span style={{fontFamily:"var(--font-mono)",fontSize:9.5,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.14em",color:"var(--text-dim)",marginRight:8}}>Implied move (30d)</span>
                <i>not available — options chain not in scope for this ticker</i>
              </div>
          }

          {(detail.epsExp != null || detail.revExp != null)
            ? <div>
                <span style={{fontFamily:"var(--font-mono)",fontSize:9.5,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.14em",color:"var(--text-dim)",marginRight:8}}>Consensus</span>
                {detail.epsExp != null && <span>EPS <b>${Number(detail.epsExp).toFixed(2)}</b></span>}
                {detail.epsExp != null && detail.revExp != null && <span> · </span>}
                {detail.revExp != null && <span>Rev <b>${(Number(detail.revExp)/1e9).toFixed(2)}B</b></span>}
              </div>
            : <div style={{color:"var(--text-muted)"}}>
                <span style={{fontFamily:"var(--font-mono)",fontSize:9.5,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.14em",color:"var(--text-dim)",marginRight:8}}>Consensus EPS / Rev</span>
                <i>not yet wired — pending data-pipeline work</i>
              </div>
          }

          {(() => {
            const eh = earningsHist?.quarters || [];
            const stripLabel = (
              <span style={{fontFamily:"var(--font-mono)",fontSize:9.5,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.14em",color:"var(--text-dim)",marginRight:8}}>Last 4 quarters</span>
            );
            if (earningsHist?.loading) {
              return <div style={{color:"var(--text-muted)"}}>{stripLabel}<i>loading…</i></div>;
            }
            if (eh.length === 0) {
              return <div style={{color:"var(--text-muted)"}}>{stripLabel}<i>no reported quarters in our history yet — refreshes weekly</i></div>;
            }
            return (
              <div>
                {stripLabel}
                <span style={{display:"inline-flex",gap:6,flexWrap:"wrap"}}>
                  {eh.map((q,i) => {
                    const beat = q.beat === true;
                    const miss = q.beat === false;
                    const pct = q.surprisePct;
                    const dotColor = beat ? "var(--green-text, #2ec27e)" : miss ? "var(--red-text, var(--red))" : "var(--text-muted)";
                    const sign = pct > 0 ? "+" : "";
                    const pctTxt = pct == null ? "—" : `${sign}${Number(pct).toFixed(1)}%`;
                    const date = q.date ? String(q.date) : "—";
                    return (
                      <span key={i} title={`Est ${q.estimate ?? "—"} · Actual ${q.actual ?? "—"}`}
                        style={{display:"inline-flex",alignItems:"center",gap:4,fontFamily:"var(--font-mono)",fontSize:11,padding:"3px 8px",borderRadius:12,border:"1px solid var(--border-faint)",background:"var(--surface-2, transparent)"}}>
                        <span style={{width:6,height:6,borderRadius:"50%",background:dotColor}}/>
                        <b style={{color:dotColor}}>{beat ? "BEAT" : miss ? "MISS" : "—"}</b>
                        <span style={{color:"var(--text-2)"}}>{pctTxt}</span>
                        <span style={{color:"var(--text-dim)"}}>· {date}</span>
                      </span>
                    );
                  })}
                </span>
              </div>
            );
          })()}
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
        background: "var(--surface-solid)",
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
              : positive === false ? "var(--red-text, var(--red))"
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
      background: "var(--surface-solid)",
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
              ? <div style={{fontSize:13,color:"var(--text-muted)"}}>We're still gathering company details for {ticker}. Check back later.</div>
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
//   - Buy / Add        → opens PositionEditor in "add" mode (prefilled ticker)
//   - Edit position    → opens PositionEditor in "edit" mode (held row)
//   - Watchlist toggle → uses the existing add/remove handlers
// (Open in Scanner button retired in earlier PR — Trading Opps surfaces are reachable via the sidebar)
// "Set stop alert" is queued — needs backend alert table + cron + notifications.
// ============================================================================
function ActionRow({
  ticker, heldIn, portfolioAuthed, onUserWatchlist, removeFromWatchlist, wlBusy,
  onOpenAddPosition, onOpenEditPosition, onClosePosition, onClose,
}) {
  const owns = heldIn && heldIn.length > 0;
  const multiHeld = owns && heldIn.length > 1;

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
    background: "var(--surface-solid)",
    color: "var(--text)",
    cursor: "pointer",
    transition: "all 0.12s ease",
  };
  const btnPrimary = {
    ...btnBase,
    background: "var(--accent)",
    border: "1px solid var(--accent)",
    color: "var(--surface-solid, #fff)",
  };
  const btnDanger = {
    ...btnBase,
    color: "var(--red-text, var(--red))",
    border: "1px solid rgba(200,48,42,0.35)",
  };
  const btnSmall = {
    ...btnBase,
    padding: "5px 10px",
    fontSize: 10,
    letterSpacing: "0.04em",
  };

  // #1181/#1183: human-readable per-row label so Joe can tell the stock
  // position from the option position on the same ticker.
  const describeRow = (p) => {
    if (!p) return "";
    const cls = (p.asset_class || p.assetClass || "stock").toUpperCase();
    if (cls === "OPTION") {
      const dir  = (p.direction || "").toUpperCase();
      const typ  = (p.contract_type || p.contractType || "").toUpperCase();
      const k    = p.strike != null ? `$${p.strike}` : "?";
      const exp  = p.expiration || "?";
      const qty  = Math.abs(Number(p.quantity || 0));
      return `${dir || "?"} ${qty} ${typ || "?"} ${k} ${exp}`;
    }
    const qty = Math.abs(Number(p.quantity || 0));
    return `${cls} · ${qty}${cls === "CASH" ? "" : (cls === "BOND" ? " bonds" : (cls === "CRYPTO" ? " units" : " shares"))}`;
  };

  // #1181: Sell entry — opens CloseModal with qty pre-filled to 0 so the
  // user must explicitly type the amount sold (vs. defaulting to full close).
  const handleSell = (raw) => {
    if (!raw) return;
    // Clone with explicit sellMode flag so CloseModal can render the "0" qty
    // default. The downstream Close handler already supports partial close.
    onClosePosition?.({ ...raw, __sellMode: true });
  };

  return (
    <div style={{
      marginTop: "var(--space-4)",
      paddingTop: "var(--space-4)",
      borderTop: "1px solid var(--border-faint)",
    }}>
      {/* #1183: multi-position list — one row per held position with its own
          Edit / Sell / Close buttons. Single-position case falls through to
          the legacy single button row below. */}
      {portfolioAuthed && multiHeld && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
          <div style={{
            fontSize: 10, color: "var(--text-muted)",
            fontFamily: "var(--font-mono)", letterSpacing: "0.08em",
            marginBottom: 2,
          }}>
            HELD POSITIONS ({heldIn.length})
          </div>
          {heldIn.map((h, i) => {
            const p = h?.p;
            if (!p) return null;
            return (
              <div key={p.id || i} style={{
                display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6,
                padding: "6px 8px",
                background: "var(--surface-2, rgba(0,0,0,0.03))",
                border: "1px solid var(--border-faint)",
                borderRadius: "var(--radius-xs, 6px)",
              }}>
                <div style={{
                  flex: "1 1 200px", fontSize: 11, fontFamily: "var(--font-mono)",
                  color: "var(--text)",
                }}>
                  {describeRow(p)}
                </div>
                <button type="button" style={btnSmall} onClick={() => onOpenEditPosition?.(p)}>
                  Edit
                </button>
                <button type="button" style={btnSmall} onClick={() => handleSell(p)}>
                  Sell
                </button>
                <button type="button" style={{...btnSmall, color:"var(--red-text, var(--red))", borderColor:"rgba(200,48,42,0.35)"}} onClick={() => onClosePosition?.(p)}>
                  Close
                </button>
              </div>
            );
          })}
        </div>
      )}

      <div style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 10,
      }}>
        {/* Single-position case: classic Edit / Buy / Sell / Close action row. */}
        {portfolioAuthed && owns && !multiHeld && (<>
          <button type="button" onClick={()=>onOpenEditPosition?.(heldIn[0].p)} style={btnPrimary}>
            Edit position
          </button>
          <button type="button" onClick={()=>onOpenAddPosition?.(ticker)} style={btnBase}>
            + Buy / Add
          </button>
          <button type="button" onClick={()=>handleSell(heldIn[0].p)} style={btnBase}>
            Sell some
          </button>
          <button type="button" onClick={()=>onClosePosition?.(heldIn[0].p)} style={btnDanger}>
            Close position
          </button>
        </>)}
        {/* Multi-position case: the per-row list above already covers Edit/Sell/Close.
            Keep Buy/Add available as a global ticker-level action. */}
        {portfolioAuthed && multiHeld && (
          <button type="button" onClick={()=>onOpenAddPosition?.(ticker)} style={btnBase}>
            + Buy / Add (new position)
          </button>
        )}
        {portfolioAuthed && !owns && (
          <button type="button" onClick={()=>onOpenAddPosition?.(ticker)} style={btnPrimary}>
            + Buy / Add
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
    </div>
  );
}


export default function TickerDetailModal({ticker,scanData,accounts,watchlistRows,portfolioAuthed,refetchPortfolio,onClose,onTickerAdded,scanBusy,cycleBoardSnap,v9Alloc,mtSignal,onOpenAddPosition,onOpenEditPosition,onClosePosition}){
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
// 2026-05-12 — LUNR bug fix. Price now sourced from prices_eod
// (Polygon Massive EOD) via useTickerEodPrice. The old waterfall
// (sc.close || sc.prev_close) pulled from the screener overlay,
// which for tickers UW doesn't cover (84% of universe, LUNR
// included) silently picked up the wrong prices_eod row through
// the universe overlay ordered by ingested_at rather than
// trade_date — producing a six-day-old close labeled as today.
// useTickerEodPrice always picks the latest two trade_date rows.
const eodPrice = useTickerEodPrice(ticker);
const price = eodPrice.last_close;
const prevClose = eodPrice.prev_close;
const dayPct = eodPrice.day_pct;
const priceTradeDate = eodPrice.trade_date; // YYYY-MM-DD for the chip
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
const rsiColor=rsi==null?"var(--text-dim)":rsi>=70?"var(--red)":rsi<=30?"var(--green)":"var(--text)";
const macdColor=macd==="bullish"?"var(--green)":macd==="bearish"?"var(--red)":"var(--text)";
const ma50Color=above50==null?"var(--text-dim)":above50?"var(--green)":"var(--red)";
const ma200Color=above200==null?"var(--text-dim)":above200?"var(--green)":"var(--red)";
const volColor=vol==null?"var(--text-dim)":vol>=2?"var(--green)":vol>=1?"var(--text)":"var(--text-dim)";
const ivRankColor=ivRank==null?"var(--text-dim)":ivRank>=70?"var(--red)":ivRank<=30?"var(--green)":"var(--text)";
const techScoreCol=techScore==null?"var(--text-dim)":techScore>=2?"var(--green)":techScore>=-1?"var(--text)":"var(--red)";
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
          style={{fontSize:10,marginLeft:6,color:"var(--red)",background:"transparent",border:"1px solid rgba(200,48,42,0.35)",borderRadius:4,padding:"2px 8px",fontFamily:"var(--font-mono)",fontWeight:600,cursor:wlBusy?"default":"pointer",letterSpacing:"0.06em"}}>{wlBusy?"…":"− REMOVE"}</button></Tip>
        :<Tip def="Add this ticker to your watchlist"><button type="button" onClick={addToWatchlist} disabled={wlBusy}
          style={{fontSize:10,marginLeft:6,color:"var(--accent)",background:"var(--accent-soft)",border:"1px solid rgba(0,113,227,0.35)",borderRadius:4,padding:"2px 8px",fontFamily:"var(--font-mono)",fontWeight:600,cursor:wlBusy?"default":"pointer",letterSpacing:"0.06em"}}>{wlBusy?"…":"+ WATCHLIST"}</button></Tip>
      )}
    </div>
    {/* v5.4: explicit overflowWrap + maxWidth so a long company name
        (e.g. "Dianthus Therapeutics, Inc. Common Stock") wraps inside
        the modal sheet instead of overflowing left. */}
    <h1 style={{fontFamily:"var(--font-display, Fraunces, Georgia, serif)",fontWeight:500,fontSize:32,letterSpacing:"-0.012em",color:"var(--text)",lineHeight:1.05,margin:"0 0 6px",overflowWrap:"anywhere",wordBreak:"break-word",maxWidth:"100%"}}>
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
    {wlError&&<div style={{fontSize:11,color:"var(--red)",fontFamily:"var(--font-mono)",marginTop:4}}>{wlError}</div>}
  </div>
  {/* RIGHT — price + delta */}
  <div style={{textAlign:"right",flexShrink:0}}>
    <div className="num" style={{fontFamily:"var(--font-mono)",fontSize:30,fontWeight:600,color:"var(--text)",lineHeight:1}}>{price?fmt$(price):"—"}</div>
    {dayPct!=null&&prevClose!=null&&price!=null&&(
      <div style={{marginTop:6,fontFamily:"var(--font-mono)",fontSize:12,fontWeight:600,letterSpacing:"0.06em",color:dayPct>=0?"var(--green-text, #1a8c39)":"var(--red-text, var(--red))"}}>
        {dayPct>=0?"▲ +":"▼ "}{fmt$(Math.abs(price-prevClose))} · {dayPct>=0?"+":""}{dayPct.toFixed(2)}%
      </div>
    )}
    {/* 2026-05-12 chip rebind: price freshness anchors to the actual
        trade_date of the displayed last_close, NOT to universe_snapshots'
        last fetch (which has no relationship to the value next to it for
        the 84% of tickers UW doesn't cover). Events stays bound to the
        scanner artifact's ticker_events_ts since the per-ticker event
        rows ARE refreshed by that pipeline. */}
    {(priceTradeDate||scanData?.ticker_events_ts)&&<div style={{marginTop:6,display:"flex",justifyContent:"flex-end"}}><DataFreshness pricesTs={priceTradeDate?`${priceTradeDate}T16:00:00-04:00`:null} eventsTs={scanData?.ticker_events_ts} compact/></div>}
  </div>
</div>

{/* Signal Composite block retired here per v5 spec — Phase 4b PR-H.
    The right-rail tiles (Macro Composite / Asset Tilt / Technical
    Indicators / Unusual Flow / Earnings & Events / News) replace
    the six section pills + composite-score header that lived here. */}

{/* ── v5 KPI strip (Phase 4b PR-B). 4 cards: 1-week / 1-month /
    YTD return + Position P&L. Each carries a vs-SPY comparator
    plus the SPY-relative comparator. LESSONS rule #5 (plain-English labels);
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
  const cFor = v => v==null ? "var(--text-dim)" : (v>=0 ? "var(--green-text, #1a8c39)" : "var(--red-text, var(--red))");

  const KpiCard = ({label, value, comp, color, tip}) => (
    <div style={{background:"var(--surface-solid)",border:"1px solid var(--border)",borderRadius:"var(--radius-xs, 6px)",padding:"12px 14px",display:"flex",flexDirection:"column"}}>
      <div style={{fontFamily:"var(--font-mono)",fontSize:9.5,textTransform:"uppercase",letterSpacing:"0.16em",color:"var(--text-dim)",marginBottom:4,display:"flex",alignItems:"center",gap:3}}>
        {label}{tip&&<InfoTip def={tip} size={10}/>}
      </div>
      <div style={{fontFamily:"var(--font-mono)",fontSize:18,fontWeight:600,color,lineHeight:1.1}}>{value}</div>
      {comp&&<div style={{marginTop:4,fontFamily:"var(--font-mono)",fontSize:11,color:"var(--text-muted)"}}>{comp}</div>}
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
<HistoricalChart ticker={ticker} sector={sector} accounts={accounts} watchlistRows={watchlistRows} nextEarnDate={nextEarn} dividends={deepDive.dividends} splits={deepDive.splits} defaultPeriod="1y" height={280}/>

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
  sc={sc}
  cycleBoardSnap={cycleBoardSnap}
  v9Alloc={v9Alloc}
  mtSignal={mtSignal}
  riskMetrics={_riskMetrics}
  heldIn={heldIn}
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
