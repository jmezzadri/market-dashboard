/**
 * Trading Scanner Dashboard Tab
 * Dark-themed to match the Macro Dashboard aesthetic.
 */
import { useState, useEffect, useMemo } from "react";
import { Tile } from "./Shell";
import { InfoTip, HeadWithTip, Tip } from "./InfoTip";
import { useSession } from "./auth/useSession";
import { useUserPortfolio } from "./hooks/useUserPortfolio";
import { usePrivateScanSupplement } from "./hooks/usePrivateScanSupplement";
import { useUniverseSnapshot } from "./hooks/useUniverseSnapshot";
import { useTickerEvents } from "./hooks/useTickerEvents";
import SubCompositeStrip from "./components/SubCompositeStrip";
import UniverseFreshness from "./components/UniverseFreshness";
import { normalizeTickerName } from "./lib/nameFormat";

const DATA_URL =
  "https://raw.githubusercontent.com/jmezzadri/market-dashboard/main/public/latest_scan_data.json";

const TAB_META = {
  // "overview" (Buy & Watch list) tile retired 2026-04-19: Portfolio & Insights
  // (portopps) now surfaces the same buy alerts / near-trigger / watchlist data
  // with populated 6-bar composites, making this tile redundant.
  congress:    { eyebrow: "Congressional",     title: "Congress activity",      sub: "Disclosed equity trades by U.S. Senators and Representatives in the last 45 days (buys and sells).", accent: "#0a84ff" },
  insiders:    { eyebrow: "Form 4 Insiders",   title: "Insider activity",       sub: "Open-market buys and sells by company officers, directors, and 10% holders filed with the SEC.",    accent: "#bf5af2" },
  flow:        { eyebrow: "Options Flow",      title: "Unusual flow alerts",    sub: "Large or unusual call and put options activity flagged by Unusual Whales.",           accent: "#ff9f0a" },
  technicals:  { eyebrow: "Per-ticker signals", title: "Technicals",            sub: "Composite SIGNAL score (-100 to +100, SCTR-weighted with ADX regime filter), plus RSI, MACD, moving averages, IV rank, and relative volume.", accent: "#B8860B" },
  // "methodology" tile retired 2026-04-22 — the scanner tile now links to the
  // site-wide Methodology page (#readme) rather than rendering its own copy.
};

// ── Congressional party lookup ────────────────────────────────────────────────
// Curated 119th Congress (2025-2027) members appearing in scanner data.
// Sourced from official US House/Senate rosters. "D" = Democrat, "R" = Republican, "I" = Independent.
// TODO: replace with server-side enrichment once UW exposes a politician metadata endpoint, or
// load github.com/unitedstates/congress-legislators data file at scanner-run time.
const CONGRESS_PARTY = {
  // House Democrats
  "April Delaney": "D", "Cleo Fields": "D", "Gilbert Cisneros": "D",
  "Jonathan Jackson": "D", "Josh Gottheimer": "D", "Lloyd Doggett": "D",
  "Rick Larsen": "D",
  // House Republicans
  "August Lee Pfluger": "R", "Byron Donalds": "R", "David Taylor": "R",
  "Kevin Hern": "R", "Mark Alford": "R", "Rich McCormick": "R",
  "Thomas Kean": "R", "Tim Moore": "R", "Warren Davidson": "R",
  "William Steube": "R",
  // Senate Democrats / Independents
  "John Fetterman": "D", "Sheldon Whitehouse": "D", "Tina Smith": "D",
  // Senate Republicans
  "John Boozman": "R", "Shelley Capito": "R",
};
function partyOf(row) {
  // Allow upstream enrichment to override (server-side `party` field wins).
  if (row?.party) return String(row.party).toUpperCase().slice(0, 1);
  const n = (row?.name || "").trim();
  return CONGRESS_PARTY[n] || null;
}
const PARTY_META = {
  D: { label: "Dem", color: "var(--blue-text)",   bg: "rgba(10,132,255,0.12)", border: "rgba(10,132,255,0.30)" },
  R: { label: "Rep", color: "var(--red-text)",    bg: "rgba(255,69,58,0.12)",  border: "rgba(255,69,58,0.30)"  },
  I: { label: "Ind", color: "var(--yellow-text)", bg: "rgba(255,214,10,0.12)", border: "rgba(255,214,10,0.30)" },
};

// ── Palette ───────────────────────────────────────────────────────────────────
// Theme-aware: pulls from CSS variables defined in theme.css (light + dark).
const C = {
  bg:       "var(--bg)",
  card:     "var(--surface)",
  border:   "var(--border)",
  border2:  "var(--border-strong)",
  text:     "var(--text)",
  muted:    "var(--text-muted)",
  dim:      "var(--text-dim)",
  accent:   "var(--accent)",
  green:    "var(--green)",
  yellow:   "var(--yellow)",
  red:      "var(--red)",
  blue:     "var(--blue)",
  // Text-on-light variants (auto-bright on dark)
  greenT:   "var(--green-text)",
  yellowT:  "var(--yellow-text)",
  redT:     "var(--red-text)",
  blueT:    "var(--blue-text)",
  row1:     "var(--surface)",
  row2:     "var(--surface-2)",
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmt$(n) {
  if (n == null) return "—";
  return "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtPct(n) {
  if (n == null) return "—";
  const v = Number(n);
  return (v >= 0 ? "+" : "") + v.toFixed(1) + "%";
}
function fmtDate(s) {
  if (!s) return "—";
  try { return new Date(s).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }); }
  catch { return s; }
}
function fmtMoney(n) {
  if (n == null) return "—";
  const v = Math.abs(Number(n));
  if (v >= 1e9) return "$" + (v / 1e9).toFixed(1) + "B";
  if (v >= 1e6) return "$" + (v / 1e6).toFixed(1) + "M";
  if (v >= 1e3) return "$" + (v / 1e3).toFixed(0) + "K";
  return "$" + v.toLocaleString();
}

// ── Tile helpers ──────────────────────────────────────────────────────────────
function MiniStat({ label, value, color, wide }) {
  return (
    <div style={{
      flex: wide ? "1 1 140px" : "1 1 90px", minWidth: wide ? 140 : 90,
      padding: "10px 12px", background: "var(--surface-3)",
      borderRadius: "var(--radius-sm)", border: "1px solid var(--border-faint)",
    }}>
      <div style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "var(--font-mono)", letterSpacing: "0.06em", marginBottom: 3 }}>{label}</div>
      <div className="num" style={{ fontSize: wide ? 13 : 20, fontWeight: 700, color, fontFamily: "var(--font-mono)" }}>{value}</div>
    </div>
  );
}
function Chip({ label }) {
  return (
    <span style={{
      fontSize: 10, padding: "3px 8px", borderRadius: 999,
      background: "var(--surface-3)", color: "var(--text-muted)",
      border: "1px solid var(--border-faint)",
      fontFamily: "var(--font-mono)", fontWeight: 600,
    }}>{label}</span>
  );
}

// ── AnomalyList + AnomalyRow (Bug #4b) ────────────────────────────────────────
// Used by the scanner landing tiles to render "top 3 noteworthy" items per
// surface instead of aggregate counts. Each row is a single line with a
// left-side description (ticker + qualifier chips + subject) and a right-side
// number (dollar size or signal score). Rows are non-interactive — the parent
// Tile carries the click target to drill into the full detail view.
function AnomalyList({ items, renderItem, empty }) {
  if (!items || items.length === 0) {
    return (
      <div style={{
        marginTop: "var(--space-2)",
        padding: "14px 10px",
        textAlign: "center",
        fontSize: 12,
        color: "var(--text-muted)",
        fontFamily: "var(--font-mono)",
        background: "var(--surface-3)",
        border: "1px dashed var(--border-faint)",
        borderRadius: "var(--radius-sm)",
        letterSpacing: "0.02em",
      }}>{empty || "Nothing to show."}</div>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", marginTop: "var(--space-2)" }}>
      {items.map((it, i) => renderItem(it, i))}
    </div>
  );
}
function AnomalyRow({ left, right }) {
  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 10,
      padding: "7px 0",
      borderBottom: "1px solid var(--border-faint)",
      fontSize: 12,
      lineHeight: 1.3,
      minWidth: 0,
    }}>
      <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 0, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {left}
      </div>
      <div style={{ display: "flex", alignItems: "center", flexShrink: 0, fontSize: 12, whiteSpace: "nowrap" }}>
        {right}
      </div>
    </div>
  );
}

// ── Badges ────────────────────────────────────────────────────────────────────
function Badge({ label, color }) {
  const styles = {
    green:  { bg: "rgba(48,209,88,0.12)",  text: C.greenT,  border: "rgba(48,209,88,0.30)"  },
    yellow: { bg: "rgba(255,214,10,0.12)", text: C.yellowT, border: "rgba(255,214,10,0.30)" },
    red:    { bg: "rgba(255,69,58,0.12)",  text: C.redT,    border: "rgba(255,69,58,0.30)"  },
    blue:   { bg: "rgba(10,132,255,0.12)", text: C.blueT,   border: "rgba(10,132,255,0.30)" },
    gray:   { bg: "var(--surface-3)",      text: C.muted,  border: "var(--border)"         },
  };
  const s = styles[color] || styles.gray;
  return (
    <span style={{
      background: s.bg, color: s.text, border: `1px solid ${s.border}`,
      fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 3,
      display: "inline-block", fontFamily: "monospace", letterSpacing: "0.05em",
    }}>{label}</span>
  );
}

function PartyBadge({ party }) {
  const meta = PARTY_META[party];
  if (!meta) return <span style={{ color: C.dim, fontFamily: "monospace", fontSize: 11 }}>—</span>;
  return (
    <span style={{
      background: meta.bg, color: meta.color, border: `1px solid ${meta.border}`,
      fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 3,
      display: "inline-block", fontFamily: "monospace", letterSpacing: "0.05em",
    }}>{meta.label}</span>
  );
}

function ScoreBadge({ score }) {
  const color = score >= 60 ? "green" : score >= 35 ? "yellow" : "gray";
  return <Badge label={`Score ${score}`} color={color} />;
}

function TierBadge({ tier }) {
  if (tier === "buy")   return <Badge label="BUY"   color="green" />;
  if (tier === "watch") return <Badge label="WATCH" color="yellow" />;
  return <Badge label={tier?.toUpperCase() || "—"} color="gray" />;
}

// ── Signal helpers ────────────────────────────────────────────────────────────
function congressSignal(buys, ticker) {
  const rows = buys.filter(r => r.ticker === ticker);
  if (!rows.length) return { dot: C.dim, label: "Neutral", sub: "No recent activity", detail: null };
  const n = rows.length;
  const conviction = n >= 5 ? "High Conviction" : n >= 3 ? "Moderate" : "Low";
  const largest = rows.reduce((a, b) => (a.amounts || "") > (b.amounts || "") ? a : b, rows[0]);
  const names = [...new Set(rows.map(r => r.name || r.reporter).filter(Boolean))];
  const detail = `${n} buy${n>1?"s":""} (45d)${names.length ? " · Incl. " + names[0] : ""}${largest?.amounts ? " · Largest: " + largest.amounts : ""}`;
  return { dot: C.green, label: "Bullish", sub: conviction, detail };
}

function insiderSignal(buys, ticker) {
  const rows = buys.filter(r => r.ticker === ticker);
  if (!rows.length) return { dot: C.dim, label: "Neutral", sub: "No qualifying activity", detail: null };
  const n = rows.length;
  const names = [...new Set(rows.map(r => r.owner_name || r.name).filter(Boolean))];
  const total = rows.reduce((a, r) => a + (Number(r.amount) || 0), 0);
  return {
    dot: C.green, label: "Bullish", sub: `${n} insider buy${n>1?"s":""}`,
    detail: names.slice(0,2).join(", ") + (total > 0 ? ` · ${fmtMoney(total)}` : ""),
  };
}

function flowSignal(callFlows, putFlows, ticker) {
  const calls = callFlows.filter(r => r.ticker === ticker);
  const puts  = putFlows.filter(r  => r.ticker === ticker);
  if (!calls.length && !puts.length) return { dot: C.dim, label: "Neutral", sub: "No unusual flow", detail: null };
  const callPrem = calls.reduce((a, r) => a + (Number(r.total_premium) || 0), 0);
  const putPrem  = puts.reduce((a, r)  => a + (Number(r.total_premium) || 0), 0);
  if (calls.length && !puts.length) {
    return { dot: C.green, label: "Bullish", sub: "Call flow", detail: `${calls.length} alert${calls.length>1?"s":""} · ${fmtMoney(callPrem)} premium` };
  }
  if (puts.length && !calls.length) {
    return { dot: C.red, label: "Bearish", sub: "Put flow", detail: `${puts.length} alert${puts.length>1?"s":""} · ${fmtMoney(putPrem)} premium` };
  }
  return { dot: C.yellow, label: "Mixed", sub: "Calls + Puts", detail: `${calls.length}C / ${puts.length}P` };
}

function techSignal(sc) {
  if (!sc || Object.keys(sc).length === 0) return { dot: C.dim, label: "No data", sub: "", detail: null };
  const ivr = sc.iv_rank != null ? Number(sc.iv_rank) : null;
  const pcr = sc.put_call_ratio != null ? Number(sc.put_call_ratio) : null;
  const rvol = sc.relative_volume != null ? Number(sc.relative_volume) : null;
  // Sentiment from put/call ratio + IV rank
  const bullish = (pcr != null && pcr < 0.5) ? 1 : 0;
  const bearish = (pcr != null && pcr > 1.2) ? 1 : 0;
  const highIV = ivr != null && ivr > 70;
  let dot = C.dim, label = "Neutral", sub = "Routine";
  if (bullish) { dot = C.green; label = "Bullish"; sub = "Call-heavy flow"; }
  else if (bearish) { dot = C.red; label = "Bearish"; sub = "Put-heavy flow"; }
  if (highIV) { dot = C.yellow; label = label === "Neutral" ? "Elevated IV" : label; sub = sub + (highIV ? " · IV elevated" : ""); }
  const details = [];
  if (ivr != null) details.push(`IVR ${ivr.toFixed(0)}`);
  if (pcr != null) details.push(`P/C ${pcr.toFixed(2)}`);
  if (rvol != null) details.push(`RVol ${rvol.toFixed(1)}×`);
  return { dot, label, sub, detail: details.join(" · ") || null };
}

// ── Signal column ─────────────────────────────────────────────────────────────
function SignalCol({ title, dot, label, sub, detail }) {
  return (
    <div style={{ flex: 1, minWidth: 100, padding: "10px 12px", borderRight: `1px solid ${C.border}` }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: C.dim, fontFamily: "monospace", letterSpacing: "0.1em", marginBottom: 6 }}>{title}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: dot, flexShrink: 0, display: "inline-block" }} />
        <span style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{label}</span>
      </div>
      {sub && <div style={{ fontSize: 12, color: C.dim, marginBottom: detail ? 4 : 0 }}>{sub}</div>}
      {detail && <div style={{ fontSize: 11, color: C.dim, lineHeight: 1.5 }}>{detail}</div>}
    </div>
  );
}

// ── Rich ticker card ──────────────────────────────────────────────────────────
// SubCompositeStrip (6-bar TECH/OPT/INS/CON/ANL/DP + OVERALL chip) is imported
// from ./components/SubCompositeStrip so portopps cards in App.jsx can reuse
// the exact same component — extracted 2026-04-19.
function RichCard({ ticker, price, score, tier, companyName, cc, ccNote, perfRow, ptsl, avgCost, signals, isPortfolio, highlight }) {
  const sc = (signals?.screener || {})[ticker] || {};
  const cBuys  = signals?.congress_buys   || [];
  const iBuys  = signals?.insider_buys    || [];
  const cFlows = signals?.flow_alerts     || [];
  const pFlows = signals?.put_flow_alerts || [];

  const congress = congressSignal(cBuys, ticker);
  const insider  = insiderSignal(iBuys, ticker);
  const flow     = flowSignal(cFlows, pFlows, ticker);
  const tech     = techSignal(sc);

  const borderColor = tier === "buy" ? "rgba(48,209,88,0.35)"
    : tier === "watch" ? "rgba(255,214,10,0.35)"
    : "rgba(10,132,255,0.30)";

  const priceChg = sc.close && sc.prev_close
    ? ((Number(sc.close) - Number(sc.prev_close)) / Number(sc.prev_close)) * 100
    : null;

  return (
    <div id={`scanner-card-${ticker}`} data-ticker={ticker} style={{
      border: `${highlight?2:1}px solid ${highlight?"var(--accent)":borderColor}`,
      borderRadius: 8, marginBottom: 12, overflow: "hidden",
      boxShadow: highlight?"0 0 0 3px rgba(10,132,255,0.15), 0 4px 14px rgba(0,0,0,0.08)":"none",
      transition: "box-shadow 240ms ease, border-color 240ms ease",
      scrollMarginTop: 80,
    }}>
      {/* Header row */}
      <div style={{ background: "var(--surface-3)", padding: "12px 14px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
          <span style={{ fontSize: 17, fontWeight: 800, color: C.text, fontFamily: "monospace" }}>{ticker}</span>
          <span style={{ fontSize: 13, color: C.dim }}>{companyName}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 16, fontWeight: 700, color: C.text, fontFamily: "monospace" }}>{fmt$(price)}</span>
          {priceChg != null && (
            <span style={{ fontSize: 12, color: priceChg >= 0 ? C.green : C.red, fontFamily: "monospace" }}>
              {fmtPct(priceChg)}
            </span>
          )}
          {score != null && (
            <span style={{
              background: score >= 60 ? "rgba(48,209,88,0.20)" : score >= 35 ? "rgba(255,214,10,0.18)" : "var(--surface-3)",
              color: score >= 60 ? C.greenT : score >= 35 ? C.yellowT : C.dim,
              border: `1px solid ${score >= 60 ? "rgba(48,209,88,0.35)" : score >= 35 ? "rgba(255,214,10,0.35)" : "var(--border)"}`,
              fontSize: 12, fontWeight: 800, fontFamily: "monospace",
              padding: "2px 8px", borderRadius: 12,
            }}>{score}</span>
          )}
          {isPortfolio && (
            <span style={{ background: "rgba(10,132,255,0.18)", color: C.blue, border: `1px solid rgba(10,132,255,0.35)`,
              fontSize: 11, fontWeight: 700, fontFamily: "monospace", padding: "2px 8px", borderRadius: 3 }}>
              {score >= 60 ? "BUY MORE" : score >= 35 ? "HOLD +" : "HOLD"}
            </span>
          )}
        </div>
      </div>

      {/* Performance row */}
      {perfRow && (
        <div style={{ background: "var(--surface-2)", padding: "8px 14px", borderTop: `1px solid ${C.border}`,
          display: "flex", gap: 20, fontFamily: "monospace", fontSize: 13 }}>
          {perfRow}
        </div>
      )}

      {/* PT / SL / CC row */}
      {ptsl && (
        <div style={{ background: "var(--surface-2)", padding: "8px 14px", borderTop: `1px solid ${C.border}`,
          fontSize: 13, color: C.muted, fontFamily: "monospace" }}>
          {ptsl}
        </div>
      )}

      {/* CC recommendation */}
      {cc && (
        <div style={{ background: "rgba(48,209,88,0.08)", borderTop: `1px solid rgba(48,209,88,0.20)`, padding: "8px 14px" }}>
          <span style={{ color: C.green, fontWeight: 700, fontSize: 12, fontFamily: "monospace" }}>COVERED CALL: </span>
          <span style={{ color: C.muted, fontSize: 12, fontFamily: "monospace" }}>
            Sell {fmtDate(cc.expiry)} {fmt$(cc.strike)} Call · Bid {fmt$(cc.bid)} · {cc.annualized_yield}% yield · {cc.days_to_expiry} DTE · {cc.otm_pct}% OTM
          </span>
        </div>
      )}
      {!cc && ccNote && (
        <div style={{ background: "var(--surface-2)", borderTop: `1px solid ${C.border}`, padding: "7px 14px",
          fontSize: 12, color: C.dim, fontFamily: "monospace" }}>CC: {ccNote}</div>
      )}

      {/* 6-bar sub-composite strip — directional scores per section (same as
          the TickerDetailModal, but condensed for inline viewing). */}
      <SubCompositeStrip ticker={ticker} signals={signals} />

      {/* 4-signal grid */}
      <div style={{ display: "flex", borderTop: `1px solid ${C.border}`, background: "var(--surface-2)" }}>
        <SignalCol title="CONGRESS"     {...congress} />
        <SignalCol title="INSIDER"      {...insider}  />
        <SignalCol title="OPTIONS FLOW" {...flow}     />
        <div style={{ flex: 1, minWidth: 100, padding: "10px 12px" }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: C.dim, fontFamily: "monospace", letterSpacing: "0.1em", marginBottom: 6 }}>TECHNICAL</div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: tech.dot, flexShrink: 0, display: "inline-block" }} />
            <span style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{tech.label}</span>
          </div>
          {tech.sub && <div style={{ fontSize: 12, color: C.dim, marginBottom: tech.detail ? 4 : 0 }}>{tech.sub}</div>}
          {tech.detail && <div style={{ fontSize: 11, color: C.dim, lineHeight: 1.5 }}>{tech.detail}</div>}
        </div>
      </div>
    </div>
  );
}

// ── Section banner ────────────────────────────────────────────────────────────
function SectionBanner({ label, empty }) {
  return (
    <div style={{ background: "var(--accent-soft)", borderRadius: 6, padding: "10px 14px", marginBottom: 8, border: "1px solid var(--border-faint)" }}>
      <span style={{ fontSize: 15, fontWeight: 800, color: "var(--accent)", letterSpacing: "0.02em" }}>{label}</span>
    </div>
  );
}

// ── Overview tab ──────────────────────────────────────────────────────────────
// `userAccounts` / `userWatchlist` come from useUserPortfolio (Supabase / RLS)
// and are empty arrays when signed out. They replace the old public-artifact
// `data.watchlist` / `data.portfolio_positions` paths, which no longer ship
// personal data (see trading-scanner/scanner/reporter.py::_write_scan_data_json).
function OverviewTab({ data, focusTicker, userAccounts = [], userWatchlist = [], isSignedIn = false }) {
  const { buy_opportunities = [], watch_items = [], signals, config = {} } = data;
  const screenerMap = signals?.screener || {};
  const scoremap   = data.score_by_ticker || {};
  const ptPct = config.profit_target_pct || 20;
  const slPct = config.stop_loss_pct     || 15;

  const perfRow = (t) => {
    const sc = screenerMap[t] || {};
    // These fields may or may not be present depending on API version
    const w = sc.week_change  != null ? Number(sc.week_change)  * 100 : null;
    const m = sc.month_change != null ? Number(sc.month_change) * 100 : null;
    const y = sc.ytd_change   != null ? Number(sc.ytd_change)   * 100 : null;
    if (w == null && m == null && y == null) return null;
    const pctSpan = (label, v) => v == null ? null : (
      <span key={label}><span style={{ color: C.dim }}>{label} </span>
        <strong style={{ color: v >= 0 ? C.green : C.red }}>{fmtPct(v)}</strong>
      </span>
    );
    return [pctSpan("1W", w), pctSpan("1M", m), pctSpan("YTD", y)].filter(Boolean);
  };

  const renderBuyWatch = (item, tier) => {
    const t = item.ticker;
    const sc = screenerMap[t] || {};
    const price = item.current_price ?? Number(sc.prev_close);
    const pt = price ? price * (1 + ptPct / 100) : null;
    const sl = price ? price * (1 - slPct / 100) : null;
    const company = normalizeTickerName(sc.full_name || sc.company_name || (data.ticker_names||{})[t] || "");
    const ptsl = (
      <span>
        {pt && <><strong style={{ color: C.text }}>PT</strong> <span style={{ color: C.muted }}>{fmt$(pt)}</span></>}
        {sl && <><span style={{ color: C.dim }}> · </span><strong style={{ color: C.text }}>SL</strong> <span style={{ color: C.muted }}>{fmt$(sl)}</span></>}
        {(item.cc_note) && <><span style={{ color: C.dim }}> | CC: </span><span>{item.cc_note}</span></>}
        {/* Suppress the legacy "CC: checking criteria" placeholder. The scanner
            decides up front whether a ticker is eligible for covered-call
            screening (score / IV-rank / DTE gates). When neither covered_call
            nor cc_note is set, it means the scanner already passed on this
            name — silence is more accurate than an "in flight" placeholder. */}
      </span>
    );
    const perf = perfRow(t);
    return (
      <RichCard key={t} ticker={t} price={price} score={item.score} tier={tier}
        companyName={company} cc={item.covered_call} ccNote={item.covered_call ? null : item.cc_note}
        perfRow={perf} ptsl={ptsl} signals={signals} isPortfolio={false}
        highlight={focusTicker && t === focusTicker} />
    );
  };

  // Render a personal watchlist entry (signed-in-only — sourced from Supabase
  // via useUserPortfolio). Falls through to score/price data if the ticker
  // happens to be in the public universe too.
  const renderWatchlistEntry = (w) => {
    const t = w.ticker;
    const sc = screenerMap[t] || {};
    const price = Number(sc.close || sc.prev_close || 0) || null;
    const score = scoremap[t] ?? null;
    const company = normalizeTickerName(sc.full_name || sc.company_name || w.name || (data.ticker_names||{})[t] || "");
    const ptsl = (
      <span>
        {w.theme && <><strong style={{ color: C.text }}>Theme</strong> <span style={{ color: C.muted }}>{w.theme}</span></>}
        {score != null && <><span style={{ color: C.dim }}> · </span><strong style={{ color: C.text }}>Score</strong> <span style={{ color: C.muted }}>{score}</span>{score < 35 && <span style={{ color: C.dim }}> (below watch tier)</span>}</>}
      </span>
    );
    const perf = perfRow(t);
    return (
      <RichCard key={t} ticker={t} price={price} score={score}
        tier={score >= 60 ? "buy" : score >= 35 ? "watch" : "watchlist"}
        companyName={company} cc={null} ccNote={null}
        perfRow={perf} ptsl={ptsl} signals={signals} isPortfolio={false}
        highlight={focusTicker && t === focusTicker} />
    );
  };

  // Render one of the user's portfolio positions. Always-on rather than
  // conditional on score — the user wants to see their own book, period.
  // Entry price + quantity are personal data from Supabase (RLS-scoped).
  const renderPortfolioEntry = (p) => {
    const t = p.ticker;
    const sc = screenerMap[t] || {};
    const price = p.price != null ? Number(p.price) : (Number(sc.close || sc.prev_close || 0) || null);
    const score = scoremap[t] ?? null;
    const company = normalizeTickerName(p.name || sc.full_name || sc.company_name || (data.ticker_names||{})[t] || "");
    const qty    = p.quantity != null ? Number(p.quantity) : null;
    const avg    = p.avgCost != null ? Number(p.avgCost) : null;
    const ptsl = (
      <span>
        {qty != null && <><strong style={{ color: C.text }}>Qty</strong> <span style={{ color: C.muted }}>{qty.toLocaleString()}</span></>}
        {avg != null && <><span style={{ color: C.dim }}> · </span><strong style={{ color: C.text }}>Avg</strong> <span style={{ color: C.muted }}>{fmt$(avg)}</span></>}
        {score != null && <><span style={{ color: C.dim }}> · </span><strong style={{ color: C.text }}>Score</strong> <span style={{ color: C.muted }}>{score}</span></>}
      </span>
    );
    const perf = perfRow(t);
    return (
      <RichCard key={t} ticker={t} price={price} score={score} tier="portfolio"
        companyName={company} cc={null} ccNote={null} avgCost={avg}
        perfRow={perf} ptsl={ptsl} signals={signals} isPortfolio={true}
        highlight={focusTicker && t === focusTicker} />
    );
  };

  // Flatten positions across all accounts into a single de-duplicated ticker
  // list. If a ticker is held in multiple accounts we render once and sum
  // nothing (we don't know consolidated cost basis); the per-account view on
  // the Portfolio tab remains the source of truth for that.
  const positionsByTicker = {};
  for (const acct of userAccounts) {
    for (const pos of acct.positions || []) {
      if (!pos.ticker) continue;
      if (!positionsByTicker[pos.ticker]) positionsByTicker[pos.ticker] = pos;
    }
  }
  const portfolioEntries = Object.values(positionsByTicker);

  return (
    <div>
      {/* Disclosure banner — clarifies what the Buy & Watch surface is doing
          and how signed-in augmentation behaves, so users aren't confused by
          an empty "Your Book" section when unauthenticated. */}
      <div style={{ color: C.dim, fontSize: 12, marginBottom: 16, fontFamily: "monospace", lineHeight: 1.6 }}>
        <strong style={{ color: C.muted }}>RECOMMENDATIONS</strong> and <strong style={{ color: C.muted }}>WATCHLIST (Near Trigger)</strong> are scored from public market signals (Congress, insiders, options flow, dark pool) — same for every visitor.
        {isSignedIn
          ? <> The <strong style={{ color: C.muted }}>YOUR BOOK</strong> and <strong style={{ color: C.muted }}>YOUR WATCHLIST</strong> sections below are pulled from your Supabase workspace (RLS-scoped — no other user sees them).</>
          : <> Sign in to overlay your own portfolio and watchlist alongside these picks.</>
        }
      </div>

      <SectionBanner label="RECOMMENDATIONS (Triggered)" />
      {buy_opportunities.length === 0
        ? <div style={{ color: C.dim, fontStyle: "italic", fontSize: 13, padding: "10px 14px", marginBottom: 16 }}>No entries this scan.</div>
        : <div style={{ marginBottom: 16 }}>{buy_opportunities.map(item => renderBuyWatch(item, "buy"))}</div>
      }

      <SectionBanner label="WATCHLIST (Near Trigger)" />
      {watch_items.length === 0
        ? <div style={{ color: C.dim, fontStyle: "italic", fontSize: 13, padding: "10px 14px", marginBottom: 16 }}>No entries this scan.</div>
        : <div style={{ marginBottom: 16 }}>{watch_items.map(item => renderBuyWatch(item, "watch"))}</div>
      }

      {isSignedIn && (
        <>
          <SectionBanner label="YOUR BOOK" empty={portfolioEntries.length === 0} />
          {portfolioEntries.length === 0
            ? <div style={{ color: C.dim, fontStyle: "italic", fontSize: 13, padding: "10px 14px", marginBottom: 16 }}>No positions yet. Add positions on the Portfolio tab.</div>
            : <div style={{ marginBottom: 16 }}>{portfolioEntries.map(renderPortfolioEntry)}</div>
          }

          <SectionBanner label="YOUR WATCHLIST" empty={userWatchlist.length === 0} />
          {userWatchlist.length === 0
            ? <div style={{ color: C.dim, fontStyle: "italic", fontSize: 13, padding: "10px 14px" }}>No watchlist yet. Add tickers on the Portfolio tab.</div>
            : <div>{userWatchlist.map(renderWatchlistEntry)}</div>
          }
        </>
      )}
    </div>
  );
}

// ── Sortable dark table ───────────────────────────────────────────────────────
// headers: array of strings (display labels)
// rows: array of { cells: [ReactNode], sortVals: [primitive] }
// If sortVals not provided, falls back to cell text content (strings only).
function SortableTable({ headers, rows }) {
  const [sortCol, setSortCol] = useState(null);
  const [sortDir, setSortDir] = useState("asc");

  const handleSort = (i) => {
    if (sortCol === i) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortCol(i); setSortDir("asc"); }
  };

  const sorted = useMemo(() => {
    if (sortCol === null) return rows;
    return [...rows].sort((a, b) => {
      const av = a.sortVals?.[sortCol] ?? a.cells[sortCol] ?? "";
      const bv = b.sortVals?.[sortCol] ?? b.cells[sortCol] ?? "";
      const cmp = typeof av === "number" && typeof bv === "number"
        ? av - bv
        : String(av).localeCompare(String(bv), undefined, { numeric: true });
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [rows, sortCol, sortDir]);

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, fontFamily: "monospace" }}>
        <thead>
          <tr style={{ borderBottom: `1px solid ${C.border2}` }}>
            {headers.map((h, i) => {
              // Allow headers to be either a plain string or { label, term }
              // so individual columns can carry a definition tooltip.
              const isObj = h && typeof h === "object";
              const label = isObj ? h.label : h;
              const term  = isObj ? h.term  : null;
              const key = isObj ? (h.key || label) : h;
              return (
                <th key={key} style={{
                  padding: "8px 10px", textAlign: "left", fontWeight: 700,
                  color: sortCol === i ? C.text : C.dim, fontSize: 11, letterSpacing: "0.08em",
                  whiteSpace: "nowrap", userSelect: "none",
                }}>
                  <span onClick={() => handleSort(i)} style={{ cursor: "pointer" }}>
                    {label}{sortCol === i ? (sortDir === "asc" ? " ▲" : " ▼") : " ·"}
                  </span>
                  {term && <InfoTip term={term} size={11} />}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row, i) => (
            <tr key={i} style={{ borderBottom: `1px solid ${C.border}`, background: i % 2 === 0 ? C.row1 : C.row2 }}>
              {row.cells.map((cell, j) => (
                <td key={j} style={{ padding: "8px 10px", color: C.muted, whiteSpace: "nowrap" }}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
// Convenience: build a row with matching sortVals from raw values
function mkRow(cells, sortVals) { return { cells, sortVals }; }

// ── Congress tab ──────────────────────────────────────────────────────────────
function CongressTab({ data, onOpenTicker }) {
  const buys  = data.signals?.congress_buys  || [];
  const sells = data.signals?.congress_sells || [];
  const all   = [
    ...buys.map(r  => ({ ...r, _dir: "Buy"  })),
    ...sells.map(r => ({ ...r, _dir: "Sell" })),
  ].sort((a, b) => new Date(b.transaction_date || 0) - new Date(a.transaction_date || 0));

  // Member-detail modal state — lifts one level up from the row so we can
  // pass it the full trade list and compute aggregates from it.
  const [memberFocus, setMemberFocus] = useState(null);

  if (!all.length) return (
    <div style={{ color: C.dim, textAlign: "center", padding: 40, fontFamily: "monospace", fontSize: 13 }}>
      No congressional trades in the lookback window (last 45 days).
    </div>
  );

  // Aggregate per-member counts so the MEMBER column can show a subtle "N trades" hint.
  const memberCounts = {};
  all.forEach(r => { const n = (r.name || r.reporter || "").trim(); if (n) memberCounts[n] = (memberCounts[n] || 0) + 1; });

  const linkStyle = { color: C.text, fontWeight: 600, cursor: "pointer", textDecoration: "underline", textDecorationColor: "rgba(128,128,128,0.35)", textUnderlineOffset: 3 };
  const tickerLinkStyle = { color: C.text, fontWeight: 800, cursor: onOpenTicker ? "pointer" : "default", textDecoration: onOpenTicker ? "underline" : "none", textDecorationColor: "rgba(128,128,128,0.35)", textUnderlineOffset: 3 };

  return (
    <div>
      <div style={{ color: C.dim, fontSize: 12, marginBottom: 16, fontFamily: "monospace" }}>
        Congressional trades disclosed under the STOCK Act · 45-day lookback · Click a member or ticker for detail.
      </div>
      <SortableTable
        headers={["DATE","MEMBER","PARTY","CHAMBER","TICKER","DIRECTION","AMOUNT","FILED"]}
        rows={all.map((r, i) => {
          const dir = r.txn_type || r._dir || "";
          const party = partyOf(r);
          const memberName = r.name || r.reporter || "";
          const tradeCount = memberCounts[memberName] || 0;
          return mkRow([
            <span style={{ color: C.dim }}>{fmtDate(r.transaction_date)}</span>,
            memberName
              ? <span style={linkStyle} onClick={() => setMemberFocus(memberName)} title={`View all ${tradeCount} disclosed trade${tradeCount===1?"":"s"} by ${memberName} in the lookback window`}>{memberName}</span>
              : <span style={{ color: C.text, fontWeight: 600 }}>—</span>,
            <PartyBadge party={party} />,
            <span style={{ color: C.dim, textTransform: "capitalize" }}>{r.member_type || "—"}</span>,
            onOpenTicker
              ? <span style={tickerLinkStyle} onClick={() => onOpenTicker(r.ticker)} title={`View ${r.ticker} flow, technicals, and short interest`}>{r.ticker}</span>
              : <span style={{ color: C.text, fontWeight: 800 }}>{r.ticker}</span>,
            <Badge label={dir} color={dir === "Buy" ? "green" : "red"} />,
            <span style={{ color: C.muted }}>{r.amounts || r.amount || "—"}</span>,
            <span style={{ color: C.dim }}>{fmtDate(r.filed_at_date || r.disclosure_date)}</span>,
          ], [r.transaction_date, memberName, party||"Z", r.member_type||"", r.ticker, dir, r.amounts||"", r.filed_at_date||""]);
        })}
      />
      {memberFocus && (
        <MemberDetailModal
          member={memberFocus}
          allTrades={all}
          onClose={() => setMemberFocus(null)}
          onOpenTicker={onOpenTicker}
        />
      )}
    </div>
  );
}

// ── Member detail modal (Congress) ────────────────────────────────────────────
// Summarizes everything one member has disclosed in the 45-day lookback window:
// aggregate buy/sell counts, position-by-ticker breakdown, and full chronological trade list.
function MemberDetailModal({ member, allTrades, onClose, onOpenTicker }) {
  const mine = useMemo(
    () => allTrades.filter(r => (r.name || r.reporter || "").trim() === member),
    [allTrades, member]
  );

  // Close on Escape.
  useEffect(() => {
    const h = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  const party = partyOf(mine[0] || {});
  const chamber = (mine[0]?.member_type || "").replace(/^\w/, c => c.toUpperCase());
  const buyCt  = mine.filter(r => (r.txn_type || r._dir) === "Buy").length;
  const sellCt = mine.filter(r => (r.txn_type || r._dir) === "Sell").length;

  // Per-ticker roll-up: sign-counted net trades (buys minus sells), last trade date.
  const byTicker = {};
  mine.forEach(r => {
    const t = r.ticker || "?";
    if (!byTicker[t]) byTicker[t] = { ticker: t, buys: 0, sells: 0, last: null, amounts: [] };
    const d = (r.txn_type || r._dir);
    if (d === "Buy") byTicker[t].buys++;
    else if (d === "Sell") byTicker[t].sells++;
    const td = r.transaction_date ? new Date(r.transaction_date) : null;
    if (td && (!byTicker[t].last || td > byTicker[t].last)) byTicker[t].last = td;
    if (r.amounts || r.amount) byTicker[t].amounts.push(r.amounts || r.amount);
  });
  const tickerRows = Object.values(byTicker).sort((a, b) => (b.buys + b.sells) - (a.buys + a.sells));

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 1000,
        background: "rgba(0,0,0,0.65)", backdropFilter: "blur(4px)",
        display: "flex", alignItems: "flex-start", justifyContent: "center",
        padding: "60px 20px", overflowY: "auto",
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: "var(--surface)", border: `1px solid ${C.border2}`, borderRadius: 10,
          width: "100%", maxWidth: 820, padding: "24px 28px",
          boxShadow: "0 20px 60px rgba(0,0,0,0.45)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
          <div>
            <div style={{ fontSize: 11, color: C.dim, fontFamily: "monospace", letterSpacing: "0.1em", marginBottom: 6 }}>CONGRESSIONAL MEMBER</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: C.text, display: "flex", alignItems: "center", gap: 10 }}>
              {member}
              <PartyBadge party={party} />
              {chamber && <span style={{ fontSize: 12, color: C.dim, fontWeight: 500, textTransform: "none" }}>· {chamber}</span>}
            </div>
          </div>
          <Tip def="Close (Esc)"><button
            onClick={onClose}
            style={{ background: "transparent", border: `1px solid ${C.border}`, color: C.muted, borderRadius: 6, padding: "4px 10px", cursor: "pointer", fontFamily: "monospace", fontSize: 12 }}
          >Close</button></Tip>
        </div>

        {/* Aggregate summary */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, margin: "18px 0" }}>
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: "12px 14px" }}>
            <div style={{ fontSize: 10, color: C.dim, fontFamily: "monospace", letterSpacing: "0.1em", marginBottom: 4 }}>TOTAL TRADES</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: C.text }}>{mine.length}</div>
          </div>
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: "12px 14px" }}>
            <div style={{ fontSize: 10, color: C.dim, fontFamily: "monospace", letterSpacing: "0.1em", marginBottom: 4 }}>BUYS</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: C.greenT }}>{buyCt}</div>
          </div>
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: "12px 14px" }}>
            <div style={{ fontSize: 10, color: C.dim, fontFamily: "monospace", letterSpacing: "0.1em", marginBottom: 4 }}>SELLS</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: C.redT }}>{sellCt}</div>
          </div>
        </div>

        {/* Per-ticker roll-up */}
        <div style={{ fontSize: 11, color: C.dim, fontFamily: "monospace", letterSpacing: "0.1em", marginTop: 18, marginBottom: 8 }}>POSITIONS TOUCHED</div>
        <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, overflow: "hidden" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1.2fr 0.6fr 0.6fr 1fr 1fr", background: C.row2, padding: "8px 12px", fontSize: 10, color: C.dim, fontFamily: "monospace", letterSpacing: "0.08em" }}>
            <div>TICKER</div><div>BUYS</div><div>SELLS</div><div>LAST</div><div>AMOUNTS</div>
          </div>
          {tickerRows.map((row, i) => (
            <div key={row.ticker} style={{ display: "grid", gridTemplateColumns: "1.2fr 0.6fr 0.6fr 1fr 1fr", padding: "10px 12px", borderTop: `1px solid ${C.border}`, background: i % 2 ? C.row1 : C.row2, fontSize: 13 }}>
              <div>
                {onOpenTicker
                  ? <span style={{ color: C.text, fontWeight: 800, cursor: "pointer", textDecoration: "underline", textDecorationColor: "rgba(128,128,128,0.35)", textUnderlineOffset: 3 }} onClick={() => { onOpenTicker(row.ticker); onClose(); }}>{row.ticker}</span>
                  : <span style={{ color: C.text, fontWeight: 800 }}>{row.ticker}</span>}
              </div>
              <div style={{ color: row.buys > 0 ? C.greenT : C.dim, fontWeight: 600 }}>{row.buys || "—"}</div>
              <div style={{ color: row.sells > 0 ? C.redT : C.dim, fontWeight: 600 }}>{row.sells || "—"}</div>
              <div style={{ color: C.muted, fontSize: 12 }}>{row.last ? row.last.toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—"}</div>
              <div style={{ color: C.dim, fontSize: 11, fontFamily: "monospace" }}>{row.amounts.slice(0, 2).join(" / ")}{row.amounts.length > 2 ? ` +${row.amounts.length-2}` : ""}</div>
            </div>
          ))}
        </div>

        {/* Full chronological trade list */}
        <div style={{ fontSize: 11, color: C.dim, fontFamily: "monospace", letterSpacing: "0.1em", marginTop: 20, marginBottom: 8 }}>ALL DISCLOSED TRADES (chronological)</div>
        <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, overflow: "hidden", maxHeight: 300, overflowY: "auto" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 0.8fr 1.2fr 1fr", background: C.row2, padding: "8px 12px", fontSize: 10, color: C.dim, fontFamily: "monospace", letterSpacing: "0.08em", position: "sticky", top: 0 }}>
            <div>DATE</div><div>TICKER</div><div>DIR</div><div>AMOUNT</div><div>FILED</div>
          </div>
          {mine.map((r, i) => {
            const dir = r.txn_type || r._dir || "";
            return (
              <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 0.8fr 1.2fr 1fr", padding: "8px 12px", borderTop: `1px solid ${C.border}`, background: i % 2 ? C.row1 : C.row2, fontSize: 12 }}>
                <div style={{ color: C.muted }}>{fmtDate(r.transaction_date)}</div>
                <div>
                  {onOpenTicker
                    ? <span style={{ color: C.text, fontWeight: 700, cursor: "pointer" }} onClick={() => { onOpenTicker(r.ticker); onClose(); }}>{r.ticker}</span>
                    : <span style={{ color: C.text, fontWeight: 700 }}>{r.ticker}</span>}
                </div>
                <div><Badge label={dir} color={dir === "Buy" ? "green" : "red"} /></div>
                <div style={{ color: C.muted }}>{r.amounts || r.amount || "—"}</div>
                <div style={{ color: C.dim }}>{fmtDate(r.filed_at_date || r.disclosure_date)}</div>
              </div>
            );
          })}
        </div>

        <div style={{ fontSize: 10, color: C.dim, marginTop: 14, fontStyle: "italic" }}>
          Source: disclosures filed under the STOCK Act, 45-day lookback window. Exact share counts are not disclosed — only dollar-range brackets ($1K–$15K, $15K–$50K, etc.).
        </div>
      </div>
    </div>
  );
}

// ── Insiders tab ──────────────────────────────────────────────────────────────
function InsidersTab({ data, onOpenTicker }) {
  const buys  = data.signals?.insider_buys  || [];
  const sales = data.signals?.insider_sales || [];
  const all   = [
    ...buys.map(r  => ({ ...r, _dir: "Purchase" })),
    ...sales.map(r => ({ ...r, _dir: "Sale"     })),
  ].sort((a, b) => new Date(b.filing_date || b.transaction_date || 0) - new Date(a.filing_date || a.transaction_date || 0));

  if (!all.length) return (
    <div style={{ color: C.dim, textAlign: "center", padding: 40, fontFamily: "monospace", fontSize: 13 }}>
      No insider transactions in the lookback window.
    </div>
  );

  return (
    <div>
      <div style={{ color: C.dim, fontSize: 12, marginBottom: 16, fontFamily: "monospace" }}>
        SEC Form 4 filings · Open-market purchases (code P) and sales (code S) · Excludes 10b5-1 automatic plan transactions
      </div>
      <SortableTable
        headers={["FILING DATE","INSIDER","TITLE","TICKER","DIRECTION","SHARES","VALUE","PRICE"]}
        rows={all.map(r => {
          const price  = r.price_per_share ? Number(r.price_per_share)
                       : r.price         ? Number(r.price)
                       : r.stock_price   ? Number(r.stock_price)
                       : null;
          const sharesBefore = r.shares_owned_before ? Number(r.shares_owned_before) : null;
          const sharesAfter  = r.shares_owned_after  ? Number(r.shares_owned_after)  : null;
          // r.amount from UW API is share count, not dollar value — compute value from shares × price
          const rawShares    = r.shares ? Number(r.shares) : (r.amount ? Number(r.amount) : null);
          const sharesTraded = (sharesBefore != null && sharesAfter != null)
            ? Math.abs(sharesAfter - sharesBefore)
            : rawShares;
          const value = sharesTraded != null && price != null ? sharesTraded * price : null;
          const title = r.officer_title || r.insider_title || (r.is_director ? "Director" : "—");
          return mkRow([
            <span style={{ color: C.dim }}>{fmtDate(r.filing_date || r.transaction_date)}</span>,
            <span style={{ color: C.text, fontWeight: 600 }}>{r.owner_name || r.insider_name || r.name || "—"}</span>,
            <span style={{ color: C.dim, fontSize: 11 }}>{title}</span>,
            onOpenTicker
              ? <span style={{ color: C.text, fontWeight: 800, cursor: "pointer", textDecoration: "underline", textDecorationColor: "rgba(128,128,128,0.35)", textUnderlineOffset: 3 }} onClick={() => onOpenTicker(r.ticker)} title={`View ${r.ticker} flow, technicals, and short interest`}>{r.ticker}</span>
              : <span style={{ color: C.text, fontWeight: 800 }}>{r.ticker}</span>,
            <Badge label={r._dir} color={r._dir === "Purchase" ? "green" : "red"} />,
            <span style={{ color: C.muted }}>{sharesTraded ? sharesTraded.toLocaleString() : "—"}</span>,
            <span style={{ color: C.text, fontWeight: 600 }}>{fmtMoney(value)}</span>,
            <span style={{ color: C.muted }}>{fmt$(price)}</span>,
          ], [r.filing_date||"", r.owner_name||"", title, r.ticker, r._dir, sharesTraded||0, value||0, price||0]);
        })}
      />
    </div>
  );
}

// ── Options Flow tab ──────────────────────────────────────────────────────────
function FlowTab({ data, onOpenTicker }) {
  const [typeFilter, setTypeFilter] = useState("all");
  const calls = data.signals?.flow_alerts     || [];
  const puts  = data.signals?.put_flow_alerts || [];
  const all   = [...calls, ...puts].sort((a, b) => {
    const ta = a.start_time || new Date(a.created_at||0).getTime();
    const tb = b.start_time || new Date(b.created_at||0).getTime();
    return tb - ta;
  });
  const filtered = typeFilter === "all" ? all : all.filter(r => (r.type||"").toLowerCase() === typeFilter);

  const fmtDateTime = (r) => {
    const ts = r.start_time || (r.created_at ? new Date(r.created_at).getTime() : null);
    if (!ts) return "—";
    const d = new Date(ts);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) + " " +
           d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true });
  };

  const moneyness = (r) => {
    const strike = r.strike ? Number(r.strike) : null;
    const under  = r.underlying_price ? Number(r.underlying_price) : null;
    if (strike == null || under == null || under === 0) return null;
    return ((strike - under) / under) * 100; // positive = OTM for call, ITM for put
  };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 16, flexWrap: "wrap" }}>
        <div style={{ color: C.dim, fontSize: 12, fontFamily: "monospace" }}>
          Unusual Whales flow alerts · Min premium $50K · {all.length} alerts ({calls.length} calls / {puts.length} puts)
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          {["all","call","put"].map(f => (
            <button key={f} onClick={() => setTypeFilter(f)} style={{
              padding: "3px 10px", fontSize: 11, fontWeight: 700, fontFamily: "monospace",
              background: typeFilter === f ? (f === "put" ? C.red : f === "call" ? C.green : C.accent) : "transparent",
              color: typeFilter === f ? "#fff" : C.dim,
              border: `1px solid ${typeFilter === f ? "transparent" : C.border2}`,
              borderRadius: 3, cursor: "pointer", letterSpacing: "0.05em",
            }}>{f.toUpperCase()}</button>
          ))}
        </div>
      </div>

      {!filtered.length ? (
        <div style={{ color: C.dim, textAlign: "center", padding: 40, fontFamily: "monospace", fontSize: 13 }}>
          No {typeFilter === "all" ? "" : typeFilter + " "}flow alerts in the current lookback window.
        </div>
      ) : (
        <SortableTable
          headers={[
            "DATE / TIME",
            "TICKER",
            "TYPE",
            { label: "STRIKE",    term: "STRIKE"    },
            "UNDERLYING",
            { label: "MONEYNESS", term: "MONEYNESS" },
            "EXPIRY",
            { label: "PREMIUM",   term: "PREMIUM"   },
            { label: "VOL / OI",  term: "VOL / OI"  },
          ]}
          rows={filtered.map(r => {
            const prem   = r.total_premium    ? Number(r.total_premium)    : null;
            const oi     = r.open_interest    ? Number(r.open_interest)    : null;
            const vol    = r.volume           ? Number(r.volume)           : null;
            const strike = r.strike           ? Number(r.strike)           : null;
            const under  = r.underlying_price ? Number(r.underlying_price) : null;
            const mono   = moneyness(r);
            const isCall = (r.type||"").toLowerCase() === "call";
            // for calls: positive mono = OTM (strike > underlying), negative = ITM
            // for puts:  positive mono = ITM (strike > underlying), negative = OTM
            const monoLabel = mono == null ? "—"
              : `${mono >= 0 ? "+" : ""}${mono.toFixed(1)}%`;
            const monoColor = mono == null ? C.dim
              : isCall
                ? (mono > 0 ? C.dim : C.green)   // call OTM = neutral, ITM = green
                : (mono > 0 ? C.green : C.dim);   // put ITM = green, OTM = neutral
            const ts = r.start_time || (r.created_at ? new Date(r.created_at).getTime() : 0);
            return mkRow([
              <span style={{ color: C.dim, fontSize: 12 }}>{fmtDateTime(r)}</span>,
              onOpenTicker
                ? <span style={{ color: C.text, fontWeight: 800, cursor: "pointer", textDecoration: "underline", textDecorationColor: "rgba(128,128,128,0.35)", textUnderlineOffset: 3 }} onClick={() => onOpenTicker(r.ticker)} title={`View ${r.ticker} flow, technicals, and short interest`}>{r.ticker}</span>
                : <span style={{ color: C.text, fontWeight: 800 }}>{r.ticker}</span>,
              <Badge label={(r.type||"call").toUpperCase()} color={isCall ? "green" : "red"} />,
              <span style={{ color: C.muted }}>{strike != null ? fmt$(strike) : "—"}</span>,
              <span style={{ color: C.muted }}>{under  != null ? fmt$(under)  : "—"}</span>,
              <span style={{ color: monoColor, fontWeight: 600 }}>{monoLabel}</span>,
              <span style={{ color: C.dim }}>{fmtDate(r.expiry || r.expires)}</span>,
              <span style={{ color: isCall ? C.green : C.red, fontWeight: 700 }}>{fmtMoney(prem)}</span>,
              <span style={{ color: C.muted }}>{vol ? vol.toLocaleString() : "—"} / {oi ? oi.toLocaleString() : "—"}</span>,
            ], [ts, r.ticker, r.type||"", strike||0, under||0, mono||0, r.expiry||"", prem||0, vol||0]);
          })}
        />
      )}
    </div>
  );
}

// ── Composite SIGNAL badge ────────────────────────────────────────────────────
// Renders the SCTR-style -100..+100 composite score as a colored pill with the
// qualitative label ("BULL", "NEUTRAL", etc.) and optional regime suffix
// ("× CONFIRMED" / "× CHOPPY"). Falls back to "—" if the backend returned no
// composite for this ticker (insufficient price history, ETF, etc.).
function CompositeBadge({ composite }) {
  if (!composite || composite.score == null) {
    return <span style={{ color: C.dim }}>—</span>;
  }
  const { score, label, regime } = composite;
  // Color picker — mirror the bull/neutral/bear gradient used in RichCards.
  let col = C.muted;
  if (score >= 50)       col = C.green;
  else if (score >= 20)  col = C.greenT;
  else if (score <= -50) col = C.red;
  else if (score <= -20) col = C.redT;
  // Slim inline presentation so it fits in a sortable-table cell alongside the
  // other technical signals without blowing up row height.
  return (
    <span style={{ display: "inline-flex", alignItems: "baseline", gap: 6 }}>
      <span style={{ color: col, fontWeight: 800, fontSize: 12, letterSpacing: "0.02em" }}>
        {score >= 0 ? "+" : ""}{score}
      </span>
      <span style={{ color: col, fontSize: 10, fontWeight: 700, letterSpacing: "0.04em" }}>{label}</span>
      {regime === "CHOPPY" && (
        <span style={{ color: C.dim, fontSize: 9, fontWeight: 600, letterSpacing: "0.04em" }}>CHOP</span>
      )}
    </span>
  );
}

// ── Technicals tab ────────────────────────────────────────────────────────────
// `userTickers` is the list of tickers from the signed-in user's portfolio +
// watchlist (empty array when signed out). Those get overlaid on top of the
// public buy/watch universe so Joe's book shows up on Technicals when signed
// in, without that data ever touching the public latest_scan_data.json.
function TechnicalsTab({ data, onOpenTicker, userTickers = [], isSignedIn = false }) {
  const { buy_opportunities = [], watch_items = [], signals, wide_universe } = data;
  const screener   = signals?.screener    || {};
  const technicals = signals?.technicals  || {};

  // Wide-universe direction tags — populated by the scanner's pre-filter pass
  // (scanner/universe_builder.py). Maps ticker → "long" | "short". Tickers
  // without a tag came from UW signals (congress, insider, flow, darkpool)
  // and aren't direction-classified; they render in the "All" view.
  const wuLong  = new Set((wide_universe?.long  || []).map(t => (t || "").toUpperCase()));
  const wuShort = new Set((wide_universe?.short || []).map(t => (t || "").toUpperCase()));
  const directionOf = (t) => wuLong.has(t) ? "long" : wuShort.has(t) ? "short" : "unclassified";

  // Public universe = every ticker that has technical data computed (the
  // full scannable universe), unioned with buy/watch picks. User-book tickers
  // get layered on top so a signed-in user sees their holdings even if those
  // names didn't make the public scan universe.
  const publicUniverse = new Set([
    ...Object.keys(technicals),
    ...buy_opportunities.map(o => o.ticker),
    ...watch_items.map(w => w.ticker),
  ]);
  const allTickersUnfiltered = [
    ...publicUniverse,
    ...userTickers.filter(t => !publicUniverse.has(t)),
  ];

  // Direction filter — default to "long" since that's the common case.
  // "all" shows everything (long + short + unclassified UW names).
  const [directionFilter, setDirectionFilter] = useState("long");
  const hasDirectionData = wuLong.size > 0 || wuShort.size > 0;

  const allTickers = useMemo(() => {
    if (!hasDirectionData || directionFilter === "all") return allTickersUnfiltered;
    return allTickersUnfiltered.filter(t => {
      const d = directionOf((t || "").toUpperCase());
      if (directionFilter === "long")  return d === "long"  || d === "unclassified";
      if (directionFilter === "short") return d === "short" || d === "unclassified";
      return true;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [directionFilter, hasDirectionData, allTickersUnfiltered.length]);

  if (!allTickersUnfiltered.length) return (
    <div style={{ color: C.dim, textAlign: "center", padding: 40, fontFamily: "monospace", fontSize: 13 }}>No tickers to display.</div>
  );

  const macdBadge = (v) => {
    if (!v || v === "neutral") return <span style={{ color: C.dim }}>—</span>;
    const col = v === "bullish" ? C.green : C.red;
    return <span style={{ color: col, fontWeight: 600, fontSize: 11 }}>{v.toUpperCase()}</span>;
  };
  const maBadge = (above) => {
    if (above == null) return <span style={{ color: C.dim }}>—</span>;
    return <span style={{ color: above ? C.green : C.red, fontWeight: 600, fontSize: 11 }}>{above ? "▲ ABOVE" : "▼ BELOW"}</span>;
  };
  const pctStyle = (v) => ({ color: v == null ? C.dim : v >= 0 ? C.green : C.red, fontWeight: v != null ? 600 : 400 });

  // Build a lookup so we can badge rows that came from the user's book.
  const userSet = new Set(userTickers);
  const publicSet = publicUniverse;

  return (
    <div>
      <div style={{ color: C.dim, fontSize: 12, marginBottom: 8, fontFamily: "monospace" }}>
        Price changes from Yahoo Finance (yfinance) · RSI, MACD, ADX &amp; MA position computed daily · IV rank and volume from Unusual Whales
      </div>
      <div style={{ color: C.dim, fontSize: 11, marginBottom: 12, fontFamily: "monospace", lineHeight: 1.5 }}>
        <strong style={{ color: C.muted }}>SIGNAL</strong> is a composite -100 to +100 directional tape-strength score (SCTR-weighted: long-term trend 60% / mid 30% / short 10%), with ADX regime confirmation and volume confirmation. See Methodology.
        {isSignedIn && userTickers.length > 0 && (
          <> · <strong style={{ color: C.muted }}>Your</strong> tickers show dashes for indicators that weren't computed this run — personal tickers aren't part of the public scan universe.</>
        )}
      </div>
      {hasDirectionData && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14, fontFamily: "monospace", fontSize: 11 }}>
          <span style={{ color: C.dim, letterSpacing: "0.04em" }}>DIRECTION</span>
          {[
            { key: "long",  label: `Long (${wuLong.size})`,   col: C.green },
            { key: "short", label: `Short (${wuShort.size})`, col: C.red },
            { key: "all",   label: "All",                     col: C.muted },
          ].map(opt => {
            const active = directionFilter === opt.key;
            return (
              <button
                key={opt.key}
                onClick={() => setDirectionFilter(opt.key)}
                style={{
                  padding: "4px 10px",
                  border: `1px solid ${active ? opt.col : C.border2}`,
                  background: active ? `${opt.col}22` : "transparent",
                  color: active ? opt.col : C.muted,
                  fontFamily: "monospace",
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: "0.04em",
                  cursor: "pointer",
                  borderRadius: 3,
                }}
                aria-pressed={active}
              >
                {opt.label.toUpperCase()}
              </button>
            );
          })}
          <span style={{ color: C.dim, marginLeft: 4 }}>
            · Gate-filtered from S&amp;P 500 + Nasdaq 100 + Dow 30
          </span>
        </div>
      )}
      <SortableTable
        headers={[
          "TICKER",
          "PRICE",
          { label: "SIGNAL",   term: "COMPOSITE" },
          { label: "1W",       term: "1W"      },
          { label: "1M",       term: "1M"      },
          { label: "YTD",      term: "YTD"     },
          { label: "RSI",      term: "RSI"     },
          { label: "MACD",     term: "MACD"    },
          { label: "vs 50MA",  term: "VS 50MA" },
          { label: "vs 200MA", term: "VS 200MA"},
          { label: "IVR",      term: "IVR"     },
          { label: "REL VOL",  term: "REL VOL" },
        ]}
        rows={allTickers.map(t => {
          const sc   = screener[t]   || {};
          const tech = technicals[t] || {};
          // PRICE fallback order: UW screener prev_close → UW close → yfinance
          // technicals close. The last fallback keeps the column populated for
          // tickers outside UW's bulk leaderboard (wide-universe survivors).
          const price = sc.prev_close != null ? Number(sc.prev_close)
                      : sc.close      != null ? Number(sc.close)
                      : tech.close    != null ? Number(tech.close)
                      : null;
          const ivr   = sc.iv_rank        != null ? Number(sc.iv_rank)         : null;
          const rvol  = sc.relative_volume != null ? Number(sc.relative_volume) : null;
          // Price changes from yfinance technicals
          const p1w   = tech.week_change  != null ? Number(tech.week_change)  : null;
          const p1m   = tech.month_change != null ? Number(tech.month_change) : null;
          const pytd  = tech.ytd_change   != null ? Number(tech.ytd_change)   : null;
          const rsi   = tech.rsi_14       != null ? Number(tech.rsi_14)       : null;
          const rsiCol = rsi == null ? C.dim : rsi > 70 ? C.red : rsi < 30 ? C.green : C.muted;
          // Composite object (score + label + regime) emitted by technicals.py.
          // Artifacts written before the composite rollout show "—" here until
          // the next scheduled scan refreshes the data.
          const comp = tech.composite || null;
          // Badge to mark user-only rows (portfolio or watchlist, not also in public)
          const inUserOnly = userSet.has(t) && !publicSet.has(t);
          const tickerCell = (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              {onOpenTicker
                ? <span style={{ color: C.text, fontWeight: 800, cursor: "pointer", textDecoration: "underline", textDecorationColor: "rgba(128,128,128,0.35)", textUnderlineOffset: 3 }} onClick={() => onOpenTicker(t)} title={`View ${t} flow, technicals, and short interest`}>{t}</span>
                : <span style={{ color: C.text, fontWeight: 800 }}>{t}</span>}
              {inUserOnly && (
                <span style={{ fontSize: 9, color: C.accent, fontWeight: 700, letterSpacing: "0.05em", padding: "1px 5px", border: `1px solid ${C.border2}`, borderRadius: 3 }}>YOURS</span>
              )}
            </span>
          );
          return mkRow([
            tickerCell,
            <span style={{ color: C.text, fontWeight: 600 }}>{fmt$(price)}</span>,
            <CompositeBadge composite={comp} />,
            <span style={pctStyle(p1w)}>{p1w  != null ? fmtPct(p1w  * 100) : "—"}</span>,
            <span style={pctStyle(p1m)}>{p1m  != null ? fmtPct(p1m  * 100) : "—"}</span>,
            <span style={pctStyle(pytd)}>{pytd != null ? fmtPct(pytd * 100) : "—"}</span>,
            <span style={{ color: rsiCol, fontWeight: 600 }}>{rsi != null ? rsi.toFixed(0) : "—"}</span>,
            macdBadge(tech.macd_cross),
            maBadge(tech.above_50ma),
            maBadge(tech.above_200ma),
            <span style={{ color: C.muted }}>{ivr  != null ? ivr.toFixed(0)         : "—"}</span>,
            <span style={{ color: C.muted }}>{rvol != null ? rvol.toFixed(1) + "×"  : "—"}</span>,
          ], [
            t,
            price || 0,
            comp && comp.score != null ? comp.score : -999,
            p1w || 0, p1m || 0, pytd || 0,
            rsi || 0, tech.macd_cross || "",
            tech.above_50ma ? 1 : 0, tech.above_200ma ? 1 : 0,
            ivr || 0, rvol || 0,
          ]);
        })}
      />
    </div>
  );
}

// ── MethodologyTab retired 2026-04-22 ────────────────────────────────────────
// The in-scanner methodology drill-down was superseded by the site-wide
// Methodology page (#readme). The scanner tile now opens /#readme directly
// rather than rendering a parallel (and drift-prone) copy here.

// ── Main Scanner component ────────────────────────────────────────────────────
export default function Scanner({ focusTicker = null, onFocusConsumed, onOpenTicker }) {
  // Start on the landing page (tile grid). The prior focusTicker → "overview"
  // deep-link behavior was retired 2026-04-19 along with the Buy & Watch list
  // tile; portopps is now the canonical surface for per-ticker detail.
  const [view, setView] = useState("landing");
  const [rawData, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Signed-in overlay. The public latest_scan_data.json deliberately contains
  // no user-specific data; we merge the user's Supabase portfolio + watchlist
  // here on the client. RLS makes this a no-op for unauthenticated callers
  // (accounts/watchlist come back empty → identical to signed-out view).
  const { session } = useSession();
  const { accounts: userAccounts = [], watchlist: userWatchlistRows = [] } = useUserPortfolio();
  // Per-user scan supplement — technicals/screener/analyst/info/news for the
  // user's watchlist tickers that the scanner kept out of the public artifact.
  // `mergeInto` is pass-through when signed out (byTicker is empty).
  const { mergeInto: mergePrivateScan } = usePrivateScanSupplement();
  // 3x-weekday universe snapshot — fresh prices / IV / flow / marketcap /
  // calendar for every equity ≥ $1B mcap. Layers BEFORE the private supplement
  // so universe values win on overlapping fields while private fills the gaps
  // universe doesn't cover (technicals_json, analyst_ratings, news).
  const { mergeInto: mergeUniverseSnapshot } = useUniverseSnapshot();
  // 3x-weekday ticker events — news / insider / congress / darkpool stream
  // grouped per-ticker. Layers AFTER the private supplement so it writes to a
  // new `signals.events` subtree without colliding with the screener overlay.
  // See hooks/useTickerEvents.js for the filter-by-purpose rationale.
  const { mergeInto: mergeTickerEvents } = useTickerEvents();
  const isSignedIn = Boolean(session?.user?.id);

  // Flatten user accounts → distinct ticker list for the Technicals overlay.
  // Watchlist tickers are included so the whole "what I care about" set gets
  // composite scores on the Technicals tab.
  const userTickers = useMemo(() => {
    const s = new Set();
    for (const acct of userAccounts || []) {
      for (const pos of acct.positions || []) {
        if (pos.ticker) s.add(String(pos.ticker).toUpperCase());
      }
    }
    for (const w of userWatchlistRows || []) {
      if (w.ticker) s.add(String(w.ticker).toUpperCase());
    }
    return [...s];
  }, [userAccounts, userWatchlistRows]);

  // focusTicker deep-link flow retired 2026-04-19 along with the "overview"
  // (Buy & Watch list) tab. If a focusTicker ever arrives, just consume it so
  // the parent clears state — we no longer try to scroll into a specific card.
  useEffect(() => {
    if (focusTicker && onFocusConsumed) onFocusConsumed();
  }, [focusTicker, onFocusConsumed]);

  useEffect(() => {
    fetch(DATA_URL + "?t=" + Date.now())
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(d => { setData(d); setLoading(false); })
      .catch(e => { setError(e.message); setLoading(false); });
  }, []);

  // Layer the universe snapshot (3x/weekday, fresh prices / options / IV) and
  // the per-user private scan rows onto the public scan data. For signed-out
  // users both merges are pass-throughs; for signed-in users:
  //   - `mergeUniverseSnapshot` field-overlays close / prev_close / perc_change
  //     / marketcap / IV rank / options volume+OI+premium / 52w / earnings date
  //     from `public.universe_snapshots` (populated 10:00 / 13:00 / 15:45 ET).
  //   - `mergePrivateScan` fills in technicals / analyst / news / info that the
  //     universe snapshot doesn't cover, using the 3:30 PM per-user scan.
  // Order matters: universe runs first so the private supplement (whose guard
  // is `if (!nextScreener[T])`) only fills gaps instead of clobbering fresher
  // universe prices. Kept identical to App.jsx so every surface that reads
  // scanData — Watchlist, Positions, Ticker Detail, Scanner tabs — picks up
  // the fresher values without per-component edits.
  const data = useMemo(() => {
    if (!rawData) return rawData;
    let x = mergeUniverseSnapshot(rawData);
    x = mergePrivateScan(x);
    x = mergeTickerEvents(x);
    return x;
  }, [rawData, mergeUniverseSnapshot, mergePrivateScan, mergeTickerEvents]);

  if (loading) return (
    <div style={{ textAlign: "center", padding: 60, color: C.dim, fontFamily: "monospace", fontSize: 13 }}>
      Loading scan data…
    </div>
  );

  if (error) return (
    <div style={{ padding: "32px 24px", maxWidth: 600, margin: "0 auto" }}>
      <div style={{ background: C.card, border: `1px solid ${C.border2}`, borderRadius: 8, padding: "20px 24px" }}>
        <div style={{ fontSize: 11, color: C.yellow, fontFamily: "monospace", letterSpacing: "0.1em", marginBottom: 10 }}>SCAN DATA UNAVAILABLE</div>
        <div style={{ fontSize: 13, color: C.muted, marginBottom: 8 }}>
          No scan data is available yet. The scanner runs automatically at <strong style={{ color: C.text }}>3:30 PM ET on weekdays</strong> via GitHub Actions.
        </div>
        <div style={{ fontSize: 12, color: C.dim, marginBottom: 4 }}>
          This is normal if the market has not yet closed today, or if it is a weekend or holiday.
        </div>
        <div style={{ fontSize: 11, color: "var(--text-dim)", fontFamily: "monospace", marginTop: 12, paddingTop: 12, borderTop: `1px solid ${C.border}` }}>
          Last fetch attempt: {new Date().toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true })} ET · Error: {error}
        </div>
      </div>
    </div>
  );

  // ── KPI roll-ups (used in the tile previews) ───────────────────────────────
  const buyCount     = data.buy_opportunities?.length      || 0;
  const watchCount   = data.watch_items?.length            || 0;
  const congressBuyN  = data.signals?.congress_buys?.length  || 0;
  const congressSellN = data.signals?.congress_sells?.length || 0;
  const congressN     = congressBuyN + congressSellN;
  const insiderBuyN   = data.signals?.insider_buys?.length   || 0;
  const insiderSellN  = data.signals?.insider_sales?.length  || 0;
  const insiderN      = insiderBuyN + insiderSellN;
  const callFlowN    = data.signals?.flow_alerts?.length   || 0;
  const putFlowN     = data.signals?.put_flow_alerts?.length || 0;
  const flowN        = callFlowN + putFlowN;
  const screenerKeys = Object.keys(data.signals?.screener || {});
  // Public tech count is the full scannable universe — every ticker that has
  // technical data computed, plus any buy/watch picks that happened to live
  // outside that dict. User tickers get layered on top when signed in so the
  // landing tile reads "N public · M yours" and matches what the table shows.
  const techPublicSet = new Set([
    ...Object.keys(data.signals?.technicals || {}),
    ...(data.buy_opportunities || []).map(o => o.ticker),
    ...(data.watch_items || []).map(w => w.ticker),
  ]);
  const techPublicCount = techPublicSet.size;
  const techUserOnlyCount = userTickers.filter(t => !techPublicSet.has(t)).length;
  const techCount = techPublicCount + (isSignedIn ? techUserOnlyCount : 0);

  // Top tickers per surface (combined buys + sells so tile previews match the detail tables)
  const congressAll = [
    ...(data.signals?.congress_buys  || []),
    ...(data.signals?.congress_sells || []),
  ];
  const insiderAll = [
    ...(data.signals?.insider_buys  || []),
    ...(data.signals?.insider_sales || []),
  ];
  const totalCallPrem = (data.signals?.flow_alerts || []).reduce((a, r) => a + (Number(r.total_premium) || 0), 0);
  const totalPutPrem  = (data.signals?.put_flow_alerts || []).reduce((a, r) => a + (Number(r.total_premium) || 0), 0);
  const highIVR       = screenerKeys.filter(t => {
    const v = data.signals.screener[t]?.iv_rank;
    return v != null && Number(v) > 70;
  }).length;

  // ── Bug #4b — anomaly-first landing tiles ──────────────────────────────────
  // The landing tiles used to show aggregate counts + party splits. Aggregates
  // don't tell a user whether today is notable. These helpers compute the top
  // 3 most-noteworthy items for each surface so the tile reads as "what's
  // worth a deeper dive right now" instead of "how many things happened".
  // Ranking is dollar-weighted where available (congress amount bucket midpoint,
  // insider shares × price, option total_premium, absolute composite score).

  // Congress: amounts are bucket strings like "$1,001 - $15,000". Parse the
  // midpoint so we can rank trades by estimated dollar size.
  const congressAmountMidpoint = (amt) => {
    if (!amt || typeof amt !== "string") return 0;
    const nums = amt.match(/[\d,]+/g);
    if (!nums) return 0;
    const vals = nums.map(s => Number(s.replace(/,/g, ""))).filter(n => isFinite(n) && n > 0);
    if (vals.length >= 2) return (vals[0] + vals[1]) / 2;
    return vals[0] || 0;
  };
  const topCongressTrades = congressAll
    .map(r => ({ row: r, amtMid: congressAmountMidpoint(r.amounts) }))
    .filter(x => x.amtMid > 0)
    .sort((a, b) => b.amtMid - a.amtMid)
    .slice(0, 3);

  // Insider: rank by absolute dollar value of the transaction. Flag 10%-owner
  // buys and S&P 500 director buys as particularly noteworthy.
  const topInsiderTrades = insiderAll
    .map(r => {
      const shares = Math.abs(Number(r.amount) || 0);
      const px = Number(r.price || r.stock_price || 0);
      const usd = shares * px;
      return { row: r, usd, isBuy: (Number(r.amount) || 0) > 0 };
    })
    .filter(x => x.usd > 0)
    .sort((a, b) => b.usd - a.usd)
    .slice(0, 3);

  // Flow: combine calls + puts, rank by total_premium. Surface strike/expiry
  // and flag sweep/repeated-hits alerts — those are the actionable ones.
  const topFlowAlerts = [
    ...(data.signals?.flow_alerts || []).map(r => ({ ...r, _side: "call" })),
    ...(data.signals?.put_flow_alerts || []).map(r => ({ ...r, _side: "put" })),
  ]
    .map(r => ({ row: r, prem: Number(r.total_premium) || 0 }))
    .filter(x => x.prem > 0)
    .sort((a, b) => b.prem - a.prem)
    .slice(0, 3);

  // Technicals: rank by absolute composite score (−100..+100). Most extreme
  // readings — long-bias strong bulls and short-bias strong bears — get
  // surfaced so users see where the signal is most decisive.
  const topTechnicals = Object.entries(data.signals?.technicals || {})
    .map(([ticker, v]) => ({
      ticker,
      score: Number(v?.composite?.score ?? 0),
      label: v?.composite?.label || "",
      rsi: v?.rsi_14 != null ? Number(v.rsi_14) : null,
    }))
    .filter(x => x.score !== 0)
    .sort((a, b) => Math.abs(b.score) - Math.abs(a.score))
    .slice(0, 3);

  const scanTime = data?.scan_time ? new Date(data.scan_time) : null;
  const scanLabel = scanTime
    ? `${scanTime.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })} · ${scanTime.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", timeZoneName: "short" })}`
    : "—";

  // Bug #5b / #1079 — stale-data guard, weekend-aware. The scanner runs at
  // 3:30 PM ET on US trading days only (see .github/workflows/daily-scan.yml).
  // The "stale" thresholds skip the wall-clock weekend gap: data that's old
  // because markets are closed isn't stale, it's just up-to-date. The chip
  // should only flag stale during weekdays when a real refresh window has
  // been missed.
  const scanAgeHours = scanTime ? (Date.now() - scanTime.getTime()) / 3600_000 : null;
  // Hours of weekend wall-clock between the scan and now. We exclude those
  // from the "age" the user sees, so Friday 15:30 ET → Monday 09:00 ET reads
  // as ~17h old, not ~65h old.
  const weekendOffHours = (() => {
    if (!scanTime) return 0;
    let off = 0;
    const cur = new Date(scanTime.getTime());
    const stop = Date.now();
    while (cur.getTime() < stop) {
      // Walk in 1-hour increments; cheap, runs once per render. getDay() on a
      // Date constructed from the ET wall-clock string returns 0 (Sun) / 6 (Sat).
      const dayET = new Date(cur.toLocaleString("en-US", { timeZone: "America/New_York" })).getDay();
      if (dayET === 0 || dayET === 6) off += 1;
      cur.setTime(cur.getTime() + 60 * 60 * 1000);
    }
    return off;
  })();
  const effectiveAgeHours = scanAgeHours != null ? Math.max(0, scanAgeHours - weekendOffHours) : null;
  const STALE_H = 24;   // amber: "may be stale" (weekday hours only)
  const VERY_STALE_H = 48; // red: "is stale, next scan at ..." (weekday hours only)
  const isStale = effectiveAgeHours != null && effectiveAgeHours >= STALE_H;
  const isVeryStale = effectiveAgeHours != null && effectiveAgeHours >= VERY_STALE_H;
  const staleCopy = !isStale ? null
    : isVeryStale
      ? `Scanner data is ${Math.floor(effectiveAgeHours / 24)} trading days old — the daily scan may have failed. Treat signals as stale until the next run.`
      : `Scanner data is ${Math.round(effectiveAgeHours)} trading hours old — fresher-than-daily signals (options flow, insider activity) may be outdated.`;

  // ── LANDING — tile grid ────────────────────────────────────────────────────
  if (view === "landing") {
    return (
      <main style={{ maxWidth: 1440, margin: "0 auto", padding: "var(--space-4) var(--space-8) var(--space-10)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 12, marginBottom: "var(--space-6)" }}>
          <div className="section-eyebrow">Latest scan</div>
          <span style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
            {/* Data-freshness chip — sits next to the scan time so the user
                can see both the 1x/day scan and the 3x/day price + 3x/day
                events refresh stamps at a glance. Rendered nothing for
                signed-out. */}
            <UniverseFreshness pricesTs={data?.universe_snapshot_ts} eventsTs={data?.ticker_events_ts} />
            <span style={{ fontSize: 12, color: "var(--text-dim)", fontFamily: "var(--font-mono)" }}>{scanLabel}</span>
          </span>
        </div>

        {staleCopy && (
          <div
            role="status"
            aria-live="polite"
            style={{
              display: "flex", alignItems: "flex-start", gap: 10,
              padding: "10px 14px",
              marginBottom: "var(--space-5)",
              background: "rgba(255,159,10,0.10)",     // amber tint on --orange
              border: "1px solid rgba(255,159,10,0.35)",
              borderRadius: "var(--radius-sm)",
              fontSize: 13, lineHeight: 1.45,
              color: "var(--orange-text)",
              fontFamily: "var(--font-mono)",
            }}
          >
            <span aria-hidden="true" style={{ fontSize: 14, lineHeight: 1.3 }}>⚠</span>
            <span>
              <strong style={{ fontWeight: 700, marginRight: 6 }}>
                {isVeryStale ? "VERY STALE" : "STALE"}
              </strong>
              {staleCopy}
            </span>
          </div>
        )}

        <div className="scanner-tile-grid" style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
          gap: "var(--space-4)",
        }}>
          {/* "Buy & Watch list" tile retired 2026-04-19 — see TAB_META note above.
              Portfolio & Insights (portopps) is the canonical surface for buy/watch/positions. */}

          <Tile
            eyebrow={TAB_META.congress.eyebrow}
            title={TAB_META.congress.title}
            sub="Top 3 disclosed trades by dollar size — click tile for full table."
            accent={TAB_META.congress.accent}
            kpi={{ value: congressN, unit: "trades (45d)", color: congressN > 0 ? "var(--accent)" : "var(--text-muted)" }}
            onClick={() => setView("congress")}
          >
            <AnomalyList
              items={topCongressTrades}
              empty="No disclosed trades in the last 45 days."
              renderItem={({ row, amtMid }, i) => {
                const party = partyOf(row);
                const partyStyle = PARTY_META[party] || null;
                const isBuy = /buy/i.test(row.txn_type || "");
                const sideCol = isBuy ? "var(--green-text)" : "var(--red-text)";
                return (
                  <AnomalyRow key={i}
                    left={
                      <>
                        <span style={{ fontWeight: 700, color: "var(--text)" }}>{row.ticker}</span>
                        {partyStyle && (
                          <span style={{
                            fontSize: 9, padding: "1px 5px", borderRadius: 3,
                            background: partyStyle.bg, color: partyStyle.color,
                            border: `1px solid ${partyStyle.border}`, fontFamily: "var(--font-mono)", fontWeight: 700,
                            marginLeft: 6,
                          }}>{partyStyle.label}</span>
                        )}
                        <span style={{ color: "var(--text-muted)", marginLeft: 6, fontSize: 11 }}>
                          {row.name || "—"}
                        </span>
                      </>
                    }
                    right={
                      <>
                        <span style={{ color: sideCol, fontWeight: 700, marginRight: 6 }}>{isBuy ? "BUY" : "SELL"}</span>
                        <span className="num" style={{ color: "var(--text)", fontFamily: "var(--font-mono)", fontWeight: 700 }}>{fmtMoney(amtMid)}</span>
                      </>
                    }
                  />
                );
              }}
            />
          </Tile>

          <Tile
            eyebrow={TAB_META.insiders.eyebrow}
            title={TAB_META.insiders.title}
            sub="Top 3 Form 4 trades by dollar value — 10%-owner and officer buys flagged."
            accent={TAB_META.insiders.accent}
            kpi={{ value: insiderN, unit: "Form 4s", color: insiderN > 0 ? "#bf5af2" : "var(--text-muted)" }}
            onClick={() => setView("insiders")}
          >
            <AnomalyList
              items={topInsiderTrades}
              empty="No insider Form 4 activity today."
              renderItem={({ row, usd, isBuy }, i) => {
                const sideCol = isBuy ? "var(--green-text)" : "var(--red-text)";
                const flags = [];
                if (row.is_ten_percent_owner) flags.push("10% OWNER");
                else if (row.is_officer) flags.push("OFFICER");
                else if (row.is_director) flags.push("DIR");
                if (row.is_s_p_500) flags.push("S&P");
                return (
                  <AnomalyRow key={i}
                    left={
                      <>
                        <span style={{ fontWeight: 700, color: "var(--text)" }}>{row.ticker}</span>
                        <span style={{ color: "var(--text-muted)", marginLeft: 6, fontSize: 11, textTransform: "capitalize" }}>
                          {(row.owner_name || "—").toLowerCase().replace(/\b\w/g, c => c.toUpperCase())}
                        </span>
                        {flags.length > 0 && (
                          <span style={{
                            fontSize: 9, padding: "1px 5px", borderRadius: 3,
                            background: "var(--surface-3)", color: "var(--text-muted)",
                            border: "1px solid var(--border-faint)",
                            fontFamily: "var(--font-mono)", fontWeight: 700, marginLeft: 6, letterSpacing: "0.04em",
                          }}>{flags.join(" · ")}</span>
                        )}
                      </>
                    }
                    right={
                      <>
                        <span style={{ color: sideCol, fontWeight: 700, marginRight: 6 }}>{isBuy ? "BUY" : "SELL"}</span>
                        <span className="num" style={{ color: "var(--text)", fontFamily: "var(--font-mono)", fontWeight: 700 }}>{fmtMoney(usd)}</span>
                      </>
                    }
                  />
                );
              }}
            />
          </Tile>

          <Tile
            eyebrow={TAB_META.flow.eyebrow}
            title={TAB_META.flow.title}
            sub={`Top 3 by premium · Calls ${fmtMoney(totalCallPrem)} · Puts ${fmtMoney(totalPutPrem)}`}
            accent={TAB_META.flow.accent}
            kpi={{ value: flowN, unit: "alerts", color: flowN > 0 ? "#ff9f0a" : "var(--text-muted)" }}
            onClick={() => setView("flow")}
          >
            <AnomalyList
              items={topFlowAlerts}
              empty="No unusual flow alerts today."
              renderItem={({ row, prem }, i) => {
                const isCall = row._side === "call";
                const sideCol = isCall ? "var(--green-text)" : "var(--red-text)";
                const hasSweep = row.has_sweep;
                return (
                  <AnomalyRow key={i}
                    left={
                      <>
                        <span style={{ fontWeight: 700, color: "var(--text)" }}>{row.ticker}</span>
                        <span style={{ color: sideCol, fontSize: 11, fontWeight: 700, marginLeft: 6 }}>
                          {isCall ? "CALL" : "PUT"}
                        </span>
                        <span style={{ color: "var(--text-muted)", marginLeft: 6, fontSize: 11, fontFamily: "var(--font-mono)" }}>
                          ${Number(row.strike).toFixed(0)} {row.expiry ? `· ${String(row.expiry).slice(5)}` : ""}
                        </span>
                        {hasSweep && (
                          <span style={{
                            fontSize: 9, padding: "1px 5px", borderRadius: 3,
                            background: "rgba(255,159,10,0.12)", color: "var(--orange-text)",
                            border: "1px solid rgba(255,159,10,0.30)", fontFamily: "var(--font-mono)", fontWeight: 700,
                            marginLeft: 6, letterSpacing: "0.04em",
                          }}>SWEEP</span>
                        )}
                      </>
                    }
                    right={
                      <span className="num" style={{ color: "var(--text)", fontFamily: "var(--font-mono)", fontWeight: 700 }}>{fmtMoney(prem)}</span>
                    }
                  />
                );
              }}
            />
          </Tile>

          <Tile
            eyebrow={TAB_META.technicals.eyebrow}
            title={TAB_META.technicals.title}
            sub={`Top 3 most decisive signals${highIVR > 0 ? ` · ${highIVR} with IV >70` : ""}${isSignedIn && techUserOnlyCount > 0 ? ` · +${techUserOnlyCount} in your book` : ""}`}
            accent={TAB_META.technicals.accent}
            kpi={{ value: techCount, unit: "tickers", color: "var(--text)" }}
            onClick={() => setView("technicals")}
          >
            <AnomalyList
              items={topTechnicals}
              empty="No decisive technical signals in this scan."
              renderItem={(t, i) => {
                const isBull = t.score > 0;
                const sideCol = isBull ? "var(--green-text)" : "var(--red-text)";
                return (
                  <AnomalyRow key={i}
                    left={
                      <>
                        <span style={{ fontWeight: 700, color: "var(--text)" }}>{t.ticker}</span>
                        <span style={{ color: "var(--text-muted)", marginLeft: 6, fontSize: 11, fontFamily: "var(--font-mono)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                          {t.label || (isBull ? "BULL" : "BEAR")}
                        </span>
                      </>
                    }
                    right={
                      <>
                        {t.rsi != null && (
                          <span style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: 11, marginRight: 8 }}>
                            RSI {t.rsi.toFixed(0)}
                          </span>
                        )}
                        <span className="num" style={{ color: sideCol, fontFamily: "var(--font-mono)", fontWeight: 700 }}>
                          {isBull ? "+" : ""}{t.score}
                        </span>
                      </>
                    }
                  />
                );
              }}
            />
          </Tile>

          {/* "How the scanner scores" tile killed 2026-04-27 (Joe ask) — methodology link lives in the footer + About page. */}
        </div>
      </main>
    );
  }

  // ── DRILL-DOWN — selected tab content with back button ─────────────────────
  const meta = TAB_META[view];
  return (
    <div style={{ maxWidth: 1440, margin: "0 auto" }}>
      <div style={{ padding: "var(--space-4) var(--space-8) var(--space-3)" }}>
        <button onClick={() => setView("landing")} style={{
          display: "inline-flex", alignItems: "center", gap: 6,
          fontSize: 13, fontWeight: 500, color: "var(--text-muted)",
          padding: "6px 12px", borderRadius: 999,
          background: "var(--surface-3)", border: "1px solid var(--border-faint)",
          cursor: "pointer", fontFamily: "var(--font-sans)",
          transition: "all var(--dur-fast) var(--ease)",
        }}
          onMouseEnter={e => { e.currentTarget.style.background = "var(--hover)"; e.currentTarget.style.color = "var(--text)"; }}
          onMouseLeave={e => { e.currentTarget.style.background = "var(--surface-3)"; e.currentTarget.style.color = "var(--text-muted)"; }}
        >
          <span style={{ fontSize: 14 }}>←</span> All scanner sections
        </button>
        <div style={{ marginTop: "var(--space-3)" }}>
          {meta?.eyebrow && <div className="section-eyebrow" style={{ marginBottom: 6 }}>{meta.eyebrow}</div>}
          {meta?.title && <h2 className="section-title" style={{ margin: 0 }}>{meta.title}</h2>}
          {meta?.sub && <div style={{ fontSize: 14, color: "var(--text-muted)", marginTop: 6, maxWidth: 720, lineHeight: 1.5 }}>{meta.sub}</div>}
        </div>
      </div>

      <div style={{ padding: "var(--space-2) var(--space-8) var(--space-8)" }}>
        {/* "overview" (Buy & Watch list) tab retired 2026-04-19 — portopps is the canonical surface.
            OverviewTab + renderBuyWatch are retained in this file as orphaned helpers for now
            (harmless dead code); clean up next time we touch this file. */}
        {view === "congress"    && <CongressTab    data={data} onOpenTicker={onOpenTicker} />}
        {view === "insiders"    && <InsidersTab    data={data} onOpenTicker={onOpenTicker} />}
        {view === "flow"        && <FlowTab        data={data} onOpenTicker={onOpenTicker} />}
        {view === "technicals"  && <TechnicalsTab  data={data} onOpenTicker={onOpenTicker}
                                      userTickers={userTickers} isSignedIn={isSignedIn} />}
        {/* "methodology" view retired 2026-04-22 — the tile now navigates to
            #readme (site-wide Methodology page) instead of a local drill-down. */}
      </div>
    </div>
  );
}
