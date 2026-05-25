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
import useTickerTechnicalsLive from "../hooks/useTickerTechnicalsLive";
import { WATCHLIST_FALLBACK } from "../data/watchlistFallback";


// ============================================================================
// SignalIntelligenceRail — Trading Opportunities screener rail
// Rebuilt to reflect the new dual-direction Trading Opportunities screener.
// Reads the most recent scan row for this ticker from public.trading_opps_signals
// and renders score, signal chip, score breakdown, trade levels, and a
// plain-English "so what" callout. When the ticker is not on the current
// screener list, shows a calm empty state.
//
// Replaces the retired six-signal "MacroTilt Signal" rail. Only this
// right-hand pane changed; the modal's left side is untouched.
// ============================================================================

// useTradingOppsSignal — fetches the latest screener row for one ticker.
// Real hook declared at module scope so it never runs inside a JSX IIFE.
function useTradingOppsSignal(ticker) {
  const [state, setState] = useState({ loading: true, row: null, error: false });

  useEffect(() => {
    let cancelled = false;
    if (!ticker) {
      setState({ loading: false, row: null, error: false });
      return;
    }
    setState({ loading: true, row: null, error: false });
    (async () => {
      try {
        const { data, error } = await supabase
          .from("trading_opps_signals")
          .select("*")
          .eq("ticker", ticker)
          .order("scan_date", { ascending: false })
          .limit(1);
        if (cancelled) return;
        if (error) {
          setState({ loading: false, row: null, error: true });
          return;
        }
        setState({ loading: false, row: (data && data[0]) || null, error: false });
      } catch (_) {
        if (!cancelled) setState({ loading: false, row: null, error: true });
      }
    })();
    return () => { cancelled = true; };
  }, [ticker]);

  return state;
}

// RailShell — common eyebrow + outer frame for every rail state.
function RailShell({ children }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
      <div style={{
        fontFamily: "var(--font-mono)", fontSize: 9.5, fontWeight: 700,
        letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--accent)",
      }}>
        Trading Opportunities — signal
      </div>
      {children}
    </div>
  );
}

// BreakdownRow — one scoring-layer line: label left, points right.
function BreakdownRow({ label, sub, points, muted, total }) {
  return (
    <div style={{
      display: "flex", justifyContent: "space-between", alignItems: "baseline",
      gap: 10, fontSize: 12,
      padding: total ? "8px 0 0" : "6px 0",
      borderBottom: total ? "none" : "1px solid var(--border-faint)",
      color: muted ? "var(--text-dim)" : "var(--text-2)",
      fontWeight: total ? 700 : 400,
    }}>
      <span style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: 6, minWidth: 0 }}>
        <span style={{ color: total ? "var(--text)" : (muted ? "var(--text-dim)" : "var(--text)") }}>{label}</span>
        {sub != null && sub !== "" && (
          <span style={{ fontSize: 10.5, color: "var(--text-dim)" }}>{sub}</span>
        )}
      </span>
      <span style={{
        fontFamily: "var(--font-mono)", fontWeight: 700, whiteSpace: "nowrap",
        color: total ? "var(--text)" : (muted ? "var(--text-dim)" : "var(--text-2)"),
      }}>
        {points}
      </span>
    </div>
  );
}

// LevelTile — one of Entry / Stop / Target.
function LevelTile({ label, value, tone }) {
  const color = tone === "down" ? "var(--red-text)"
              : tone === "up"   ? "var(--green-text)"
              : "var(--text)";
  return (
    <div style={{
      background: "var(--surface)", border: "1px solid var(--border)",
      borderRadius: "var(--radius-sm)", padding: 8, textAlign: "center",
    }}>
      <div style={{ fontSize: 9, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</div>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: 14, fontWeight: 700, marginTop: 2, color }}>{value}</div>
    </div>
  );
}

function SignalIntelligenceRail({ ticker }) {
  const { loading, row, error } = useTradingOppsSignal(ticker);

  // -- Loading -----------------------------------------------------------
  if (loading) {
    return (
      <RailShell>
        <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>
          Checking the screener…
        </div>
      </RailShell>
    );
  }

  // -- Error or no row — calm empty state --------------------------------
  if (error || !row) {
    return (
      <RailShell>
        <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>
          {error
            ? "Screener data is unavailable right now."
            : "Not on the current Trading Opportunities screener list."}
        </div>
      </RailShell>
    );
  }

  // -- Helpers -----------------------------------------------------------
  const num = v => (v == null || !Number.isFinite(Number(v)) ? null : Number(v));
  const fmtMoney = v => {
    const n = num(v);
    return n == null ? "—" : `$${n.toFixed(2)}`;
  };
  const fmtPoints = v => {
    const n = num(v);
    if (n == null) return "—";
    return `${n > 0 ? "+" : ""}${Number.isInteger(n) ? n : n.toFixed(1)}`;
  };

  const score = num(row.score);
  const scoreColor = score == null ? "var(--text)"
                   : score >= 7 ? "var(--green-text)"
                   : score >= 5 ? "var(--accent)"
                   : "var(--text)";
  const scoreLabel = score == null ? "—" : score.toFixed(1);

  // Insider rule tags + freshness.
  let insiderTags = [];
  if (Array.isArray(row.insider_rules)) {
    insiderTags = row.insider_rules;
  } else if (typeof row.insider_rules === "string" && row.insider_rules.trim()) {
    try {
      const parsed = JSON.parse(row.insider_rules);
      if (Array.isArray(parsed)) insiderTags = parsed;
    } catch (_) { /* leave empty */ }
  }
  const insiderAge = num(row.insider_age_days);
  // Decay weight remaining once a signal ages past 15 days (mirrors screener).
  const decayPct = insiderAge != null && insiderAge > 15
    ? Math.max(0, Math.round(((31 - insiderAge) / 16) * 100))
    : null;
  const insiderSubParts = [];
  if (insiderAge != null) insiderSubParts.push(`${insiderAge}d old`);
  if (decayPct != null) insiderSubParts.push(`${decayPct}% weight left`);

  const entry  = fmtMoney(row.entry);
  const stop   = fmtMoney(row.stop);
  const target = fmtMoney(row.target);

  return (
    <RailShell>
      {/* Score headline */}
      <div>
        <div style={{ fontFamily: "var(--font-display)", fontSize: 28, fontWeight: 600, lineHeight: 1.05, color: scoreColor }}>
          {scoreLabel}
          <span style={{ fontFamily: "var(--font-ui)", fontSize: 13, fontWeight: 500, color: "var(--text-muted)" }}> / 10</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
          {row.signal && (
            <span style={{
              fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 700,
              letterSpacing: "0.06em", textTransform: "uppercase",
              padding: "3px 8px", borderRadius: 999,
              background: "var(--accent-soft)", color: "var(--accent)",
            }}>
              {String(row.signal).replace(/_/g, " ")}
            </span>
          )}
        </div>
      </div>

      {/* Score breakdown */}
      <div>
        <div style={{
          fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 700,
          letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--text-dim)",
          margin: "var(--space-3) 0 var(--space-1)",
        }}>
          Score breakdown
        </div>

        {/* Insider */}
        <div style={{
          display: "flex", justifyContent: "space-between", alignItems: "baseline",
          gap: 10, fontSize: 12, padding: "6px 0",
          borderBottom: "1px solid var(--border-faint)", color: "var(--text-2)",
        }}>
          <span style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 4, minWidth: 0 }}>
            <span style={{ color: "var(--text)", marginRight: 2 }}>Insider</span>
            {insiderTags.length > 0
              ? insiderTags.map((t, i) => (
                  <span key={i} style={{
                    fontFamily: "var(--font-mono)", fontSize: 9, fontWeight: 700,
                    color: "var(--accent)", background: "var(--accent-soft)",
                    borderRadius: 4, padding: "1px 5px",
                  }}>
                    Rule {t}
                  </span>
                ))
              : <span style={{ fontSize: 10.5, color: "var(--text-dim)" }}>no rules fired</span>}
            {insiderSubParts.length > 0 && (
              <span style={{ fontSize: 10.5, color: "var(--text-dim)" }}>· {insiderSubParts.join(" · ")}</span>
            )}
          </span>
          <span style={{ fontFamily: "var(--font-mono)", fontWeight: 700, whiteSpace: "nowrap", color: "var(--text-2)" }}>
            {fmtPoints(row.insider_pts)}
          </span>
        </div>

        <BreakdownRow label="SMA200 trend" points={fmtPoints(row.sma200_pts)} />
        <BreakdownRow label="RSI momentum" points={fmtPoints(row.rsi_pts)} />

        <BreakdownRow label="Dark pool"
          points={row.dark_pool_pts != null ? fmtPoints(row.dark_pool_pts) : "—"} />
        <BreakdownRow label="Options shock"
          points={row.options_pts != null ? fmtPoints(row.options_pts) : "—"} />

        <BreakdownRow label="System score" points={`${scoreLabel} / 10`} total />
      </div>

      {/* Trade levels */}
      <div>
        <div style={{
          fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 700,
          letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--text-dim)",
          margin: "var(--space-3) 0 var(--space-1)",
        }}>
          Trade levels
        </div>
        <div className="tdm-levels" style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 6, marginTop: 6 }}>
          <LevelTile label="Entry"  value={entry}  tone="neutral" />
          <LevelTile label="Stop"   value={stop}   tone="down" />
          <LevelTile label="Target" value={target} tone="up" />
        </div>
      </div>

      {/* So what */}
      {row.so_what && (
        <div style={{
          background: "var(--accent-soft)", borderRadius: "var(--radius-sm)",
          padding: "var(--space-3)", fontSize: 11.5, lineHeight: 1.5,
          color: "var(--text-2)", marginTop: "var(--space-1)",
        }}>
          <b style={{ color: "var(--text)" }}>So what: </b>{row.so_what}
        </div>
      )}
    </RailShell>
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
      <div className="tdm-tabrow" style={{display:"flex",borderBottom:"1px solid var(--border-faint)",gap:0}}>
        <button onClick={()=>setTab("about")} style={tabBtnStyle(tab==="about")}>About</button>
        <button onClick={()=>setTab("dividends")} style={tabBtnStyle(tab==="dividends")}>
          Dividend history{divs.length>0?` · ${divs.length}`:""}
        </button>
        <button onClick={()=>setTab("splits")} style={tabBtnStyle(tab==="splits")}>
          Splits{spls.length>0?` · ${spls.length}`:""}
        </button>
      </div>

      <div className="tdm-tabbody" style={{padding:"16px 18px"}}>
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
const _techCached = scanData?.signals?.technicals?.[ticker] || {};
const _techLive   = useTickerTechnicalsLive(ticker);
// Merge: live values (computed from the same Yahoo daily history the
// chart uses) take precedence over the cached scan snapshot. The cache
// still supplies fields the live hook doesn't compute (Bollinger %B,
// Stochastic K/D, OBV, Ichimoku, etc.). Fixes the "GLD technicals 17
// days stale" class of bug — daily Python scanner filters ETFs, so
// their cache rows go cold; the live hook has no such gap.
const tech = {
  ..._techCached,
  ...(_techLive && {
    ...(Number.isFinite(_techLive.week_change)        && { week_change:        _techLive.week_change }),
    ...(Number.isFinite(_techLive.month_change)       && { month_change:       _techLive.month_change }),
    ...(Number.isFinite(_techLive.ytd_change)         && { ytd_change:         _techLive.ytd_change }),
    ...(Number.isFinite(_techLive.pct_vs_50ma)        && { pct_vs_50ma:        _techLive.pct_vs_50ma }),
    ...(Number.isFinite(_techLive.pct_vs_200ma)       && { pct_vs_200ma:       _techLive.pct_vs_200ma }),
    ...(_techLive.above_50ma  != null && { above_50ma:  _techLive.above_50ma }),
    ...(_techLive.above_200ma != null && { above_200ma: _techLive.above_200ma }),
    ...(Number.isFinite(_techLive.rsi_14)             && { rsi_14:             _techLive.rsi_14 }),
    ...(_techLive.macd_cross && { macd_cross:                                  _techLive.macd_cross }),
    ...(Number.isFinite(_techLive.vol_surge)          && { vol_surge:          _techLive.vol_surge }),
    ...(Number.isFinite(_techLive.spy_relative_month) && { spy_relative_month: _techLive.spy_relative_month }),
    ...(Number.isFinite(_techLive.spy_relative_ytd)   && { spy_relative_ytd:   _techLive.spy_relative_ytd }),
  }),
};
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
    // 2026-05-14 — Yahoo same-day fallback. Polygon Basic tier won't
    // serve today's grouped EOD until T+1, so a freshly-added watchlist
    // ticker would render as a dash until the next overnight ingest.
    // Fire-and-forget call to the eod-same-day edge function pulls
    // today's close from Yahoo into prices_eod within ~1 second so the
    // drawer and the watchlist table both show real numbers immediately.
    (async () => {
      try {
        const accessToken = session?.access_token;
        await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/eod-same-day`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
            apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({ ticker: ticker.toUpperCase() }),
        });
      } catch (_) { /* best-effort; useTickerEodPrice self-heal still runs */ }
    })();
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
{/* ── Bug #1153 — phone-width responsive pass. Scoped <style> block:
    every rule is gated behind @media (max-width: 640px) so desktop
    rendering is byte-identical above the breakpoint. Targets the
    tdm-* classes added to the inline-styled blocks below. The
    desktop inline styles remain authoritative ≥ 641px. */}
<style>{`
@media (max-width: 640px) {
  .tdm-sheet { padding: var(--space-4) var(--space-4) var(--space-4) !important; }
  /* Collapse the 2-column body (panels + Signal rail) to a single column
     so the 360px rail no longer forces ~750px of content width. */
  .tdm-grid {
    grid-template-columns: 1fr !important;
    gap: var(--space-4) !important;
  }
  /* The Signal rail moves below the panels; drop the desktop left border
     and left padding, add a top divider instead. */
  .tdm-rail {
    border-left: none !important;
    padding-left: 0 !important;
    border-top: 1px solid var(--border-faint);
    padding-top: var(--space-4);
  }
  /* Hero: name and price stack instead of competing for width. */
  .tdm-hero {
    grid-template-columns: 1fr !important;
    gap: var(--space-3) !important;
    padding-right: 36px !important;
  }
  .tdm-hero-price { text-align: left !important; }
  .tdm-hero-price .tdm-fresh { justify-content: flex-start !important; }
  .tdm-hero-name { font-size: 24px !important; }
  /* KPI strip: 4 cards across is unreadable on a phone — 2x2 grid. */
  .tdm-kpis { grid-template-columns: 1fr 1fr !important; gap: 10px !important; }
  /* Bottom-tab buttons: allow wrapping + tighter padding so the tab row
     (About / Dividend history / Splits) never overflows the sheet. */
  .tdm-tabrow { flex-wrap: wrap !important; }
  .tdm-tabrow > button { padding: 8px 10px !important; font-size: 10px !important; }
  /* Tab body: tighten padding; let the dividend/splits tables scroll
     horizontally instead of clipping on a narrow screen. */
  .tdm-tabbody { padding: 14px !important; overflow-x: auto; -webkit-overflow-scrolling: touch; }
  /* Trade levels: Entry/Stop/Target stay 3-up but tighten the gap. */
  .tdm-levels { gap: 5px !important; }
}
`}</style>
<div className="modal-wrap">
<div className="modal-sheet tdm-sheet" onClick={e=>e.stopPropagation()} style={{position:"relative",padding:"var(--space-5) var(--space-5) var(--space-4)"}}>
<button className="modal-close" onClick={onClose} aria-label="Close">×</button>
{/* ── modal-grid: 2-column layout (left = existing panels; right = Signal
    Intelligence rail). Collapses to a single column ≤ 640px via the
    scoped media query above (#1153). */}
<div className="modal-grid tdm-grid" style={{display:"grid",gridTemplateColumns:"minmax(0,1fr) 360px",gap:"var(--space-5)",alignItems:"start"}}>
<div className="modal-left" style={{minWidth:0}}>
{/* ── v5 hero — identity-only (Phase 4b PR-B). LESSONS rule #29:
    Fraunces big-name, JetBrains Mono labels, var(--ink-1)/etc. via
    the site's existing parchment overlay. LESSONS rule #30: every
    value derives from live data; no hardcoded narrative. */}
<div className="tdm-hero" style={{paddingRight:48,marginBottom:"var(--space-4)",display:"grid",gridTemplateColumns:"1fr auto",gap:"var(--space-5)",alignItems:"start"}}>
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
    <h1 className="tdm-hero-name" style={{fontFamily:"var(--font-display, Fraunces, Georgia, serif)",fontWeight:500,fontSize:32,letterSpacing:"-0.012em",color:"var(--text)",lineHeight:1.05,margin:"0 0 6px",overflowWrap:"anywhere",wordBreak:"break-word",maxWidth:"100%"}}>
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
  <div className="tdm-hero-price" style={{textAlign:"right",flexShrink:0}}>
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
    {(priceTradeDate||scanData?.ticker_events_ts)&&<div className="tdm-fresh" style={{marginTop:6,display:"flex",justifyContent:"flex-end"}}><DataFreshness pricesTs={eodPrice.ingested_at || (priceTradeDate?`${priceTradeDate}T16:00:00-04:00`:null)} eventsTs={scanData?.ticker_events_ts} compact/></div>}
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
    <div className="tdm-kpis" style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:14,marginBottom:"var(--space-4)"}}>
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
<aside className="modal-rail tdm-rail" style={{minWidth:0,paddingLeft:"var(--space-2)",borderLeft:"1px solid var(--border-faint)"}}>
<SignalIntelligenceRail ticker={ticker} />
</aside>
</div>
</div>
</div>
</div>
);
}
