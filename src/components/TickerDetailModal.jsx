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
    const meta = sig.so_what
      ? `${band} - ${sig.so_what}`
      : band;

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
    // Tooltip uses the native title attribute -- zero infrastructure, hovers
    // over the label cell.
    const SIGNAL_ORDER = [
      { key: "insider",        label: "Insider buying",  tip: "Form 4 open-market buys and sells by company officers and directors. Highest-weighted signal -- best predictor in the backtest." },
      { key: "technicals",     label: "Technicals",      tip: "20-day Bollinger BandWidth, 14-day RSI, distance to 50-day moving average, 20-day relative volume." },
      { key: "analyst",        label: "Analyst actions", tip: "Recent upgrades, downgrades, and price-target changes from Wall Street equity research analysts." },
      { key: "options",        label: "Options flow",    tip: "Unusual call and put premium vs open interest, plus sweep order count. Calibration pending while history backfills." },
      { key: "congress",       label: "Congress trades", tip: "Disclosed buy and sell trades by US senators and representatives in the last 90 days. Calibration pending -- thin history." },
      { key: "short_interest", label: "Short interest",  tip: "Percent of float sold short and the cost-to-borrow trend. Calibration pending -- sparse coverage." },
    ];

    // Cap-discount note for mega-caps -- now reads weights_used.insider
    // directly so it matches the table column exactly.
    const liveInsiderW = Number(weights.insider);
    const showCapNote =
      Number.isFinite(capDisc) && capDisc < 0.999 && Number.isFinite(liveInsiderW);
    const capNote = showCapNote ? (() => {
      const capStr = Number.isFinite(mcap) && mcap > 0
        ? (mcap >= 1e12 ? `$${(mcap/1e12).toFixed(1)}T` : mcap >= 1e9 ? `$${(mcap/1e9).toFixed(0)}B` : `$${(mcap/1e6).toFixed(0)}M`)
        : "this cap";
      return (
        <div style={{padding:"8px 10px",borderRadius:8,background:"var(--surface-3)",border:"1px solid var(--border-faint, var(--border))",color:"var(--text-muted)",fontSize:11.5,lineHeight:1.45}}
             title="At a $500M cap the insider weight is at full strength. By $50B it has dropped to half, and by $500B it is one-quarter. The freed weight is redistributed pro-rata to the other five signals so the total always sums to 100%.">
          <b style={{color:"var(--text-2)"}}>Insider weight reduced to {(liveInsiderW * 100).toFixed(1)}% at {capStr}.</b>{" "}
          Insider buys carry less information at larger market caps. Hover for the mechanism.
        </div>
      );
    })() : null;

    // "Insufficient Data" banner when the row failed the coverage guard.
    const insufficientNote = band === "Insufficient Data" ? (
      <div style={{padding:"8px 10px",borderRadius:8,background:"var(--surface-3)",border:"1px solid var(--border-faint, var(--border))",color:"var(--text-2)",fontSize:11.5,lineHeight:1.45}}>
        <b>Not enough signal coverage for a composite score today.</b>{" "}
        {Number.isFinite(Number(sig.signals_fired)) ? `${sig.signals_fired} of 6 signals had data.` : ""}{" "}
        The individual signals below are still honest -- read them directly.
      </div>
    ) : null;

    const detail = (
      <div style={{display:"flex",flexDirection:"column",gap:10,fontSize:12}}>
        {insufficientNote}
        {capNote}
        <div>
          <div style={{display:"grid",gridTemplateColumns:"140px 64px 64px 1fr",gap:8,padding:"3px 0",fontFamily:"var(--font-mono)",fontSize:9.5,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.12em",color:"var(--text-dim)",borderBottom:"1px solid var(--border-faint, var(--border))"}}>
            <span>Signal</span>
            <span>Score</span>
            <span>Weight</span>
            <span>Today's reading</span>
          </div>
          {SIGNAL_ORDER.map((s, i) => {
            const sub = subs[s.key];
            const w   = weights[s.key];
            const subStr = fmtSub(sub);
            const result = resultLine(s.key);
            const isLast = i === SIGNAL_ORDER.length - 1;
            return (
              <div key={"sig"+i} style={{display:"grid",gridTemplateColumns:"140px 64px 64px 1fr",gap:8,alignItems:"baseline",padding:"6px 0",borderBottom: isLast ? "none" : "1px solid var(--border-faint, var(--border))"}}>
                <span title={s.tip} style={{fontFamily:"var(--font-mono)",fontSize:10,letterSpacing:"0.04em",color:"var(--text-2)",textTransform:"uppercase",fontWeight:600,cursor:"help",borderBottom:"1px dotted var(--text-dim)"}}>{s.label}</span>
                <span style={{color: subColor(sub), fontWeight:600, fontFamily:"var(--font-mono)"}}>{subStr == null ? "—" : subStr}</span>
                <span style={{color:"var(--text-muted)", fontFamily:"var(--font-mono)", fontSize:11}}>{fmtWeight(w)}</span>
                <span style={{color: result ? "var(--text)" : "var(--text-dim)", fontSize:11.5, lineHeight:1.4}}>
                  {result || "no data"}
                </span>
              </div>
            );
          })}
        </div>
        <div style={{borderTop:"1px solid var(--border-faint, var(--border))",paddingTop:8,fontSize:11,color:"var(--text-muted)",lineHeight:1.5}}
             title="Backtest period: 52 weekly Mondays through May 2026. Walk-forward calibration -- weights re-fit on the last 12 months only. Alpha measured on close-to-close 21-day returns.">
          <b style={{color:"var(--text-2)"}}>Backtest:</b> Strong Buy band beats SPY 55% of weeks, +7.2pp alpha, Sharpe 3.0 vs SPY 2.9. Hover for window.
        </div>
      </div>
    );
    return { state, value, meta, detail };
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
      <SignalCard title="Unusual Flow" {...flowTile} ragColor={ragColor} renderDetail={detail => {
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
          + Buy / Add
        </button>
        <button type="button" onClick={()=>onClosePosition?.(heldRow)} style={btnDanger}>
          Close position
        </button>
      </>)}
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
    {(scanData?.universe_snapshot_ts||scanData?.ticker_events_ts)&&<div style={{marginTop:6,display:"flex",justifyContent:"flex-end"}}><DataFreshness pricesTs={scanData.universe_snapshot_ts} eventsTs={scanData.ticker_events_ts} compact/></div>}
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
