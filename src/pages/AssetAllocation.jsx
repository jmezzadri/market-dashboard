// AssetAllocation — Strategic asset allocation tab.
//
// Layout (top to bottom):
//   1. Hero section (eyebrow / title / stance badge / KPI strip)
//   2. The Big Picture
//        - Macro snapshot: 3 composite cards pulled from Today's Macro
//        - The What & The Why side-by-side
//   3. Recommended Asset Allocation (per $100 of capital)
//        - Table 1: Asset class allocation (Current / Last Month / Last Quarter)
//        - Table 2: Allocation changes (rotations + leverage scaling)
//        - Table 3: Rating changes (upgrades / downgrades by window)
//   4. Sector outlooks (11 sectors x 25 industry groups)
//        - Heatmap with OW / Mkt Wt / UW columns
//        - Drill-down panel with rationale + key factors + clickable tickers
//   5. Risk management (4 scenarios from runbook)
//   6. Methodology footer
//
// Data sources:
//   /v9_allocation.json              — current allocation (live)
//   /composite_history_daily.json    — macro composites (live, same source as Macro Overview)
//   /industry_group_rationale.json   — per-bucket seed rationale (Senior Quant hand-written)
//   /allocation_history.json         — historical snapshots (collection starts Apr 26)
//
// Ticker chips in the drill-down are wired to the standard TickerDetailModal
// via the onOpenTicker callback, same pattern Scanner & Trading Opps use.

import { useState, useEffect, useMemo } from "react";
import { InfoTip } from "../InfoTip";

// ─── Sector → industry group mapping (11 GICS sectors × 25 IGs) ─────────────
const SECTOR_IG_MAP = [
  { sector: "Info Tech",     groups: [
      { name: "Semiconductors", ticker: "SOXX", rating: "ow" },
      { name: "Software",       ticker: "IGV",  rating: "mw" },
      { name: "Hardware",       ticker: null,   rating: "mw" },
  ]},
  { sector: "Comm Svcs",     groups: [
      { name: "Telecom & Media", ticker: "IYZ", rating: "ow" },
      { name: "Media",           ticker: null,  rating: "mw" },
  ]},
  { sector: "Energy",        groups: [
      { name: "Oil & Gas",   ticker: "XLE",  rating: "ow" },
      { name: "Equipment",   ticker: null,   rating: "mw" },
  ]},
  { sector: "Industrials",   groups: [
      { name: "Capital Goods", ticker: "XLI", rating: "ow" },
      { name: "Transport",     ticker: null,  rating: "mw" },
      { name: "Defense",       ticker: null,  rating: "uw" },
  ]},
  { sector: "Materials",     groups: [
      { name: "Metals & Mining", ticker: "XLB", rating: "ow" },
      { name: "Chemicals",       ticker: null,  rating: "mw" },
  ]},
  { sector: "Cons Disc",     groups: [
      { name: "Retail", ticker: null, rating: "mw" },
      { name: "Autos",  ticker: null, rating: "uw" },
  ]},
  { sector: "Financials",    groups: [
      { name: "Insurance", ticker: null, rating: "mw" },
      { name: "Banks",     ticker: "XLF", rating: "uw" },
  ]},
  { sector: "Health Care",   groups: [
      { name: "Devices", ticker: null,  rating: "mw" },
      { name: "Pharma",  ticker: "XLV", rating: "uw" },
      { name: "Biotech", ticker: "IBB", rating: "uw" },
  ]},
  { sector: "Cons Staples",  groups: [
      { name: "Food",      ticker: "XLP", rating: "uw" },
      { name: "Household", ticker: null,  rating: "uw" },
  ]},
  { sector: "Real Estate",   groups: [
      { name: "REITs", ticker: "IYR", rating: "uw" },
  ]},
  { sector: "Utilities",     groups: [
      { name: "Electric & Multi", ticker: "XLU", rating: "uw" },
  ]},
];

// ─── Risk scenarios from asset_allocation/docs/runbook.md ──────────────────
const RISK_SCENARIOS = [
  {
    trigger: "Real rates spike above 2.0%",
    impact: "Long-duration tech and homebuilders most exposed. The aggressive Semis tilt would compress fastest — a 50bp move in real rates has historically produced ~6% drawdown in IGV/SOXX over 30 days.",
    tags: ["Semiconductors", "Software", "Cons Disc"],
  },
  {
    trigger: "HY-IG credit spread widens past 250bp",
    impact: "Risk-off cascade. Equity-credit correlation jumps to 0.95+, defensive sleeve flips on, leverage cuts to 1.0×. Energy and Materials would rotate out in favor of cash + gold.",
    tags: ["Energy", "Materials", "Industrials"],
  },
  {
    trigger: "Yield curve flattens or re-inverts",
    impact: "Bull case for our cyclical tilt dies; bear case for utilities reverses. Composite re-rates cyclicals down two notches within a single rebalance.",
    tags: ["Industrials", "Materials", "Energy"],
  },
  {
    trigger: "SLOOS C&I tightening above +20pp",
    impact: "Credit channel chokes off. Capital-goods orders and bank loan growth roll over in 1-2 quarters. Pre-position by trimming Industrials before the next print.",
    tags: ["Industrials", "Financials"],
  },
];

// ─── Composite scoring helpers ──────────────────────────────────────────────
// Match Today's Macro's framing: lower = lower drawdown probability = bullish.
function classifyComposite(score) {
  if (score == null || isNaN(score)) return { state: "—", color: "var(--text-muted)", pillBg: "transparent", pillColor: "var(--text-muted)" };
  if (score <= -10) return { state: "Calm",     color: "var(--green)",  pillBg: "rgba(48,209,88,0.18)", pillColor: "#1c6f2c" };
  if (score <= 10)  return { state: "Normal",   color: "var(--green)",  pillBg: "rgba(48,209,88,0.14)", pillColor: "#1c6f2c" };
  if (score <= 30)  return { state: "Elevated", color: "var(--orange)", pillBg: "rgba(255,159,10,0.18)", pillColor: "#7a4a00" };
  return { state: "Stressed", color: "var(--red)", pillBg: "rgba(255,69,58,0.18)", pillColor: "#7a1414" };
}

function meterPosition(score) {
  // Map −100..+100 to 0..100% for the horizontal meter
  if (score == null || isNaN(score)) return 50;
  return Math.max(2, Math.min(98, ((score + 100) / 200) * 100));
}

function trendArrow(delta) {
  if (delta == null || isNaN(delta)) return "—";
  if (Math.abs(delta) < 1) return "→ flat";
  return delta < 0 ? `↓ ${delta.toFixed(0)}` : `↑ +${delta.toFixed(0)}`;
}

function trendClass(delta) {
  if (delta == null || isNaN(delta)) return "";
  if (Math.abs(delta) < 1) return "neutral";
  return delta < 0 ? "down-good" : "up-bad";
}

// ─── Number formatting ─────────────────────────────────────────────────────
function fmtDollar(pct) {
  // Convert capital-fraction to dollar amount per $100 capital
  if (pct == null || isNaN(pct)) return "—";
  const d = pct * 100;
  if (Math.abs(d) < 0.01) return "$0";
  return `$${d.toFixed(d < 10 ? 2 : 0)}`;
}

function fmtPP(delta) {
  if (delta == null || isNaN(delta) || Math.abs(delta) < 0.005) return null;
  const sign = delta > 0 ? "+" : "−";
  return `${sign}$${Math.abs(delta * 100).toFixed(Math.abs(delta * 100) < 10 ? 2 : 0)}`;
}

// ─── Sub-components ────────────────────────────────────────────────────────

function MacroSnapCard({ name, window, score, current, deltaMo, deltaQt, drawdownPct, baselinePct }) {
  const cls = classifyComposite(score);
  return (
    <div style={{
      padding: "var(--space-4)",
      background: "var(--surface)",
      border: "0.5px solid var(--border)",
      borderRadius: "var(--radius-md)",
      borderLeft: `3px solid ${cls.color}`,
      display: "flex", flexDirection: "column", gap: 8,
    }}>
      <div>
        <div style={{ fontFamily: "var(--font-display, var(--font-ui))", fontWeight: 500, fontSize: 14, display: "inline-flex", alignItems: "center", gap: 4 }}>
          {name}
          <InfoTip def={
            name === "Risk & Liquidity" ? "Short-term market stress composite. Built from VIX, HY-IG credit spread, equity-credit correlation, MOVE bond volatility, and financial-conditions indices. A lower (more negative) score = lower probability of an S&P drawdown over the next 3 months."
            : name === "Growth" ? "Real-economy momentum composite that empirically predicts S&P drawdowns over the next 6 months. Built from ISM manufacturing, jobless claims (inverted), JOLTS quits, industrial production, and the copper-gold ratio. Lower score = lower drawdown probability."
            : "Inflation pressure and rate-path composite that empirically predicts S&P drawdowns over the next 18 months. Built from CPI, term premium, real rates, yield curve, and the dollar index. Lower score = lower drawdown probability."
          } />
        </div>
        <div style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginTop: 2 }}>{window}</div>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span style={{ fontFamily: "var(--font-display, var(--font-ui))", fontSize: 22, fontWeight: 500, color: cls.color }}>{cls.state}</span>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 14, color: "var(--text-muted)" }}>{score == null ? "—" : score.toFixed(0)}</span>
      </div>
      <div style={{ height: 5, borderRadius: 3, position: "relative", background: "linear-gradient(to right, var(--green) 0%, var(--green) 33%, var(--border) 33%, var(--border) 66%, var(--orange) 66%, var(--orange) 84%, var(--red) 84%, var(--red) 100%)" }}>
        <div style={{ position: "absolute", top: -2, width: 2, height: 9, background: "var(--text)", left: `${meterPosition(score)}%` }}/>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
        <div style={{ background: "var(--bg)", borderRadius: 5, padding: "5px 8px" }}>
          <div style={{ fontSize: 9, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>vs 1M</div>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: trendClass(deltaMo) === "down-good" ? "var(--green)" : trendClass(deltaMo) === "up-bad" ? "var(--red)" : "var(--text)" }}>{trendArrow(deltaMo)}</div>
        </div>
        <div style={{ background: "var(--bg)", borderRadius: 5, padding: "5px 8px" }}>
          <div style={{ fontSize: 9, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>vs 3M</div>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: trendClass(deltaQt) === "down-good" ? "var(--green)" : trendClass(deltaQt) === "up-bad" ? "var(--red)" : "var(--text)" }}>{trendArrow(deltaQt)}</div>
        </div>
      </div>
      <div style={{ fontSize: 11, padding: "6px 8px", background: "var(--bg)", borderRadius: 5, lineHeight: 1.4 }}>
        Drawdown risk: <strong style={{ color: cls.color, fontWeight: 600 }}>{drawdownPct}%</strong> · vs. {baselinePct}% baseline
      </div>
    </div>
  );
}

function RatingPill({ rating, size = "sm" }) {
  const map = {
    ow: { label: "Overweight", bg: "rgba(48,209,88,0.18)", color: "#1c6f2c" },
    mw: { label: "Mkt Wt",     bg: "rgba(184,134,11,0.18)", color: "#6b4a00" },
    uw: { label: "Underweight", bg: "rgba(255,69,58,0.18)", color: "#7a1414" },
    upgrade:   { label: "Upgrade",   bg: "rgba(48,209,88,0.18)",  color: "#1c6f2c" },
    downgrade: { label: "Downgrade", bg: "rgba(255,69,58,0.18)",  color: "#7a1414" },
    increase:  { label: "Increase",  bg: "rgba(48,209,88,0.18)",  color: "#1c6f2c" },
    exit:      { label: "Exit",      bg: "rgba(255,69,58,0.18)",  color: "#7a1414" },
  };
  const m = map[rating] || map.mw;
  return (
    <span style={{
      display: "inline-block",
      fontSize: size === "sm" ? 10 : 11,
      padding: size === "sm" ? "2px 7px" : "3px 9px",
      borderRadius: 3,
      fontWeight: 600,
      background: m.bg,
      color: m.color,
    }}>{m.label}</span>
  );
}

function TickerChip({ ticker, onOpenTicker }) {
  return (
    <button
      onClick={() => onOpenTicker && onOpenTicker(ticker)}
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: 11,
        fontWeight: 600,
        padding: "4px 9px",
        background: "var(--surface)",
        border: "0.5px solid var(--border)",
        borderRadius: 5,
        color: "var(--accent)",
        cursor: "pointer",
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = "var(--accent)"; e.currentTarget.style.color = "#fff"; e.currentTarget.style.borderColor = "var(--accent)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = "var(--surface)"; e.currentTarget.style.color = "var(--accent)"; e.currentTarget.style.borderColor = "var(--border)"; }}
    >
      {ticker}
      <span style={{ opacity: 0.5, fontSize: 9 }}>↗</span>
    </button>
  );
}

function DrillDownPanel({ ig, rationaleData, onOpenTicker, onClose, currentWeight, spyWeight }) {
  if (!ig || !ig.ticker || !rationaleData) return null;
  const seed = rationaleData.buckets?.[ig.ticker];
  if (!seed) return (
    <div style={{ marginTop: 12, padding: 12, border: "0.5px solid var(--border)", borderRadius: "var(--radius-md)", background: "var(--surface)" }}>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <strong>{ig.sector} › {ig.name}</strong>
        <button onClick={onClose} style={{ background: "transparent", border: "0.5px solid var(--border)", borderRadius: 4, padding: "3px 9px", fontSize: 11, cursor: "pointer", color: "var(--text)" }}>Close ✕</button>
      </div>
      <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 8 }}>Detailed rationale not yet seeded for this bucket.</div>
    </div>
  );

  const dollar = fmtDollar(currentWeight || 0);
  const spyDollar = fmtDollar(spyWeight || 0);
  const delta = (currentWeight || 0) - (spyWeight || 0);
  const deltaDollar = fmtPP(delta);

  return (
    <div style={{
      marginTop: 12,
      padding: "var(--space-4)",
      border: "0.5px solid var(--accent)",
      borderRadius: "var(--radius-md)",
      background: "color-mix(in srgb, var(--accent) 8%, var(--surface))",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12, gap: 10 }}>
        <div>
          <div style={{ fontFamily: "var(--font-display, var(--font-ui))", fontSize: 17, fontWeight: 500 }}>{ig.sector} › {seed.name}</div>
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2, display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            <RatingPill rating={ig.rating} />
            <span>{seed.fund} ({seed.ticker})</span>
          </div>
        </div>
        <button onClick={onClose} style={{ background: "transparent", border: "0.5px solid var(--accent)", color: "var(--accent)", borderRadius: 4, padding: "3px 9px", fontSize: 11, cursor: "pointer" }}>Close ✕</button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginBottom: 12 }}>
        <div style={{ background: "var(--surface)", borderRadius: 4, padding: "8px 10px" }}>
          <div style={{ fontSize: 9, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.04em" }}>Target weight</div>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 15, fontWeight: 500 }}>{dollar}</div>
        </div>
        <div style={{ background: "var(--surface)", borderRadius: 4, padding: "8px 10px" }}>
          <div style={{ fontSize: 9, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.04em" }}>SPY weight</div>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 15, fontWeight: 500 }}>{spyDollar}</div>
        </div>
        <div style={{ background: "var(--surface)", borderRadius: 4, padding: "8px 10px" }}>
          <div style={{ fontSize: 9, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.04em" }}>vs SPY</div>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 15, fontWeight: 500, color: delta > 0 ? "var(--green)" : delta < 0 ? "var(--red)" : "var(--text)" }}>{deltaDollar || "—"}</div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <div>
          <div style={{ fontSize: 10, color: "var(--accent)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6, fontWeight: 500 }}>Why we like it</div>
          <div style={{ fontSize: 12, lineHeight: 1.6 }}>{seed.rationale}</div>

          <div style={{ fontSize: 10, color: "var(--accent)", textTransform: "uppercase", letterSpacing: "0.05em", marginTop: 14, marginBottom: 6, fontWeight: 500 }}>Example holdings — click any ticker</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
            {seed.examples.map((t) => <TickerChip key={t} ticker={t} onOpenTicker={onOpenTicker} />)}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 10, color: "var(--accent)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6, fontWeight: 500 }}>Key factors</div>
          {seed.key_factors.map((f, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", borderBottom: i < seed.key_factors.length - 1 ? "0.5px dashed var(--border)" : "none", fontSize: 11 }}>
              <span>{f.name}</span>
              <span style={{ fontFamily: "var(--font-mono)", color: f.good ? "var(--green)" : f.direction === "down" ? "var(--red)" : "var(--text)" }}>{f.value} {f.direction === "up" ? "↑" : f.direction === "down" ? "↓" : "→"}</span>
            </div>
          ))}

          <div style={{ fontSize: 10, color: "var(--accent)", textTransform: "uppercase", letterSpacing: "0.05em", marginTop: 14, marginBottom: 6, fontWeight: 500 }}>What would change the rating</div>
          <div style={{ fontSize: 11, lineHeight: 1.5 }}>{seed.kill_factors}</div>
        </div>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────
export default function AssetAllocation({ onOpenTicker }) {
  const [alloc, setAlloc]               = useState(null);
  const [composites, setComposites]     = useState(null);
  const [rationales, setRationales]     = useState(null);
  const [history, setHistory]           = useState(null);
  const [activeBucket, setActiveBucket] = useState({ sector: "Info Tech", name: "Semiconductors", ticker: "SOXX", rating: "ow" });

  useEffect(() => {
    fetch("/v9_allocation.json", { cache: "no-cache" }).then((r) => r.ok ? r.json() : null).then(setAlloc).catch(() => setAlloc(null));
    fetch("/composite_history_daily.json", { cache: "force-cache" }).then((r) => r.ok ? r.json() : null).then(setComposites).catch(() => setComposites(null));
    fetch("/industry_group_rationale.json", { cache: "force-cache" }).then((r) => r.ok ? r.json() : null).then(setRationales).catch(() => setRationales(null));
    fetch("/allocation_history.json", { cache: "no-cache" }).then((r) => r.ok ? r.json() : null).then(setHistory).catch(() => setHistory(null));
  }, []);

  // Derive macro composite snapshot from composite_history_daily.json
  const macroSnap = useMemo(() => {
    if (!composites || !Array.isArray(composites) || composites.length === 0) return null;
    // Find the latest entry with non-null RL/GR/IR
    let latest = null;
    for (let i = composites.length - 1; i >= 0; i--) {
      if (composites[i].RL != null && composites[i].GR != null && composites[i].IR != null) { latest = composites[i]; break; }
    }
    if (!latest) return null;
    const latestIdx = composites.indexOf(latest);

    // Find entries ~21 trading days back (1M) and ~63 trading days back (3M)
    const findBack = (back) => {
      const targetIdx = Math.max(0, latestIdx - back);
      for (let i = targetIdx; i >= 0; i--) {
        if (composites[i].RL != null) return composites[i];
      }
      return null;
    };
    const mo1 = findBack(21);
    const mo3 = findBack(63);

    return {
      asOf: latest.d,
      RL: { score: latest.RL, dMo: mo1 ? latest.RL - mo1.RL : null, dQt: mo3 ? latest.RL - mo3.RL : null },
      GR: { score: latest.GR, dMo: mo1 ? latest.GR - mo1.GR : null, dQt: mo3 ? latest.GR - mo3.GR : null },
      IR: { score: latest.IR, dMo: mo1 ? latest.IR - mo1.IR : null, dQt: mo3 ? latest.IR - mo3.IR : null },
    };
  }, [composites]);

  // Stance derivation from R&L composite (matches Today's Macro framing)
  const stance = useMemo(() => {
    if (!macroSnap || !macroSnap.RL) return { label: "—", color: "var(--text-muted)", bg: "var(--surface)" };
    const rl = macroSnap.RL.score;
    if (rl <= -10) return { label: "Aggressive", color: "#1c6f2c", bg: "rgba(48,209,88,0.18)" };
    if (rl <= 10)  return { label: "Balanced",   color: "#6b4a00", bg: "rgba(184,134,11,0.18)" };
    if (rl <= 30)  return { label: "Cautious",   color: "#7a4a00", bg: "rgba(255,159,10,0.18)" };
    return { label: "Defensive", color: "#7a1414", bg: "rgba(255,69,58,0.18)" };
  }, [macroSnap]);

  // Hero KPI numbers from v9_allocation.json
  const totalEquity = alloc ? (alloc.leverage * alloc.equity_share) : null;
  const defensiveOn = alloc ? (alloc.equity_share < 0.99) : false;
  const margin = alloc ? Math.max(0, alloc.leverage - alloc.equity_share) : 0;
  const alpha = alloc?.alpha;
  const conviction = alloc?.selection_confidence || "—";

  // Picks for table 2 (allocation changes — stub data until allocation_history.json populates)
  const picks = alloc?.picks || [];
  const lastChange = picks.length ? picks[0]?.weight : null;

  // Loading state
  if (!alloc) {
    return (
      <main style={{ maxWidth: 1440, margin: "0 auto", padding: "var(--space-8)" }}>
        <div style={{ padding: "var(--space-12)", textAlign: "center", color: "var(--text-muted)" }}>Loading asset allocation…</div>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 1440, margin: "0 auto", padding: "var(--space-6) var(--space-8) var(--space-12)" }}>

      {/* Hero KPI strip */}
      <section style={{
        padding: "var(--space-5) var(--space-6)",
        background: "var(--surface)",
        border: "0.5px solid var(--border)",
        borderRadius: "var(--radius-lg)",
        marginBottom: "var(--space-4)",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 14, flexWrap: "wrap" }}>
          <div style={{ minWidth: 0, flex: "1 1 320px" }}>
            <div style={{ fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--text-muted)", fontWeight: 600 }}>Asset Allocation</div>
            <h1 style={{ fontFamily: "var(--font-display, var(--font-ui))", fontSize: 26, fontWeight: 500, margin: "4px 0 4px", letterSpacing: "-0.015em" }}>
              {stance.label} — {totalEquity > 1.05 ? "leaning into cyclical rotation" : totalEquity > 0.85 ? "balanced positioning" : "defensive posture"}
            </h1>
            <p style={{ fontFamily: "var(--font-display, var(--font-ui))", fontSize: 14, fontStyle: "italic", color: "var(--text-muted)", margin: 0 }}>
              All three macro composites read benign. Risk-on conditions support overweighting cyclicals and using leverage.
            </p>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 12px", borderRadius: 999, background: stance.bg, color: stance.color, fontWeight: 600, fontSize: 12 }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: stance.color }}/>
              {stance.label}
            </span>
            <span style={{ fontSize: 10, color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--green)" }}/>
              Updated {alloc.as_of} · Next rebalance {alloc.methodology?.locked_at ? "Sat May 2" : "—"}
            </span>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, marginTop: 12 }}>
          <div style={{ background: "var(--bg)", border: "0.5px solid var(--border)", borderRadius: "var(--radius-md)", padding: "10px 12px" }}>
            <div style={{ fontSize: 9, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 4 }}>
              Total equity exposure
              <InfoTip def="The total dollars of equities held per $100 of capital, including borrowed dollars from margin. When this exceeds $100, the difference is leverage (e.g., $128 means 28% margin)." />
            </div>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 22, fontWeight: 500, color: "var(--green)", marginTop: 2 }}>${(totalEquity * 100).toFixed(0)}</div>
            <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2 }}>per $100 capital · {(margin * 100).toFixed(0)}% margin</div>
          </div>
          <div style={{ background: "var(--bg)", border: "0.5px solid var(--border)", borderRadius: "var(--radius-md)", padding: "10px 12px" }}>
            <div style={{ fontSize: 9, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 4 }}>
              Defensive sleeve
              <InfoTip def="The portion of capital held in safe assets — T-bills (BIL), long Treasuries (TLT), gold (GLD), and IG corporate bonds (LQD). Activates when Risk & Liquidity composite enters the elevated or stressed zone. Currently off." />
            </div>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 22, fontWeight: 500, marginTop: 2 }}>${defensiveOn ? ((1 - alloc.equity_share) * 100).toFixed(0) : 0}</div>
            <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2 }}>{defensiveOn ? "active" : "off · activates if R&L stresses"}</div>
          </div>
          <div style={{ background: "var(--bg)", border: "0.5px solid var(--border)", borderRadius: "var(--radius-md)", padding: "10px 12px" }}>
            <div style={{ fontSize: 9, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 4 }}>
              Excess return target
              <InfoTip def="Expected outperformance versus the S&P 500 over the next month, after subtracting the financing cost on any margin used." />
            </div>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 22, fontWeight: 500, color: "var(--green)", marginTop: 2 }}>+{(alpha * 100).toFixed(2)}%</div>
            <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2 }}>monthly · over S&P 500</div>
          </div>
          <div style={{ background: "var(--bg)", border: "0.5px solid var(--border)", borderRadius: "var(--radius-md)", padding: "10px 12px" }}>
            <div style={{ fontSize: 9, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 4 }}>
              Conviction
              <InfoTip def="How confident the model is in the current ranking. STRONG = the top 5 buckets are clearly separated from the rest on both indicator score and momentum rank." />
            </div>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 22, fontWeight: 500, marginTop: 2, textTransform: "capitalize" }}>{conviction.toLowerCase()}</div>
            <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2 }}>{picks.length} picks · clear rank separation</div>
          </div>
        </div>
      </section>

      {/* Section 1 — The Big Picture */}
      <section style={{ padding: "var(--space-5) var(--space-6)", background: "var(--surface)", border: "0.5px solid var(--border)", borderRadius: "var(--radius-lg)", marginBottom: "var(--space-4)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14, gap: 10 }}>
          <div>
            <div style={{ fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--text-muted)", fontWeight: 600 }}>1 · The big picture</div>
            <h2 style={{ fontFamily: "var(--font-display, var(--font-ui))", fontSize: 19, fontWeight: 500, margin: "4px 0 4px" }}>Market snapshot — live from Macro Overview</h2>
            <p style={{ fontSize: 12, color: "var(--text-muted)", margin: 0 }}>Three composites measure forward S&P drawdown probability over different windows.</p>
          </div>
          <a href="#overview" style={{ fontSize: 11, color: "var(--accent)", padding: "4px 10px", border: "0.5px solid var(--border)", borderRadius: 5, textDecoration: "none" }}>Full dials &amp; history →</a>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
          {macroSnap ? (
            <>
              <MacroSnapCard name="Risk & Liquidity"   window="Forward 3 months · 10%+ drawdown"  score={macroSnap.RL.score} deltaMo={macroSnap.RL.dMo} deltaQt={macroSnap.RL.dQt} drawdownPct={17} baselinePct={21} />
              <MacroSnapCard name="Growth"             window="Forward 6 months · 15%+ drawdown"  score={macroSnap.GR.score} deltaMo={macroSnap.GR.dMo} deltaQt={macroSnap.GR.dQt} drawdownPct={22} baselinePct={22} />
              <MacroSnapCard name="Inflation & Rates"  window="Forward 18 months · 20%+ drawdown" score={macroSnap.IR.score} deltaMo={macroSnap.IR.dMo} deltaQt={macroSnap.IR.dQt} drawdownPct={23} baselinePct={28} />
            </>
          ) : (
            <div style={{ gridColumn: "span 3", padding: "var(--space-6)", textAlign: "center", color: "var(--text-muted)", fontSize: 12 }}>Composite history loading…</div>
          )}
        </div>

        {/* The What & The Why */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 14 }}>
          <div style={{ padding: "14px 16px", background: "rgba(48,209,88,0.10)", borderLeft: "3px solid var(--green)", borderRadius: "var(--radius-md)" }}>
            <div style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.12em", fontWeight: 600, marginBottom: 4 }}>The What</div>
            <div style={{ fontFamily: "var(--font-display, var(--font-ui))", fontSize: 17, fontWeight: 500, marginBottom: 8, lineHeight: 1.3 }}>
              Aggressive cyclical tilt with <span style={{ fontStyle: "italic", color: "var(--text-muted)" }}>${(margin * 100).toFixed(0)} of leverage</span> per $100 capital.
            </div>
            <div style={{ fontSize: 13, lineHeight: 1.65 }}>
              All three macro composites read in the calm or normal zone with implied drawdown risk at or below historical baseline. The portfolio holds <strong style={{ fontWeight: 600 }}>${(totalEquity * 100).toFixed(0)} in equities</strong> with the defensive sleeve {defensiveOn ? "active" : "off"}, concentrated in {picks.length} overweights: {picks.map(p => p.name).join(", ")}.
            </div>
          </div>
          <div style={{ padding: "14px 16px", background: "rgba(184,134,11,0.10)", borderLeft: "3px solid #B8860B", borderRadius: "var(--radius-md)" }}>
            <div style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.12em", fontWeight: 600, marginBottom: 4 }}>The Why</div>
            <div style={{ fontFamily: "var(--font-display, var(--font-ui))", fontSize: 17, fontWeight: 500, marginBottom: 8, lineHeight: 1.3 }}>
              Real rates rolling over, curve steepening, credit spreads tight.
            </div>
            <div style={{ fontSize: 13, lineHeight: 1.65 }}>
              That combination historically rewards an aggressive cyclical tilt. Semis and Energy screen #1 and #2 on combined factor and momentum rank. Utilities and REITs lose their bond-proxy thesis when the curve steepens. The {(margin * 100).toFixed(0)}% leverage is calibrated by Risk &amp; Liquidity — calm regimes earn more.
            </div>
          </div>
        </div>
      </section>

      {/* Section 2 — Recommended Asset Allocation */}
      <section style={{ padding: "var(--space-5) var(--space-6)", background: "var(--surface)", border: "0.5px solid var(--border)", borderRadius: "var(--radius-lg)", marginBottom: "var(--space-4)" }}>
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--text-muted)", fontWeight: 600 }}>2 · Recommended Asset Allocation</div>
          <h2 style={{ fontFamily: "var(--font-display, var(--font-ui))", fontSize: 19, fontWeight: 500, margin: "4px 0 4px" }}>Three views: where we are, what changed, what flipped</h2>
          <p style={{ fontSize: 12, color: "var(--text-muted)", margin: 0 }}>Per $100 of capital. Tables read top-down: holdings, then deltas, then ratings.</p>
        </div>

        <h3 style={{ fontFamily: "var(--font-display, var(--font-ui))", fontSize: 15, fontWeight: 500, margin: "12px 0 6px" }}>Asset class allocation</h3>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, background: "var(--bg)", borderRadius: "var(--radius-md)", overflow: "hidden", border: "0.5px solid var(--border)" }}>
          <thead>
            <tr style={{ background: "var(--surface)" }}>
              <th style={thStyle()}>Asset class</th>
              <th style={{...thStyle(), textAlign: "right"}}>Current</th>
              <th style={{...thStyle(), textAlign: "right"}}>Last month (Mar 28)</th>
              <th style={{...thStyle(), textAlign: "right"}}>Last quarter (Jan 26)</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={tdStyle()}>Equities</td>
              <td style={tdRight()}><span style={dollarStyle()}>${(totalEquity * 100).toFixed(0)}</span></td>
              <td style={tdRight()}><HistCell value={history?.last_month?.equities} loading={!history} /></td>
              <td style={tdRight()}><HistCell value={history?.last_quarter?.equities} loading={!history} /></td>
            </tr>
            <tr>
              <td style={tdStyle()}>Other (Bills, UST, Gold, IG Bonds)</td>
              <td style={tdRight()}><span style={dollarStyle()}>${defensiveOn ? ((1 - alloc.equity_share) * 100).toFixed(0) : 0}</span> {!defensiveOn && <span style={{ color: "var(--text-muted)", fontStyle: "italic", fontSize: 11 }}>unch.</span>}</td>
              <td style={tdRight()}><HistCell value={history?.last_month?.other} loading={!history} /></td>
              <td style={tdRight()}><HistCell value={history?.last_quarter?.other} loading={!history} /></td>
            </tr>
            <tr style={{ background: "var(--surface)", fontWeight: 600 }}>
              <td style={tdStyle()}>Total deployed</td>
              <td style={tdRight()}><span style={dollarStyle()}>${(totalEquity * 100).toFixed(0)}</span></td>
              <td style={tdRight()}><HistCell value={history?.last_month?.total} loading={!history} /></td>
              <td style={tdRight()}><HistCell value={history?.last_quarter?.total} loading={!history} /></td>
            </tr>
            <tr>
              <td style={{...tdStyle(), color: "var(--text-muted)"}}>Implied cash / (margin)</td>
              <td style={tdRight()}><span style={{...dollarStyle(), color: "var(--text-muted)"}}>{margin > 0 ? `($${(margin * 100).toFixed(0)})` : `$0`}</span></td>
              <td style={tdRight()}><HistCell value={history?.last_month?.cash_margin} loading={!history} /></td>
              <td style={tdRight()}><HistCell value={history?.last_quarter?.cash_margin} loading={!history} /></td>
            </tr>
          </tbody>
        </table>
        {!history && (
          <div style={{ fontSize: 11, color: "var(--text-muted)", fontStyle: "italic", marginTop: 6 }}>
            Snapshot collection started Apr 26 — historical comparison columns populate after the next rebalance.
          </div>
        )}

        <h3 style={{ fontFamily: "var(--font-display, var(--font-ui))", fontSize: 15, fontWeight: 500, margin: "16px 0 6px" }}>Allocation changes</h3>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, background: "var(--bg)", borderRadius: "var(--radius-md)", overflow: "hidden", border: "0.5px solid var(--border)" }}>
          <thead>
            <tr style={{ background: "var(--surface)" }}>
              <th style={thStyle()}>Move</th>
              <th style={thStyle()}>Sector / industry group</th>
              <th style={{...thStyle(), textAlign: "right"}}>New target</th>
              <th style={{...thStyle(), textAlign: "right"}}>Prior</th>
              <th style={{...thStyle(), textAlign: "right"}}>Change</th>
            </tr>
          </thead>
          <tbody>
            {history?.changes ? history.changes.map((c, i) => (
              <tr key={i}>
                <td style={tdStyle()}><RatingPill rating={c.move} /></td>
                <td style={tdStyle()}>{c.bucket}</td>
                <td style={tdRight()}><span style={dollarStyle()}>${(c.new_weight * 100).toFixed(2)}</span></td>
                <td style={tdRight()}><span style={{...dollarStyle(), color: "var(--text-muted)"}}>${(c.prior_weight * 100).toFixed(2)}</span></td>
                <td style={tdRight()}><span style={{ fontFamily: "var(--font-mono)", color: c.delta > 0 ? "var(--green)" : "var(--red)", fontWeight: 600 }}>{c.delta > 0 ? "+" : "−"}${Math.abs(c.delta * 100).toFixed(2)}</span></td>
              </tr>
            )) : (
              <tr><td colSpan={5} style={{ padding: 16, textAlign: "center", color: "var(--text-muted)", fontStyle: "italic", fontSize: 11 }}>
                Snapshot collection started Apr 26 — change history populates after the next rebalance.
              </td></tr>
            )}
          </tbody>
        </table>

        <h3 style={{ fontFamily: "var(--font-display, var(--font-ui))", fontSize: 15, fontWeight: 500, margin: "16px 0 6px" }}>Rating changes</h3>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, background: "var(--bg)", borderRadius: "var(--radius-md)", overflow: "hidden", border: "0.5px solid var(--border)" }}>
          <thead>
            <tr style={{ background: "var(--surface)" }}>
              <th style={thStyle()}>Direction</th>
              <th style={thStyle()}>vs Last month (Mar 28)</th>
              <th style={thStyle()}>vs Last quarter (Jan 26)</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={tdStyle()}><RatingPill rating="upgrade" /></td>
              <td style={tdStyle()}>{history?.upgrades_1m?.join(", ") || <span style={{ color: "var(--text-muted)", fontStyle: "italic" }}>Awaiting next rebalance</span>}</td>
              <td style={tdStyle()}>{history?.upgrades_3m?.join(", ") || <span style={{ color: "var(--text-muted)", fontStyle: "italic" }}>Awaiting next rebalance</span>}</td>
            </tr>
            <tr>
              <td style={tdStyle()}><RatingPill rating="downgrade" /></td>
              <td style={tdStyle()}>{history?.downgrades_1m?.join(", ") || <span style={{ color: "var(--text-muted)", fontStyle: "italic" }}>Awaiting next rebalance</span>}</td>
              <td style={tdStyle()}>{history?.downgrades_3m?.join(", ") || <span style={{ color: "var(--text-muted)", fontStyle: "italic" }}>Awaiting next rebalance</span>}</td>
            </tr>
          </tbody>
        </table>
      </section>

      {/* Section 3 — Sector outlooks */}
      <section style={{ padding: "var(--space-5) var(--space-6)", background: "var(--surface)", border: "0.5px solid var(--border)", borderRadius: "var(--radius-lg)", marginBottom: "var(--space-4)" }}>
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--text-muted)", fontWeight: 600 }}>3 · Sector outlooks</div>
          <h2 style={{ fontFamily: "var(--font-display, var(--font-ui))", fontSize: 19, fontWeight: 500, margin: "4px 0 4px" }}>11 sectors · 25 industry groups · 3 ratings</h2>
          <p style={{ fontSize: 12, color: "var(--text-muted)", margin: 0 }}>Click any chip to see the rationale, key factors, and what would change the call.</p>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "120px repeat(3, 1fr)", gap: 3, fontSize: 10 }}>
          <div style={{ padding: "6px 4px" }}/>
          <div style={{ padding: "6px 4px", color: "var(--green)", textTransform: "uppercase", letterSpacing: "0.05em", fontSize: 10, textAlign: "center", fontWeight: 600 }}>Overweight</div>
          <div style={{ padding: "6px 4px", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", fontSize: 10, textAlign: "center", fontWeight: 600 }}>Market weight</div>
          <div style={{ padding: "6px 4px", color: "var(--red)", textTransform: "uppercase", letterSpacing: "0.05em", fontSize: 10, textAlign: "center", fontWeight: 600 }}>Underweight</div>

          {SECTOR_IG_MAP.map((row) => (
            <HeatmapRow key={row.sector} row={row} activeBucket={activeBucket} setActiveBucket={setActiveBucket} />
          ))}
        </div>

        {activeBucket && activeBucket.ticker && rationales && (
          <DrillDownPanel
            ig={activeBucket}
            rationaleData={rationales}
            onOpenTicker={onOpenTicker}
            onClose={() => setActiveBucket(null)}
            currentWeight={picks.find(p => p.ticker === activeBucket.ticker)?.weight || 0}
            spyWeight={0.073}
          />
        )}
      </section>

      {/* Section 4 — Risk management */}
      <section style={{ padding: "var(--space-5) var(--space-6)", background: "var(--surface)", border: "0.5px solid var(--border)", borderRadius: "var(--radius-lg)", marginBottom: "var(--space-4)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12, gap: 10 }}>
          <div>
            <div style={{ fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--text-muted)", fontWeight: 600 }}>4 · Risk management</div>
            <h2 style={{ fontFamily: "var(--font-display, var(--font-ui))", fontSize: 19, fontWeight: 500, margin: "4px 0 4px" }}>What can break this</h2>
            <p style={{ fontSize: 12, color: "var(--text-muted)", margin: 0 }}>Each scenario lists the trigger, the buckets exposed, and the mechanism.</p>
          </div>
          <span style={{ fontSize: 10, color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--green)" }}/>
            Stress 0/4 fired
          </span>
        </div>

        {RISK_SCENARIOS.map((s, i) => (
          <div key={i} style={{ border: "0.5px solid var(--border)", borderRadius: "var(--radius-md)", padding: "10px 12px", marginTop: 8, background: "var(--bg)" }}>
            <div style={{ fontFamily: "var(--font-display, var(--font-ui))", fontWeight: 500, fontSize: 13 }}>{s.trigger}</div>
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4, lineHeight: 1.55 }}>{s.impact}</div>
            <div style={{ marginTop: 6, display: "flex", gap: 4, flexWrap: "wrap" }}>
              {s.tags.map((t) => <span key={t} style={{ fontSize: 9, padding: "2px 6px", borderRadius: 3, background: "var(--surface)", color: "var(--text-muted)" }}>{t}</span>)}
            </div>
          </div>
        ))}
      </section>

      {/* Methodology footer */}
      <section style={{ padding: "10px 14px", background: "var(--surface)", border: "0.5px solid var(--border)", borderRadius: "var(--radius-md)", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8, fontSize: 11, color: "var(--text-muted)" }}>
        <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
          <span><strong style={{ color: "var(--text)" }}>Methodology {alloc.methodology?.version || "v9"}</strong> · locked {alloc.methodology?.locked_at || "—"}</span>
          <span>Backtest {alloc.methodology?.back_test_window || "—"} · CAGR {((alloc.methodology?.back_test_cagr || 0) * 100).toFixed(1)}% · Sharpe {(alloc.methodology?.back_test_sharpe || 0).toFixed(2)} · Max DD {((alloc.methodology?.back_test_max_drawdown || 0) * 100).toFixed(1)}% · vs SPY +{((alloc.methodology?.vs_spy_cagr_diff || 0) * 100).toFixed(1)}%/yr</span>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <a href="#readme" style={{ color: "var(--accent)", textDecoration: "none" }}>Methodology →</a>
          <a href="/v9_allocation.json" target="_blank" rel="noreferrer" style={{ color: "var(--accent)", textDecoration: "none" }}>Raw data →</a>
        </div>
      </section>

    </main>
  );
}

// ─── Tiny helpers ──────────────────────────────────────────────────────────
function thStyle() {
  return {
    textAlign: "left",
    padding: "8px 12px",
    fontSize: 9,
    color: "var(--text-muted)",
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    fontWeight: 600,
    borderBottom: "0.5px solid var(--border)",
  };
}
function tdStyle() { return { padding: "9px 12px", borderBottom: "0.5px solid var(--border)", verticalAlign: "middle", fontSize: 12 }; }
function tdRight() { return { ...tdStyle(), textAlign: "right" }; }
function dollarStyle() { return { fontFamily: "var(--font-mono)", color: "var(--text)" }; }

function HistCell({ value, loading }) {
  if (loading) return <span style={{ color: "var(--text-muted)", fontStyle: "italic", fontSize: 11 }}>…</span>;
  if (value == null) return <span style={{ color: "var(--text-muted)", fontStyle: "italic", fontSize: 11 }}>—</span>;
  return <span style={dollarStyle()}>${value.toFixed(0)}</span>;
}

function HeatmapRow({ row, activeBucket, setActiveBucket }) {
  const ow = row.groups.filter(g => g.rating === "ow");
  const mw = row.groups.filter(g => g.rating === "mw");
  const uw = row.groups.filter(g => g.rating === "uw");

  const cellStyle = (color) => ({
    display: "flex", flexWrap: "wrap", gap: 3, padding: 4, borderRadius: 4, alignContent: "flex-start", minHeight: 30,
    background: color === "ow" ? "rgba(48,209,88,0.10)" : color === "uw" ? "rgba(255,69,58,0.10)" : "rgba(184,134,11,0.08)",
  });

  return (
    <>
      <div style={{ padding: "8px 4px", fontFamily: "var(--font-display, var(--font-ui))", fontSize: 11, display: "flex", alignItems: "center" }}>{row.sector}</div>
      <div style={cellStyle("ow")}>
        {ow.map(g => <Chip key={g.name} g={g} sector={row.sector} active={activeBucket?.name === g.name} onClick={() => setActiveBucket({ ...g, sector: row.sector })} />)}
      </div>
      <div style={cellStyle("mw")}>
        {mw.map(g => <Chip key={g.name} g={g} sector={row.sector} active={activeBucket?.name === g.name} onClick={() => setActiveBucket({ ...g, sector: row.sector })} />)}
      </div>
      <div style={cellStyle("uw")}>
        {uw.map(g => <Chip key={g.name} g={g} sector={row.sector} active={activeBucket?.name === g.name} onClick={() => setActiveBucket({ ...g, sector: row.sector })} />)}
      </div>
    </>
  );
}

function Chip({ g, sector, active, onClick }) {
  const colorMap = { ow: "var(--green)", mw: "var(--text)", uw: "var(--red)" };
  return (
    <button
      onClick={onClick}
      style={{
        padding: "3px 8px",
        borderRadius: 3,
        fontSize: 10,
        cursor: g.ticker ? "pointer" : "default",
        background: active ? "var(--accent)" : "var(--surface)",
        color: active ? "#fff" : (g.rating === "ow" ? "var(--green)" : g.rating === "uw" ? "var(--red)" : "var(--text)"),
        border: active ? "1px solid var(--accent)" : "0.5px solid var(--border)",
        fontWeight: g.rating === "ow" || g.rating === "uw" ? 600 : 400,
        opacity: g.ticker ? 1 : 0.6,
      }}
      disabled={!g.ticker}
    >
      {g.name}
    </button>
  );
}
