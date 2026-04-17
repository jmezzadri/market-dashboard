/**
 * Trading Scanner Dashboard Tab
 * Dark-themed to match the Macro Dashboard aesthetic.
 */
import { useState, useEffect, useMemo } from "react";
import { Tile } from "./Shell";
import { InfoTip, HeadWithTip } from "./InfoTip";

const DATA_URL =
  "https://raw.githubusercontent.com/jmezzadri/market-dashboard/main/public/latest_scan_data.json";

const TAB_META = {
  overview:    { eyebrow: "Recommendations",   title: "Buy & Watch list",       sub: "Triggered entries, watchlist, and current positions with full signal context.",       accent: "#30d158" },
  congress:    { eyebrow: "Congressional",     title: "Congress activity",      sub: "Disclosed equity trades by U.S. Senators and Representatives in the last 45 days (buys and sells).", accent: "#0a84ff" },
  insiders:    { eyebrow: "Form 4 Insiders",   title: "Insider activity",       sub: "Open-market buys and sells by company officers, directors, and 10% holders filed with the SEC.",    accent: "#bf5af2" },
  flow:        { eyebrow: "Options Flow",      title: "Unusual flow alerts",    sub: "Large or unusual call and put options activity flagged by Unusual Whales.",           accent: "#ff9f0a" },
  technicals:  { eyebrow: "Technicals",        title: "IV, P/C, RSI, MACD",     sub: "IV rank, put/call ratio, relative volume, RSI and MACD across all scored tickers.",   accent: "#ffd60a" },
  methodology: { eyebrow: "Methodology",       title: "How the scanner scores", sub: "Scoring weights, data sources, refresh schedule, and tier thresholds.",                accent: "var(--text-dim)" },
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
function OverviewTab({ data, focusTicker }) {
  const { buy_opportunities = [], watch_items = [], portfolio_positions = [], signals, config = {} } = data;
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
    const company = sc.full_name || sc.company_name || "";
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

  const renderPortfolio = (pos) => {
    const t = pos.ticker;
    const sc = screenerMap[t] || {};
    const price = Number(sc.prev_close || sc.close || 0) || null;
    const score = scoremap[t] ?? null;
    const pt = pos.avg_cost * (1 + ptPct / 100);
    const sl = pos.avg_cost * (1 - slPct / 100);
    const company = sc.full_name || sc.company_name || "";
    const ptsl = (
      <span>
        <strong style={{ color: C.text }}>Avg cost</strong> <span style={{ color: C.muted }}>{fmt$(pos.avg_cost)}</span>
        <span style={{ color: C.dim }}> · </span><strong style={{ color: C.text }}>PT</strong> <span style={{ color: C.muted }}>{fmt$(pt)}</span>
        <span style={{ color: C.dim }}> · </span><strong style={{ color: C.text }}>SL</strong> <span style={{ color: C.muted }}>{fmt$(sl)}</span>
      </span>
    );
    const perf = perfRow(t);
    return (
      <RichCard key={t} ticker={t} price={price} score={score} tier="portfolio"
        companyName={company} cc={null} ccNote={null}
        perfRow={perf} ptsl={ptsl} signals={signals} isPortfolio={true}
        highlight={focusTicker && t === focusTicker} />
    );
  };

  // Render a watchlist entry (manual-track ticker — not in buy/watch/portfolio
  // but the scanner pulls full intel for it via the always-include path).
  const watchlist = data.watchlist || [];
  const renderWatchlistEntry = (w) => {
    const t = w.ticker;
    const sc = screenerMap[t] || {};
    const price = Number(sc.close || sc.prev_close || 0) || null;
    const score = scoremap[t] ?? null;
    const company = sc.full_name || sc.company_name || w.name || "";
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

  return (
    <div>
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

      <SectionBanner label="CURRENT PORTFOLIO" />
      {portfolio_positions.length === 0
        ? <div style={{ color: C.dim, fontStyle: "italic", fontSize: 13, padding: "10px 14px", marginBottom: 16 }}>No portfolio positions tracked.</div>
        : <div style={{ marginBottom: 16 }}>{portfolio_positions.map(pos => renderPortfolio(pos))}</div>
      }

      <SectionBanner label="MANUAL WATCHLIST" />
      {watchlist.length === 0
        ? <div style={{ color: C.dim, fontStyle: "italic", fontSize: 13, padding: "10px 14px" }}>No manual watchlist (edit <span style={{ fontFamily: "monospace" }}>portfolio/watchlist.csv</span> in the trading-scanner repo to populate).</div>
        : <div>{watchlist.map(renderWatchlistEntry)}</div>
      }
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
function CongressTab({ data }) {
  const buys  = data.signals?.congress_buys  || [];
  const sells = data.signals?.congress_sells || [];
  const all   = [
    ...buys.map(r  => ({ ...r, _dir: "Buy"  })),
    ...sells.map(r => ({ ...r, _dir: "Sell" })),
  ].sort((a, b) => new Date(b.transaction_date || 0) - new Date(a.transaction_date || 0));

  if (!all.length) return (
    <div style={{ color: C.dim, textAlign: "center", padding: 40, fontFamily: "monospace", fontSize: 13 }}>
      No congressional trades in the lookback window (last 45 days).
    </div>
  );

  return (
    <div>
      <div style={{ color: C.dim, fontSize: 12, marginBottom: 16, fontFamily: "monospace" }}>
        Congressional trades disclosed under the STOCK Act · 45-day lookback · Buys may signal conviction; sells may signal concern
      </div>
      <SortableTable
        headers={["DATE","MEMBER","PARTY","CHAMBER","TICKER","DIRECTION","AMOUNT","FILED"]}
        rows={all.map(r => {
          const dir = r.txn_type || r._dir || "";
          const party = partyOf(r);
          return mkRow([
            <span style={{ color: C.dim }}>{fmtDate(r.transaction_date)}</span>,
            <span style={{ color: C.text, fontWeight: 600 }}>{r.name || r.reporter || "—"}</span>,
            <PartyBadge party={party} />,
            <span style={{ color: C.dim, textTransform: "capitalize" }}>{r.member_type || "—"}</span>,
            <span style={{ color: C.text, fontWeight: 800 }}>{r.ticker}</span>,
            <Badge label={dir} color={dir === "Buy" ? "green" : "red"} />,
            <span style={{ color: C.muted }}>{r.amounts || r.amount || "—"}</span>,
            <span style={{ color: C.dim }}>{fmtDate(r.filed_at_date || r.disclosure_date)}</span>,
          ], [r.transaction_date, r.name||"", party||"Z", r.member_type||"", r.ticker, dir, r.amounts||"", r.filed_at_date||""]);
        })}
      />
    </div>
  );
}

// ── Insiders tab ──────────────────────────────────────────────────────────────
function InsidersTab({ data }) {
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
            <span style={{ color: C.text, fontWeight: 800 }}>{r.ticker}</span>,
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
function FlowTab({ data }) {
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
              <span style={{ color: C.text, fontWeight: 800 }}>{r.ticker}</span>,
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

// ── Technicals tab ────────────────────────────────────────────────────────────
function TechnicalsTab({ data }) {
  const { buy_opportunities = [], watch_items = [], portfolio_positions = [], signals } = data;
  const allTickers = [
    ...buy_opportunities.map(o => o.ticker),
    ...watch_items.map(w => w.ticker),
    ...portfolio_positions.map(p => p.ticker),
  ].filter((t, i, a) => a.indexOf(t) === i);

  const screener   = signals?.screener    || {};
  const technicals = signals?.technicals  || {};

  if (!allTickers.length) return (
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

  return (
    <div>
      <div style={{ color: C.dim, fontSize: 12, marginBottom: 16, fontFamily: "monospace" }}>
        Price changes from Yahoo Finance (yfinance) · RSI, MACD &amp; MA position computed daily · IV rank and volume from Unusual Whales
      </div>
      <SortableTable
        headers={[
          "TICKER",
          "PRICE",
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
          const price = sc.prev_close != null ? Number(sc.prev_close) : (sc.close != null ? Number(sc.close) : null);
          const ivr   = sc.iv_rank        != null ? Number(sc.iv_rank)         : null;
          const rvol  = sc.relative_volume != null ? Number(sc.relative_volume) : null;
          // Price changes from yfinance technicals
          const p1w   = tech.week_change  != null ? Number(tech.week_change)  : null;
          const p1m   = tech.month_change != null ? Number(tech.month_change) : null;
          const pytd  = tech.ytd_change   != null ? Number(tech.ytd_change)   : null;
          const rsi   = tech.rsi_14       != null ? Number(tech.rsi_14)       : null;
          const rsiCol = rsi == null ? C.dim : rsi > 70 ? C.red : rsi < 30 ? C.green : C.muted;
          return mkRow([
            <span style={{ color: C.text, fontWeight: 800 }}>{t}</span>,
            <span style={{ color: C.text, fontWeight: 600 }}>{fmt$(price)}</span>,
            <span style={pctStyle(p1w)}>{p1w  != null ? fmtPct(p1w  * 100) : "—"}</span>,
            <span style={pctStyle(p1m)}>{p1m  != null ? fmtPct(p1m  * 100) : "—"}</span>,
            <span style={pctStyle(pytd)}>{pytd != null ? fmtPct(pytd * 100) : "—"}</span>,
            <span style={{ color: rsiCol, fontWeight: 600 }}>{rsi != null ? rsi.toFixed(0) : "—"}</span>,
            macdBadge(tech.macd_cross),
            maBadge(tech.above_50ma),
            maBadge(tech.above_200ma),
            <span style={{ color: C.muted }}>{ivr  != null ? ivr.toFixed(0)         : "—"}</span>,
            <span style={{ color: C.muted }}>{rvol != null ? rvol.toFixed(1) + "×"  : "—"}</span>,
          ], [t, price||0, p1w||0, p1m||0, pytd||0, rsi||0, tech.macd_cross||"", tech.above_50ma?1:0, tech.above_200ma?1:0, ivr||0, rvol||0]);
        })}
      />
    </div>
  );
}

// ── Methodology tab ───────────────────────────────────────────────────────────
function MethodologyTab({ data }) {
  const cfg = data.config || {};
  const sections = [
    {
      title: "DATA SOURCES",
      rows: [
        ["Unusual Whales API", "Options flow alerts, dark pool prints, stock screener (price, IV rank, relative volume), and option contract chains."],
        ["Congress.gov / SEC EDGAR", "Congressional trade disclosures (STOCK Act) and insider Form 4 filings. Congressional lookback: 45 days. Insider lookback: 14 days."],
        ["Yahoo Finance", "Price history, RSI, moving averages, and company names."],
      ],
    },
    {
      title: "SCORING SYSTEM (0–100)",
      rows: [
        ["Options Flow", "Large or unusual call flow from Unusual Whales. Minimum premium $50K. Weighted by total premium and number of alerts."],
        ["Congressional Buys", "Open-market purchases disclosed by members of Congress. Scored by disclosed dollar amount and number of buyers. Cap of 40 points."],
        ["Insider Buys", "Open-market purchases (Form 4 code P) by officers and directors. Excludes Rule 10b5-1 automatic plan transactions."],
        ["Dark Pool", "Large off-exchange prints ($500K+ minimum). Treated as additional confirmation."],
        ["Technicals", "RSI, moving average positioning, and relative volume as tiebreakers."],
        [`Buy Tier (≥ ${cfg.score_buy_alert || 60})`, "Triggers a recommendation and covered call screening."],
        [`Watch Tier (${cfg.score_watch_alert || 35}–${(cfg.score_buy_alert || 60) - 1})`, "Near-trigger — worth monitoring for a developing setup."],
      ],
    },
    {
      title: "COVERED CALL CRITERIA",
      rows: [
        ["Min IV Rank", `≥ ${cfg.cc_min_iv_rank || 30} — sells premium when IV is elevated relative to its own history.`],
        ["Min Annualized Yield", `≥ ${cfg.cc_min_annualized_yield_pct || 25}% — bid premium ÷ stock price, annualized over DTE.`],
        ["OTM Rule (1-sigma)", `Strike must be ≥ IV × √(DTE/365) OTM — the 1 standard-deviation expected move.`],
        ["DTE Window", `${cfg.cc_min_dte || 14}–${cfg.cc_max_dte || 42} days to expiration.`],
        ["Bid-Ask Spread", "≤ 10% of mid-price."],
        ["Earnings Avoidance", "No calls selling through an earnings window (±7 days from next earnings)."],
      ],
    },
    {
      title: "PORTFOLIO TRIGGERS",
      rows: [
        ["Profit Target", `${cfg.profit_target_pct || 20}% above average cost basis. Informational only.`],
        ["Stop Loss", `${cfg.stop_loss_pct || 15}% below average cost basis. Triggers scan email alert.`],
        ["Score Collapse", "Alert fires if a position's signal score drops significantly from the prior scan."],
        ["Insider/Congress Reversal", "Alert fires if the same insider or politician who bought is now selling."],
      ],
    },
    {
      title: "SCAN SCHEDULE",
      rows: [
        ["Daily scan", "3:45 PM EDT, Monday–Friday via GitHub Actions."],
        ["Email delivery", "Sent automatically when buy or watch signals are present."],
        ["Data freshness", "Options flow and dark pool reflect intraday data at scan time. Congressional data can lag up to 45 days."],
      ],
    },
  ];

  // Title-case a section header originally in shouty caps ("DATA SOURCES" → "Data sources")
  const titleCase = s => s
    .toLowerCase()
    .replace(/(^|\s)\S/g, t => t.toUpperCase())
    .replace(/\bIv\b/g, "IV")
    .replace(/\bDte\b/g, "DTE")
    .replace(/\bOtm\b/g, "OTM");

  return (
    <div>
      {sections.map(sec => (
        <div key={sec.title} style={{ marginBottom: 28 }}>
          <h3 style={{ fontSize: 16, fontWeight: 700, color: C.text, margin: 0,
            marginBottom: 12, paddingBottom: 8, borderBottom: `1px solid ${C.border}`, letterSpacing: "-0.01em" }}>
            {titleCase(sec.title)}
          </h3>
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, overflow: "hidden" }}>
            {sec.rows.map(([label, desc], i) => (
              <div key={label} style={{
                display: "flex", gap: 18, padding: "12px 16px",
                borderBottom: i < sec.rows.length - 1 ? `1px solid ${C.border}` : "none",
                background: i % 2 === 0 ? C.row1 : C.row2,
              }}>
                <div style={{ minWidth: 200, fontWeight: 600, fontSize: 14, color: C.text, lineHeight: 1.5 }}>{label}</div>
                <div style={{ fontSize: 14, color: C.muted, flex: 1, lineHeight: 1.6 }}>{desc}</div>
              </div>
            ))}
          </div>
        </div>
      ))}
      <div style={{ color: C.muted, fontSize: 12, padding: "14px 0",
        borderTop: `1px solid ${C.border}`, lineHeight: 1.7 }}>
        <strong style={{ color: C.text }}>Not financial advice.</strong> This is a personal research tool for informational purposes only. Nothing here constitutes investment advice.
        Always do your own due diligence before making any investment decision. Data is sourced from third-party APIs and may contain errors or delays.
      </div>
    </div>
  );
}

// ── Main Scanner component ────────────────────────────────────────────────────
export default function Scanner({ focusTicker = null, onFocusConsumed }) {
  // When we're asked to focus on a specific ticker (from the portopps deep
  // link), start on the overview view — that's where the ticker's RichCard
  // lives. Otherwise start on the landing page as before.
  const [view, setView] = useState(focusTicker ? "overview" : "landing");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // If a new focusTicker comes in after mount (user re-clicks a different
  // ticker from portopps without leaving the tab), honor it.
  useEffect(() => {
    if (focusTicker) setView("overview");
  }, [focusTicker]);

  // After the overview renders, scroll to + briefly highlight the focused
  // ticker's card, then tell the parent we consumed the focus intent so a
  // re-render of the same ticker fires a fresh scroll+pulse.
  useEffect(() => {
    if (!focusTicker || loading || view !== "overview") return;
    const el = document.getElementById(`scanner-card-${focusTicker}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    const id = setTimeout(() => { if (onFocusConsumed) onFocusConsumed(); }, 2400);
    return () => clearTimeout(id);
  }, [focusTicker, loading, view, onFocusConsumed]);

  useEffect(() => {
    fetch(DATA_URL + "?t=" + Date.now())
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(d => { setData(d); setLoading(false); })
      .catch(e => { setError(e.message); setLoading(false); });
  }, []);

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
          No scan data is available yet. The scanner runs automatically at <strong style={{ color: C.text }}>3:45 PM ET on weekdays</strong> via GitHub Actions.
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
  const portCount    = data.portfolio_positions?.length    || 0;
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
  const techCount    = screenerKeys.length;

  // Top tickers per surface (combined buys + sells so tile previews match the detail tables)
  const congressAll = [
    ...(data.signals?.congress_buys  || []),
    ...(data.signals?.congress_sells || []),
  ];
  const insiderAll = [
    ...(data.signals?.insider_buys  || []),
    ...(data.signals?.insider_sales || []),
  ];
  const topCongress = (() => {
    const counts = {};
    congressAll.forEach(r => { counts[r.ticker] = (counts[r.ticker] || 0) + 1; });
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 3);
  })();
  const congressPartySplit = (() => {
    const c = { D: 0, R: 0, I: 0, "?": 0 };
    congressAll.forEach(r => {
      const p = partyOf(r);
      c[p || "?"] = (c[p || "?"] || 0) + 1;
    });
    return c;
  })();
  const topInsider = (() => {
    const counts = {};
    insiderAll.forEach(r => { counts[r.ticker] = (counts[r.ticker] || 0) + 1; });
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 3);
  })();
  const totalCallPrem = (data.signals?.flow_alerts || []).reduce((a, r) => a + (Number(r.total_premium) || 0), 0);
  const totalPutPrem  = (data.signals?.put_flow_alerts || []).reduce((a, r) => a + (Number(r.total_premium) || 0), 0);
  const highIVR       = screenerKeys.filter(t => {
    const v = data.signals.screener[t]?.iv_rank;
    return v != null && Number(v) > 70;
  }).length;

  const scanTime = data?.scan_time ? new Date(data.scan_time) : null;
  const scanLabel = scanTime
    ? `${scanTime.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })} · ${scanTime.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", timeZoneName: "short" })}`
    : "—";

  // ── LANDING — tile grid ────────────────────────────────────────────────────
  if (view === "landing") {
    return (
      <main style={{ maxWidth: 1440, margin: "0 auto", padding: "var(--space-4) var(--space-8) var(--space-10)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 12, marginBottom: "var(--space-6)" }}>
          <div className="section-eyebrow">Latest scan</div>
          <span style={{ fontSize: 12, color: "var(--text-dim)", fontFamily: "var(--font-mono)" }}>{scanLabel}</span>
        </div>

        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
          gap: "var(--space-4)",
          alignItems: "start",
        }}>
          <Tile
            eyebrow={TAB_META.overview.eyebrow}
            title={TAB_META.overview.title}
            sub={TAB_META.overview.sub}
            accent={TAB_META.overview.accent}
            kpi={{ value: buyCount, unit: "buy alerts", color: buyCount > 0 ? "var(--green-text)" : "var(--text-muted)" }}
            onClick={() => setView("overview")}
          >
            <div style={{ display: "flex", gap: 8, marginTop: "var(--space-2)", flexWrap: "wrap" }}>
              <MiniStat label="WATCH" value={watchCount} color="var(--yellow-text)" />
              <MiniStat label="HELD"  value={portCount}  color="var(--accent)" />
            </div>
          </Tile>

          <Tile
            eyebrow={TAB_META.congress.eyebrow}
            title={TAB_META.congress.title}
            sub={TAB_META.congress.sub}
            accent={TAB_META.congress.accent}
            kpi={{ value: congressN, unit: "trades (45d)", color: congressN > 0 ? "var(--accent)" : "var(--text-muted)" }}
            onClick={() => setView("congress")}
          >
            <div style={{ display: "flex", gap: 6, marginTop: "var(--space-2)", flexWrap: "wrap" }}>
              {["D", "R", "I"].map(p => (
                <span key={p} style={{
                  fontSize: 11, padding: "3px 9px", borderRadius: 999,
                  background: PARTY_META[p].bg, color: PARTY_META[p].color,
                  border: `1px solid ${PARTY_META[p].border}`,
                  fontFamily: "var(--font-mono)", fontWeight: 700,
                }}>{PARTY_META[p].label} {congressPartySplit[p] || 0}</span>
              ))}
              {congressPartySplit["?"] > 0 && (
                <span style={{
                  fontSize: 11, padding: "3px 9px", borderRadius: 999,
                  background: "var(--surface-3)", color: "var(--text-dim)",
                  border: "1px solid var(--border-faint)",
                  fontFamily: "var(--font-mono)", fontWeight: 600,
                }}>? {congressPartySplit["?"]}</span>
              )}
            </div>
            {topCongress.length > 0 && (
              <div style={{ display: "flex", gap: 4, marginTop: "var(--space-2)", flexWrap: "wrap" }}>
                {topCongress.map(([t, n]) => <Chip key={t} label={`${t} ×${n}`} />)}
              </div>
            )}
          </Tile>

          <Tile
            eyebrow={TAB_META.insiders.eyebrow}
            title={TAB_META.insiders.title}
            sub={TAB_META.insiders.sub}
            accent={TAB_META.insiders.accent}
            kpi={{ value: insiderN, unit: "Form 4s", color: insiderN > 0 ? "#bf5af2" : "var(--text-muted)" }}
            onClick={() => setView("insiders")}
          >
            {topInsider.length > 0 && (
              <div style={{ display: "flex", gap: 4, marginTop: "var(--space-2)", flexWrap: "wrap" }}>
                {topInsider.map(([t, n]) => <Chip key={t} label={`${t} ×${n}`} />)}
              </div>
            )}
          </Tile>

          <Tile
            eyebrow={TAB_META.flow.eyebrow}
            title={TAB_META.flow.title}
            sub={TAB_META.flow.sub}
            accent={TAB_META.flow.accent}
            kpi={{ value: flowN, unit: "alerts", color: flowN > 0 ? "#ff9f0a" : "var(--text-muted)" }}
            onClick={() => setView("flow")}
          >
            <div style={{ display: "flex", gap: 8, marginTop: "var(--space-2)", flexWrap: "wrap" }}>
              <MiniStat label="CALLS" value={`${callFlowN} · ${fmtMoney(totalCallPrem)}`} color="var(--green)" wide />
              <MiniStat label="PUTS"  value={`${putFlowN} · ${fmtMoney(totalPutPrem)}`}   color="var(--red)"   wide />
            </div>
          </Tile>

          <Tile
            eyebrow={TAB_META.technicals.eyebrow}
            title={TAB_META.technicals.title}
            sub={TAB_META.technicals.sub}
            accent={TAB_META.technicals.accent}
            kpi={{ value: techCount, unit: "tickers", color: "var(--text)" }}
            onClick={() => setView("technicals")}
          >
            <div style={{ display: "flex", gap: 8, marginTop: "var(--space-2)", flexWrap: "wrap" }}>
              <MiniStat label="HIGH IV (>70)" value={highIVR} color="var(--yellow-text)" wide />
            </div>
          </Tile>

          <Tile
            eyebrow={TAB_META.methodology.eyebrow}
            title={TAB_META.methodology.title}
            sub={TAB_META.methodology.sub}
            accent={TAB_META.methodology.accent}
            onClick={() => setView("methodology")}
          />
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
        {view === "overview"    && <OverviewTab    data={data} focusTicker={focusTicker} />}
        {view === "congress"    && <CongressTab    data={data} />}
        {view === "insiders"    && <InsidersTab    data={data} />}
        {view === "flow"        && <FlowTab        data={data} />}
        {view === "technicals"  && <TechnicalsTab  data={data} />}
        {view === "methodology" && <MethodologyTab data={data} />}
      </div>
    </div>
  );
}
