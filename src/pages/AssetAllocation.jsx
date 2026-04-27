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
import { useSortableTable, SortArrow } from "../hooks/useSortableTable";

// 25 GICS Industry Groups grouped by their 11 GICS Sector parents.
// Ratings derive from v9's 14-bucket compute output by mapping each GICS IG
// to the closest v9 ETF (or null if v9 doesn't yet score it).
const SECTOR_IG_MAP = [
  { sector: "Information Technology", groups: [
    { name: "Software & Services",                  ticker: "IGV",  rating: "mw" },
    { name: "Technology Hardware & Equipment",      ticker: "AAPL", basket: true,   rating: "mw" },
    { name: "Semiconductors & Semi Equipment",      ticker: "SOXX", rating: "ow" },
  ]},
  { sector: "Communication Services", groups: [
    { name: "Telecommunication Services",           ticker: "IYZ",  rating: "ow" },
    { name: "Media & Entertainment",                ticker: "XLC",   rating: "mw" },
  ]},
  { sector: "Consumer Discretionary", groups: [
    { name: "Automobiles & Components",             ticker: "CARZ",   rating: "uw" },
    { name: "Consumer Durables & Apparel",          ticker: "NKE", basket: true,   rating: "mw" },
    { name: "Consumer Services",                    ticker: "PEJ",   rating: "mw" },
    { name: "Consumer Discretionary Distribution & Retail", ticker: "XRT", rating: "mw" },
  ]},
  { sector: "Consumer Staples",       groups: [
    { name: "Consumer Staples Distribution & Retail",  ticker: "WMT", basket: true,  rating: "uw" },
    { name: "Food, Beverage & Tobacco",                ticker: "XLP", rating: "uw" },
    { name: "Household & Personal Products",           ticker: "PG", basket: true,  rating: "uw" },
  ]},
  { sector: "Energy",                 groups: [
    { name: "Energy",                               ticker: "XLE",  rating: "ow" },
  ]},
  { sector: "Financials",             groups: [
    { name: "Banks",                                ticker: "XLF",  rating: "uw" },
    { name: "Financial Services",                   ticker: "IYG",   rating: "mw" },
    { name: "Insurance",                            ticker: "KIE",   rating: "mw" },
  ]},
  { sector: "Health Care",            groups: [
    { name: "Health Care Equipment & Services",     ticker: "IHI",   rating: "mw" },
    { name: "Pharmaceuticals, Biotech & Life Sciences", ticker: "XLV", rating: "uw" },
  ]},
  { sector: "Industrials",            groups: [
    { name: "Capital Goods",                        ticker: "XLI",  rating: "ow" },
    { name: "Commercial & Professional Services",   ticker: "WM", basket: true,   rating: "mw" },
    { name: "Transportation",                       ticker: "IYT",   rating: "mw" },
  ]},
  { sector: "Materials",              groups: [
    { name: "Materials",                            ticker: "XLB",  rating: "ow" },
  ]},
  { sector: "Real Estate",            groups: [
    { name: "Equity REITs",                         ticker: "IYR",  rating: "uw" },
    { name: "Real Estate Management & Development", ticker: "CBRE", basket: true,   rating: "mw" },
  ]},
  { sector: "Utilities",              groups: [
    { name: "Utilities",                            ticker: "XLU",  rating: "uw" },
  ]},
];

// ─── Risk scenarios — Senior Quant catalog of conditions that change the view ──
// Each scenario links to its underlying indicator in the All Indicators tab.
const RISK_SCENARIOS = [
  {
    trigger: "Real rates spike above 2.0%",
    indicator_id: "real_rates",
    impact: "Long-duration tech and homebuilders most exposed. The aggressive Semis tilt would compress fastest — a 50bp move in real rates has historically produced ~6% drawdown in IGV/SOXX over 30 days.",
    tags: ["Semiconductors", "Software", "Consumer Discretionary"],
  },
  {
    trigger: "HY-IG credit spread widens past 250bp",
    indicator_id: "hy_ig",
    impact: "Risk-off cascade. Equity-credit correlation jumps to 0.95+, defensive sleeve flips on, leverage cuts to 1.0×. Energy and Materials rotate out in favor of cash + gold.",
    tags: ["Energy", "Materials", "Industrials"],
  },
  {
    trigger: "Yield curve flattens (10Y-2Y back below +25bp)",
    indicator_id: "yield_curve",
    impact: "Bull case for our cyclical tilt dies; bear case for utilities reverses. Composite re-rates cyclicals down two notches within a single rebalance.",
    tags: ["Industrials", "Materials", "Energy", "Utilities"],
  },
  {
    trigger: "SLOOS C&I tightening above +20pp",
    indicator_id: "sloos_ci",
    impact: "Credit channel chokes off. Capital-goods orders and bank loan growth roll over in 1-2 quarters. Pre-position by trimming Industrials before the next print.",
    tags: ["Industrials", "Financials"],
  },
  {
    trigger: "VIX spikes above 25 sustained",
    indicator_id: "vix",
    impact: "Risk & Liquidity composite enters elevated zone. Leverage cuts toward 1.0×, defensive sleeve activates with capital flowing to gold (70%) and T-bills (27%).",
    tags: ["All overweights", "Defensive sleeve activates"],
  },
  {
    trigger: "Term premium climbs above 1.5%",
    indicator_id: "term_premium",
    impact: "Long-duration multiples compress across tech, utilities, and REITs. Pre-positioning trim of Semiconductors and Software before the print can cushion 30-day drawdown.",
    tags: ["Semiconductors", "Software", "Real Estate", "Utilities"],
  },
  {
    trigger: "Copper-gold ratio breaks down decisively",
    indicator_id: "copper_gold",
    impact: "Reflation thesis weakens. Energy and Materials lose their pro-cyclical tailwind. Watch for confirmation in industrial production print.",
    tags: ["Energy", "Materials"],
  },
  {
    trigger: "ISM manufacturing PMI falls below 48",
    indicator_id: "ism",
    impact: "Capital-goods orders roll over within 1-2 quarters. Industrials downgrade triggers; defensive rotation likely follows if Growth composite enters elevated zone.",
    tags: ["Industrials", "Materials"],
  },
  {
    trigger: "USD index breaks above 110 sustained",
    indicator_id: "usd",
    impact: "FX-translated earnings hit Cons Staples, Materials, and mega-cap Tech. Energy benefits short-term but commodity demand from EM weakens. Watch for credit-spread widening as second-order effect.",
    tags: ["Information Technology", "Materials", "Consumer Staples"],
  },
];



// 11 GICS sectors with current rating + plain-English rationale.
// Ratings: ow = at least one industry group inside is overweight; uw = no IG
// inside is rated above market weight AND at least one is underweight; mw = otherwise.
// Senior Quant note: this is the v9 derivation. v10 will emit per-sector ratings directly.
const SECTOR_RATINGS = [
  { sector: "Information Technology", rating: "ow", rationale: "Semiconductors lead the entire ranking on falling real rates + industrial production recovery. Software market weight pending earnings revisions firming." },
  { sector: "Communication Services", rating: "ow", rationale: "The Telecommunication Services slice (IYZ — Verizon, AT&T, T-Mobile) earns overweight on the strongest earnings revisions in the cohort and stable cash-flow profile during a cooling-rates regime. Media & Entertainment is rated separately." },
  { sector: "Energy",                 rating: "ow", rationale: "Oil & Gas overweight on yield-curve steepening, OPEC+ supply discipline, and a rising copper/gold ratio that signals reflation." },
  { sector: "Industrials",            rating: "ow", rationale: "Capital Goods overweight on ISM new orders firming above 50 and easing financial conditions. Defense underweight on cycle-end positioning." },
  { sector: "Materials",              rating: "ow", rationale: "Metals & Mining overweight on rising copper/gold ratio plus industrial production recovery. Chemicals market weight." },
  { sector: "Consumer Discretionary", rating: "mw", rationale: "Torn between strong labor markets (favorable) and rate-sensitivity in housing/autos. Retail neutral; Autos underweight on rate sensitivity." },
  { sector: "Financials",             rating: "uw", rationale: "Banks underweight: yield curve helps NIM but bank unrealized losses still elevated and SLOOS C&I tightening at +12 pp suppresses loan growth." },
  { sector: "Health Care",            rating: "uw", rationale: "Pharma & Biotech underweight on negative earnings revisions plus drug-pricing policy overhang. Defensive yield premium not earned in the calm regime." },
  { sector: "Consumer Staples",       rating: "uw", rationale: "Defensive yield premium isn't earned when Risk & Liquidity reads benign. FX-sensitive multinationals also face a strong-USD headwind." },
  { sector: "Real Estate",            rating: "uw", rationale: "REITs underweight: real rates still elevated and CRE office stress live. Pure bond-proxy behavior loses when the curve steepens." },
  { sector: "Utilities",              rating: "uw", rationale: "Bond-proxy underweight: long-end yields rising faster than short-end compresses utility multiples. AI/data-center capex is a floor, not a reversal." },
];

// SPY sector weights (cap-weighted, approximate). Q1 2026 snapshot.
const SPY_WEIGHTS = {
  SOXX: 0.073, IGV: 0.115, IBB: 0.018, XLF: 0.133, XLV: 0.121,
  XLI:  0.094, XLE: 0.037, XLY: 0.103, XLP: 0.062, XLU: 0.024,
  XLB:  0.026, IYR: 0.026, IYZ: 0.094, MGK: 0.000,
};

// S&P 500 GICS sector weights — reference-only, used for the sector-tilt rollup.
// Source: SPDR SPY published holdings (Q1 2026). Refresh quarterly.
// IMPORTANT: SECTOR_IG_SPY_WEIGHTS below MUST sum to the parent value here for
// each sector. Update both together.
const SECTOR_GICS_BENCHMARK = {
  "Information Technology": 0.305,
  "Financials":             0.135,
  "Health Care":            0.110,
  "Consumer Discretionary": 0.105,
  "Communication Services": 0.095,
  "Industrials":            0.085,
  "Consumer Staples":       0.060,
  "Energy":                 0.037,
  "Utilities":              0.025,
  "Real Estate":            0.024,
  "Materials":              0.020,
};

// S&P 500 GICS industry-group sub-weights — keyed by IG name (matching
// SECTOR_IG_MAP[].groups[].name exactly). Each row's parent sum reconciles
// to SECTOR_GICS_BENCHMARK above. Source: rough but reconciling estimate
// drawn from SPY constituents at GICS sub-industry resolution, Q1 2026.
const SECTOR_IG_SPY_WEIGHTS = {
  // Information Technology — sums to 0.305
  "Software & Services":                       0.105,
  "Technology Hardware & Equipment":           0.125,
  "Semiconductors & Semi Equipment":           0.075,
  // Communication Services — sums to 0.095
  "Telecommunication Services":                0.015,
  "Media & Entertainment":                     0.080,
  // Consumer Discretionary — sums to 0.105
  "Automobiles & Components":                  0.015,
  "Consumer Durables & Apparel":               0.015,
  "Consumer Services":                         0.010,
  "Consumer Discretionary Distribution & Retail": 0.065,
  // Consumer Staples — sums to 0.060
  "Consumer Staples Distribution & Retail":    0.025,
  "Food, Beverage & Tobacco":                  0.025,
  "Household & Personal Products":             0.010,
  // Energy — sums to 0.037
  "Energy":                                    0.037,
  // Financials — sums to 0.135
  "Banks":                                     0.055,
  "Financial Services":                        0.055,
  "Insurance":                                 0.025,
  // Health Care — sums to 0.110
  "Health Care Equipment & Services":          0.045,
  "Pharmaceuticals, Biotech & Life Sciences":  0.065,
  // Industrials — sums to 0.085
  "Capital Goods":                             0.055,
  "Commercial & Professional Services":        0.015,
  "Transportation":                            0.015,
  // Materials — sums to 0.020
  "Materials":                                 0.020,
  // Real Estate — sums to 0.024
  "Equity REITs":                              0.020,
  "Real Estate Management & Development":      0.004,
  // Utilities — sums to 0.025
  "Utilities":                                 0.025,
};

// Map the short sector labels in v9_allocation.json (e.g. "Info Tech",
// "Comm Svcs") to canonical GICS sector names used in SECTOR_GICS_BENCHMARK.
const SECTOR_SHORT_TO_GICS = {
  "Info Tech":          "Information Technology",
  "Comm Svcs":          "Communication Services",
  "Cons Disc":          "Consumer Discretionary",
  "Cons Staples":       "Consumer Staples",
  "Energy":             "Energy",
  "Financials":         "Financials",
  "Health Care":        "Health Care",
  "Industrials":        "Industrials",
  "Materials":          "Materials",
  "Real Estate":        "Real Estate",
  "Utilities":          "Utilities",
};

// ─── Composite scoring helpers ──────────────────────────────────────────────
// Match Today's Macro's framing: lower = lower drawdown probability = bullish.
function classifyComposite(score) {
  // Match Today's Macro classification — at score -20 the dial shows NORMAL,
  // not CALM. The Quiet/Calm zone is reserved for the deep negative tail.
  if (score == null || isNaN(score)) return { state: "—", color: "var(--text-muted)", pillBg: "transparent", pillColor: "var(--text-muted)" };
  if (score <= -50) return { state: "Quiet",    color: "var(--green-text)",  pillBg: "rgba(48,209,88,0.22)", pillColor: "var(--green-text)" };
  if (score <= 50)  return { state: "Normal",   color: "var(--green-text)",  pillBg: "rgba(48,209,88,0.14)", pillColor: "var(--green-text)" };
  if (score <= 75)  return { state: "Elevated", color: "var(--orange-text)", pillBg: "rgba(255,159,10,0.18)", pillColor: "var(--orange-text)" };
  return { state: "Stressed", color: "var(--red-text)", pillBg: "rgba(255,69,58,0.18)", pillColor: "var(--red-text)" };
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
      background: "var(--surface-solid)",
      border: "1px solid var(--border-strong)",
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
      <div style={{ height: 5, borderRadius: 3, position: "relative", background: "linear-gradient(to right, var(--green-text) 0%, var(--green-text) 33%, var(--yellow-text) 33%, var(--yellow-text) 66%, var(--orange-text) 66%, var(--orange-text) 84%, var(--red-text) 84%, var(--red-text) 100%)", opacity: 0.6 }}>
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
    ow: { label: "Overweight", bg: "rgba(48,209,88,0.18)", color: "var(--green-text)" },
    mw: { label: "Market Weight",     bg: "rgba(184,134,11,0.18)", color: "var(--yellow-text)" },
    uw: { label: "Underweight", bg: "rgba(255,69,58,0.18)", color: "var(--red-text)" },
    upgrade:   { label: "Upgrade",   bg: "rgba(48,209,88,0.18)",  color: "var(--green-text)" },
    downgrade: { label: "Downgrade", bg: "rgba(255,69,58,0.18)",  color: "var(--red-text)" },
    increase:  { label: "Increase",  bg: "rgba(48,209,88,0.18)",  color: "var(--green-text)" },
    exit:      { label: "Exit",      bg: "rgba(255,69,58,0.18)",  color: "var(--red-text)" },
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
    <div style={{ marginTop: 12, padding: 12, border: "1px solid var(--border-strong)", borderRadius: "var(--radius-md)", background: "var(--surface-solid)" }}>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <strong>{ig.sector} › {ig.name}</strong>
        <button onClick={onClose} style={{ background: "transparent", border: "0.5px solid var(--border)", borderRadius: 4, padding: "3px 9px", fontSize: 11, cursor: "pointer", color: "var(--text)" }}>Close ✕</button>
      </div>
      <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 8 }}>Detailed rationale not yet seeded for this industry group.</div>
    </div>
  );

  const inPicks = currentWeight && currentWeight > 0;
  const dollar = inPicks ? fmtDollar(currentWeight) : null;
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
          <div style={{ fontFamily: "var(--font-display, var(--font-ui))", fontSize: 17, fontWeight: 500 }}>{ig.sector} › {ig.name}</div>
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2, display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            <RatingPill rating={ig.rating} />
            <span>{seed.fund} ({seed.ticker})</span>
          </div>
        </div>
        <button onClick={onClose} style={{ background: "transparent", border: "0.5px solid var(--accent)", color: "var(--accent)", borderRadius: 4, padding: "3px 9px", fontSize: 11, cursor: "pointer" }}>Close ✕</button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginBottom: 12 }}>
        <div style={{ background: "var(--surface-solid)", border: "1px solid var(--border)", borderRadius: 4, padding: "8px 10px" }}>
          <div style={{ fontSize: 9, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.04em" }}>Target weight</div>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 15, fontWeight: 500 }}>{inPicks ? dollar : <span style={{ color: "var(--text-muted)", fontSize: 12, fontStyle: "italic" }}>Market weight — no Tilt</span>}</div>
        </div>
        <div style={{ background: "var(--surface-solid)", border: "1px solid var(--border)", borderRadius: 4, padding: "8px 10px" }}>
          <div style={{ fontSize: 9, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.04em" }}>SPY weight</div>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 15, fontWeight: 500 }}>{spyDollar}</div>
        </div>
        <div style={{ background: "var(--surface-solid)", border: "1px solid var(--border)", borderRadius: 4, padding: "8px 10px" }}>
          <div style={{ fontSize: 9, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.04em" }}>vs SPY</div>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 15, fontWeight: 500, color: delta > 0 ? "var(--green)" : delta < 0 ? "var(--red)" : "var(--text)" }}>{deltaDollar || "—"}</div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <div>
          <div style={{ fontSize: 10, color: "var(--accent)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6, fontWeight: 500 }}>{ig.rating === "ow" ? "Why it's overweight" : ig.rating === "uw" ? "Why it's underweight" : "Why it's market weight"}</div>
          <div style={{ fontSize: 12, lineHeight: 1.6 }}>{seed.rationale}</div>

          <div style={{ fontSize: 10, color: "var(--accent)", textTransform: "uppercase", letterSpacing: "0.05em", marginTop: 14, marginBottom: 6, fontWeight: 500 }}>How to express this view (ETF)</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 8 }}>
            {seed.ticker && <TickerChip ticker={seed.ticker} onOpenTicker={onOpenTicker} />}
            <span style={{ fontSize: 11, color: "var(--text-muted)", alignSelf: "center" }}>{seed.fund}</span>
          </div>
          <div style={{ fontSize: 10, color: "var(--accent)", textTransform: "uppercase", letterSpacing: "0.05em", marginTop: 14, marginBottom: 6, fontWeight: 500 }}>Example single-name holdings — click any ticker</div>
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

// ─── History view derivation ──────────────────────────────────────────────
// allocation_history.json is a flat ARRAY of weekly snapshots (one per
// Saturday) — schema produced by V9-ALLOCATION-WEEKLY workflow + the
// backfill script. The UI needs derived views: Last Month / Last Quarter
// totals, allocation changes (week-over-week rotations), and rating
// changes (upgrades / downgrades by window). This helper turns the
// array into the object shape the UI consumes.
function deriveHistoryView(raw) {
  if (!raw) return null;
  if (!Array.isArray(raw)) {
    // Tolerate object form (legacy seed); pass through.
    if (typeof raw === "object") return raw;
    return null;
  }
  if (raw.length === 0) return { _empty: true };

  // Sort by as_of ascending (just to be safe — backfill output is sorted)
  const snaps = [...raw].sort((a, b) => (a.as_of || "").localeCompare(b.as_of || ""));
  const current = snaps[snaps.length - 1];

  // Find snapshot ~30 days back (last_month) and ~91 days back (last_quarter)
  const findBack = (days) => {
    const targetTs = current.as_of ? new Date(current.as_of).getTime() - days * 86400000 : null;
    if (!targetTs) return null;
    let best = null;
    let bestDiff = Infinity;
    for (const s of snaps) {
      if (!s.as_of) continue;
      const ts = new Date(s.as_of).getTime();
      const diff = Math.abs(targetTs - ts);
      if (diff < bestDiff && ts <= new Date(current.as_of).getTime() - 14 * 86400000) {
        bestDiff = diff;
        best = s;
      }
    }
    return best;
  };

  const lastMonthSnap = findBack(30);
  const lastQuarterSnap = findBack(91);

  const liftTotals = (snap) => {
    if (!snap) return null;
    return {
      equities:    snap.equities_pct_capital,
      other:       snap.other_pct_capital,
      total:       snap.total_deployed_pct_capital,
      cash_margin: snap.cash_or_margin_pct_capital,
    };
  };

  // Allocation changes: diff current picks vs last_month picks
  const changes = [];
  if (lastMonthSnap) {
    const priorByTicker = Object.fromEntries((lastMonthSnap.picks || []).map(p => [p.ticker, p]));
    const currentByTicker = Object.fromEntries((current.picks || []).map(p => [p.ticker, p]));
    // New entries / weight changes
    for (const p of current.picks || []) {
      const prior = priorByTicker[p.ticker];
      if (!prior) {
        changes.push({ move: "increase", bucket: `${p.sector || ""} › ${p.name}`,
          new_weight: p.weight, prior_weight: 0, delta: p.weight });
      } else if (Math.abs((p.weight || 0) - (prior.weight || 0)) > 0.005) {
        changes.push({
          move: (p.weight || 0) > (prior.weight || 0) ? "increase" : "downgrade",
          bucket: `${p.sector || ""} › ${p.name}`,
          new_weight: p.weight, prior_weight: prior.weight,
          delta: (p.weight || 0) - (prior.weight || 0),
        });
      }
    }
    // Exits (in prior, not in current)
    for (const p of lastMonthSnap.picks || []) {
      if (!currentByTicker[p.ticker]) {
        changes.push({ move: "exit", bucket: `${p.sector || ""} › ${p.name}`,
          new_weight: 0, prior_weight: p.weight, delta: -(p.weight || 0) });
      }
    }
  }

  // Rating changes: upgrades / downgrades vs window
  const diffRatings = (priorSnap) => {
    if (!priorSnap || !priorSnap.ratings) return { upgrades: [], downgrades: [] };
    const priorByKey = Object.fromEntries(priorSnap.ratings.map(r => [r.key || r.ticker, r]));
    const upgrades = [];
    const downgrades = [];
    for (const r of current.ratings || []) {
      const prior = priorByKey[r.key || r.ticker];
      if (!prior) continue;
      if (prior.rating === r.rating) continue;
      const order = { ow: 3, mw: 2, uw: 1 };
      if ((order[r.rating] || 0) > (order[prior.rating] || 0)) upgrades.push(r.name);
      else if ((order[r.rating] || 0) < (order[prior.rating] || 0)) downgrades.push(r.name);
    }
    return { upgrades, downgrades };
  };

  const m1 = diffRatings(lastMonthSnap);
  const q3 = diffRatings(lastQuarterSnap);

  return {
    _list: snaps,
    last_month:   liftTotals(lastMonthSnap),
    last_quarter: liftTotals(lastQuarterSnap),
    last_month_as_of:   lastMonthSnap?.as_of,
    last_quarter_as_of: lastQuarterSnap?.as_of,
    changes,
    upgrades_1m:   m1.upgrades,
    downgrades_1m: m1.downgrades,
    upgrades_3m:   q3.upgrades,
    downgrades_3m: q3.downgrades,
  };
}

// ─── Live rating derivation helpers ──────────────────────────────────────
// All three rating displays on this page (sector table, heatmap chips,
// drilldown weight) MUST derive from the model output (`alloc.all_industry_groups`
// and `alloc.picks`). Hardcoded ratings in SECTOR_IG_MAP / SECTOR_RATINGS are
// fallbacks for when the JSON hasn't loaded yet — never the source of truth.
function buildIgRatingMap(allIgs) {
  // Returns Map<igName, ratingObj>
  const map = new Map();
  if (!Array.isArray(allIgs)) return map;
  for (const ig of allIgs) {
    map.set(ig.name, {
      rating: ig.rating || "mw",
      combined_rank: ig.combined_rank,
      indicator_rank: ig.indicator_rank,
      momentum_rank: ig.momentum_rank,
      ticker: ig.primary_ticker,
      sector: ig.sector,
    });
  }
  return map;
}

function deriveSectorRating(sector, igRatingMap, sectorIgMap) {
  // A sector's rating reflects the majority of its industry-group ratings:
  //   • Any OW IG → sector OW (the OW signal is the strongest)
  //   • All IGs UW → sector UW
  //   • Otherwise → MW (mixed)
  const row = sectorIgMap.find((r) => r.sector === sector);
  if (!row) return "mw";
  const igs = row.groups.map((g) => igRatingMap.get(g.name)?.rating).filter(Boolean);
  if (!igs.length) return "mw";
  if (igs.some((r) => r === "ow")) return "ow";
  if (igs.every((r) => r === "uw")) return "uw";
  return "mw";
}

// ─── Main component ───────────────────────────────────────────────────────
export default function AssetAllocation({ onOpenTicker }) {
  const [alloc, setAlloc]               = useState(null);
  const [composites, setComposites]     = useState(null);
  const [rationales, setRationales]     = useState(null);
  const [history, setHistory]           = useState(null);
  // No drill-down card open by default — Joe directive 2026-04-27. Cards
  // open only when the user clicks an Industry Group chip in the heatmap.
  const [activeBucket, setActiveBucket] = useState(null);

  useEffect(() => {
    fetch("/v9_allocation.json", { cache: "no-cache" }).then((r) => r.ok ? r.json() : null).then(setAlloc).catch(() => setAlloc(null));
    fetch("/composite_history_daily.json", { cache: "force-cache" }).then((r) => r.ok ? r.json() : null).then(setComposites).catch(() => setComposites(null));
    fetch("/industry_group_rationale.json?v=v9.1", { cache: "no-cache" }).then((r) => r.ok ? r.json() : null).then(setRationales).catch(() => setRationales(null));
    fetch("/allocation_history.json", { cache: "no-cache" })
      .then((r) => r.ok ? r.json() : null)
      .then((raw) => setHistory(deriveHistoryView(raw)))
      .catch(() => setHistory(null));
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
    // Stance derives from leverage in v9 (>1.05 = Aggressive). Override only on stress.
    if (rl >= 50)  return { label: "Defensive", color: "var(--red-text)", bg: "rgba(255,69,58,0.18)" };
    if (rl >= 30)  return { label: "Cautious",  color: "var(--orange-text)", bg: "rgba(255,159,10,0.18)" };
    return { label: "Aggressive", color: "var(--green-text)", bg: "rgba(48,209,88,0.18)" };
  }, [macroSnap]);

  // Live rating map derived from alloc.all_industry_groups — single source of truth
  const igRatingMap = useMemo(() => buildIgRatingMap(alloc?.all_industry_groups), [alloc]);

  // Hero KPI numbers from v9_allocation.json
  const totalEquity = alloc ? (alloc.leverage * alloc.equity_share) : null;
  const defensiveOn = alloc ? (alloc.equity_share < 0.99) : false;
  const margin = alloc ? Math.max(0, alloc.leverage - alloc.equity_share) : 0;
  const alpha = alloc?.alpha;
  const conviction = alloc?.selection_confidence || "—";

  // Picks for table 2 (allocation changes — stub data until allocation_history.json populates)
  const picks = alloc?.picks || [];
  const lastChange = picks.length ? picks[0]?.weight : null;

  // Format an ISO date (e.g. "2026-03-31") as "March 31".
  const humanDate = (iso) => {
    if (!iso) return "—";
    const [y, m, d] = iso.split("-").map(Number);
    const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    return `${monthNames[m - 1]} ${d}`;
  };

  // Derived hero subtitle — never goes stale because it reads the live composites.
  const heroSubtitle = useMemo(() => {
    if (!macroSnap) return "Loading macro snapshot...";
    const states = [macroSnap.RL?.score, macroSnap.GR?.score, macroSnap.IR?.score].map(classifyComposite);
    const allBenign = states.every(x => x.state === "Calm" || x.state === "Normal" || x.state === "Quiet");
    const anyStressed = states.some(x => x.state === "Stressed");
    const elevatedCount = states.filter(x => x.state === "Elevated").length;
    if (anyStressed) return "One or more composites in the stressed zone. Defensive sleeve activates.";
    if (elevatedCount >= 2) return "Composites turning elevated. Trim cyclicals; watch stress thresholds.";
    if (elevatedCount === 1) return "One composite in the elevated zone. Stay aggressive but monitor closely.";
    if (allBenign) return "All three macro composites read benign. Risk-on conditions support overweighting cyclicals and using leverage.";
    return "Mixed macro signals. Allocation tilts cyclical with normal leverage.";
  }, [macroSnap]);

  // Next rebalance date — computed live so the badge never goes stale.
  const nextSaturdayStr = useMemo(() => {
    const d = new Date();
    const daysUntilSat = (6 - d.getDay() + 7) % 7 || 7;
    d.setDate(d.getDate() + daysUntilSat);
    return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  }, []);

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
        padding: "var(--space-8) var(--space-10)",
        background: "var(--surface-solid)",
        border: "1px solid var(--border-strong)",
        borderRadius: "var(--radius-lg)",
        marginBottom: "var(--space-6)",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 14, flexWrap: "wrap" }}>
          <div style={{ minWidth: 0, flex: "1 1 320px" }}>
            <div style={{ fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--text-muted)", fontWeight: 600 }}>Asset Allocation</div>
            <h1 style={{ fontFamily: "var(--font-display, var(--font-ui))", fontSize: 26, fontWeight: 500, margin: "4px 0 4px", letterSpacing: "-0.015em" }}>
              {stance.label} — {totalEquity > 1.05 ? "leaning into cyclical rotation" : totalEquity > 0.85 ? "balanced positioning" : "defensive posture"}
            </h1>
            <p style={{ fontFamily: "var(--font-display, var(--font-ui))", fontSize: 14, fontStyle: "italic", color: "var(--text-muted)", margin: 0 }}>
              {heroSubtitle}
            </p>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 12px", borderRadius: 999, background: stance.bg, color: stance.color, fontWeight: 600, fontSize: 12 }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: stance.color }}/>
              {stance.label}
            </span>
            {(() => {
              // Freshness dot derives from how stale alloc.as_of is — NOT
              // calculated_at. Strategy rebalances weekly on Saturdays; if
              // as_of is more than a week old the rebalance hasn't run.
              // Joe correctly flagged 2026-04-27: dot was hardcoded green
              // even when as_of was 27 days stale (closes bug #1093).
              const asOf = alloc?.as_of ? new Date(alloc.as_of) : null;
              const days = asOf ? Math.floor((Date.now() - asOf.getTime()) / 86400000) : null;
              let color = "var(--text-muted)", note = "";
              if (days == null) { color = "var(--text-muted)"; note = "no rebalance loaded"; }
              else if (days <= 7)  { color = "var(--green-text)";  note = "fresh"; }
              else if (days <= 14) { color = "var(--yellow-text)"; note = `${days} days old — weekly rebalance overdue`; }
              else                 { color = "var(--red-text)";    note = `${days} days old — weekly rebalance has not run`; }
              return (
                <span style={{ fontSize: 10, color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 4 }}>
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: color }}/>
                  Updated weekly on Saturdays · Last update: {humanDate(alloc.as_of)}{note ? ` (${note})` : ""}
                </span>
              );
            })()}
          </div>
        </div>

        {/* Lead-in paragraph — explains what the page is and how to read it (Joe ask 2026-04-27). */}
        <p style={{ fontSize: 13.5, color: "var(--text-2)", lineHeight: 1.6, margin: "12px 0 0", maxWidth: 920 }}>
          This page is the model&apos;s strategic asset allocation — a recommendation, not a portfolio.
          It scores 25 GICS industry groups every Saturday on macro factors and 6-month momentum, then
          recommends 5 to overweight (equal-weight) and a defensive sleeve to activate when the
          Risk &amp; Liquidity composite enters stress. Read it top-to-bottom: the hero summarises
          the recommended posture; the asset-class view sizes it against a $100 portfolio; the sector
          table and heatmap show where the bets are. The numbers refresh weekly — the freshness dot
          above turns amber if the rebalance is overdue.
        </p>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, marginTop: 12 }}>
          <div style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", padding: "14px 16px" }}>
            <div style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 4 }}>
              Recommended Equity Exposure
              <InfoTip def="The recommended dollars of equities to hold per $100 of capital, including borrowed dollars from margin. When this exceeds $100, the difference is leverage (e.g., $128 means 28% margin)." />
            </div>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 26, fontWeight: 500, color: "var(--green-text)", marginTop: 2 }}>${(totalEquity * 100).toFixed(0)}</div>
            <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2 }}>per $100 capital · {(margin * 100).toFixed(0)}% margin</div>
          </div>
          <div style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", padding: "14px 16px" }}>
            <div style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 4 }}>
              Defensive sleeve
              <InfoTip def="The portion of capital held in safe assets — T-bills (BIL), long Treasuries (TLT), gold (GLD), and IG corporate bonds (LQD). Activates when Risk & Liquidity composite enters the elevated or stressed zone. Currently off." />
            </div>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 26, fontWeight: 500, marginTop: 2 }}>${defensiveOn ? ((1 - alloc.equity_share) * 100).toFixed(0) : 0}</div>
            <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2 }}>{defensiveOn ? "active" : "off · activates if R&L stresses"}</div>
          </div>
          <div style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", padding: "14px 16px" }}>
            <div style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 4 }}>
              Excess return target
              <InfoTip def="Expected outperformance versus the S&P 500 over the next month, after subtracting the financing cost on any margin used." />
            </div>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 26, fontWeight: 500, color: "var(--green-text)", marginTop: 2 }}>+{alpha.toFixed(2)} pp</div>
            <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2 }}>monthly · over S&P 500</div>
          </div>
          <div style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", padding: "14px 16px" }}>
            <div style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 4 }}>
              Conviction
              <InfoTip def="How confident the model is in the current ranking. STRONG = the top 5 industry groups are clearly separated from the rest on both indicator score and momentum rank." />
            </div>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 26, fontWeight: 500, marginTop: 2, textTransform: "capitalize" }}>{conviction.toLowerCase()}</div>
            <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2 }}>{picks.length} industry groups · clear rank separation</div>
          </div>
        </div>
      </section>

      {/* Section 1 — The What & The Why */}
      <section style={{ padding: "var(--space-8) var(--space-10)", background: "var(--surface-solid)", border: "1px solid var(--border-strong)", borderRadius: "var(--radius-lg)", marginBottom: "var(--space-6)" }}>
        <div style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--text-muted)", fontWeight: 600 }}>1 · The big picture</div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          {/* The What — actionable trade list, not a KPI restatement */}
          <div style={{ padding: "20px 22px", background: "color-mix(in srgb, var(--green-text) 10%, transparent)", borderLeft: "4px solid var(--green-text)", borderRadius: "var(--radius-md)" }}>
            <div style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.12em", fontWeight: 600, marginBottom: 6 }}>The What — how to position</div>
            <div style={{ fontFamily: "var(--font-display, var(--font-ui))", fontSize: 20, fontWeight: 500, marginBottom: 14, lineHeight: 1.3, color: "var(--text)" }}>
              Get long the cyclical complex. Pull capital out of bond proxies and defensive yield.
            </div>
            <ul style={{ fontSize: 14, lineHeight: 1.7, paddingLeft: 18, margin: 0, color: "var(--text-2)" }}>
              <li><strong>Lean into cyclicals.</strong> Build positions in Semiconductors (SOXX), Telecommunication Services (IYZ), Oil &amp; Gas (XLE), Capital Goods (XLI), Metals &amp; Mining (XLB). These five carry the overweight book.</li>
              <li><strong>Trim or exit defensive yield.</strong> Reduce Pharma &amp; Biotech (XLV/IBB), Banks (XLF), REITs (IYR), Utilities (XLU), and Consumer Staples (XLP) toward zero — they lose their thesis when the curve steepens.</li>
              <li><strong>Use leverage if your risk tolerance allows.</strong> Gross to roughly 1.28× via margin or 2× sector ETFs. Calm regimes earn the leverage budget.</li>
              <li><strong>Skip the defensive sleeve.</strong> No reason to hold cash, T-bills, or gold here — the regime doesn't pay for safety. Rotate any existing GLD/BIL/TLT into the cyclical picks.</li>
              <li><strong>Watch real rates.</strong> If 10Y TIPS breaks above 2%, trim Semis first — long-duration tech compresses fastest.</li>
              <li><strong>Pre-set the stop.</strong> If HY-IG spread widens past 250bp, defensive sleeve activates: rotate gross out of cyclicals into ~70% GLD, ~27% BIL, cut leverage to 1.0×.</li>
            </ul>
          </div>

          {/* The Why */}
          <div style={{ padding: "20px 22px", background: "color-mix(in srgb, var(--yellow-text) 10%, transparent)", borderLeft: "4px solid var(--yellow-text)", borderRadius: "var(--radius-md)" }}>
            <div style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.12em", fontWeight: 600, marginBottom: 6 }}>The Why</div>
            <div style={{ fontFamily: "var(--font-display, var(--font-ui))", fontSize: 20, fontWeight: 500, marginBottom: 14, lineHeight: 1.3, color: "var(--text)" }}>
              {heroSubtitle}
            </div>
            <ul style={{ fontSize: 14, lineHeight: 1.7, paddingLeft: 18, margin: 0, color: "var(--text-2)" }}>
              <li><strong>Real rates have rolled over</strong> — 10Y TIPS at 1.62%, supportive of long-duration tech multiples.</li>
              <li><strong>Yield curve is steepening</strong> (10Y−2Y at +54bp) — historically rewards cyclical sectors over bond proxies.</li>
              <li><strong>Credit spreads stayed tight</strong> through the Q1 wobble — HY−IG at 205bp, well below the 250bp stress trigger.</li>
              <li>Semis and Energy screen <strong>#1 and #2</strong> on combined indicator + 6-month momentum rank.</li>
              <li>Utilities and REITs lose their bond-proxy thesis when the curve steepens — exit the overweight set.</li>
              <li>Inflation &amp; Rates composite trending higher — worth watching, but the 18-month forward window means it's a trim signal, not a stop signal.</li>
            </ul>
          </div>
        </div>
      </section>

      {/* Section 2 — Recommended Asset Allocation
          Redesigned 2026-04-27 per Joe feedback: prior version was stark white, lots of
          whitespace, inconsistent negative formatting (($25) parens vs $-38 hyphen).
          New: single tight table, parens-for-negatives convention everywhere (financial
          standard), dynamic last-month / last-quarter dates from the history hook. */}
      <section style={{ padding: "var(--space-8) var(--space-10)", background: "var(--surface-solid)", border: "1px solid var(--border-strong)", borderRadius: "var(--radius-lg)", marginBottom: "var(--space-6)" }}>
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--text-muted)", fontWeight: 600 }}>2 · Recommended Asset Allocation</div>
          <h2 style={{ fontFamily: "var(--font-display, var(--font-ui))", fontSize: 22, fontWeight: 500, margin: "6px 0 4px" }}>Per $100 of capital — recommended now vs last month vs last quarter</h2>
          <p style={{ fontSize: 13, color: "var(--text-muted)", margin: 0, lineHeight: 1.55 }}>Negative dollars (margin used) shown in parentheses, financial-statement convention.</p>
        </div>

        {(() => {
          // Helpers — single source of truth for currency formatting on this section.
          // Negative = ($X), positive = $X, zero = $0. No hyphen-prefix anywhere.
          const fmt$ = (v, dp = 0) => {
            if (v == null) return "—";
            const abs = Math.abs(v).toFixed(dp);
            return v < 0 ? `($${abs})` : `$${abs}`;
          };
          const fmt$Δ = (v, dp = 0) => {
            if (v == null) return "—";
            if (Math.abs(v) < 0.005) return `$0`;
            const abs = Math.abs(v).toFixed(dp);
            return v < 0 ? `($${abs})` : `+$${abs}`;
          };
          const colorΔ = (v) => v == null || Math.abs(v) < 0.005 ? "var(--text-muted)" : (v > 0 ? "var(--green-text)" : "var(--red-text)");
          const monoR = { fontFamily: "var(--font-mono)", textAlign: "right", padding: "11px 18px", fontSize: 13 };
          const labelL = { padding: "11px 18px", fontSize: 13 };
          const headTh = { padding: "10px 18px", fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600, borderBottom: "1px solid var(--border-strong)" };

          const equityToday   = totalEquity != null ? totalEquity * 100 : null;
          const otherToday    = defensiveOn ? (1 - alloc.equity_share) * 100 : 0;
          const totalToday    = equityToday;
          const cashToday     = margin > 0 ? -margin * 100 : 0;
          const lastMonthDate = history?.last_month_as_of ? humanDate(history.last_month_as_of) : "—";
          const lastQtrDate   = history?.last_quarter_as_of ? humanDate(history.last_quarter_as_of) : "—";

          const rows = [
            { label: "Equities",                              now: equityToday, mo: history?.last_month?.equities,    qt: history?.last_quarter?.equities },
            { label: "Defensive (Bills · UST · Gold · IG)",   now: otherToday,  mo: history?.last_month?.other,       qt: history?.last_quarter?.other },
            { label: "Implied cash / (margin)",               now: cashToday,   mo: history?.last_month?.cash_margin, qt: history?.last_quarter?.cash_margin, muted: true },
            { label: "Total deployed",                        now: totalToday,  mo: history?.last_month?.total,       qt: history?.last_quarter?.total, total: true },
          ];

          return (
            <table style={{ width: "100%", borderCollapse: "collapse", background: "var(--bg)", borderRadius: "var(--radius-md)", overflow: "hidden", border: "1px solid var(--border)" }}>
              <thead>
                <tr>
                  <th style={{ ...headTh, textAlign: "left" }}>Asset class</th>
                  <th style={{ ...headTh, textAlign: "right" }}>Recommended now</th>
                  <th style={{ ...headTh, textAlign: "right" }}>Last month{lastMonthDate !== "—" ? ` (${lastMonthDate})` : ""}</th>
                  <th style={{ ...headTh, textAlign: "right" }}>Last quarter{lastQtrDate !== "—" ? ` (${lastQtrDate})` : ""}</th>
                  <th style={{ ...headTh, textAlign: "right" }}>Δ vs last month</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const delta = r.now != null && r.mo != null ? r.now - r.mo : null;
                  const isLast = i === rows.length - 1;
                  const rowBg = r.total ? "var(--surface-solid)" : "transparent";
                  const fontWeight = r.total ? 600 : 400;
                  const labelColor = r.muted && !r.total ? "var(--text-muted)" : "var(--text)";
                  const cellBorder = isLast ? "none" : "1px solid var(--border-faint)";
                  return (
                    <tr key={r.label} style={{ background: rowBg, fontWeight }}>
                      <td style={{ ...labelL, color: labelColor, borderBottom: cellBorder }}>{r.label}</td>
                      <td style={{ ...monoR, borderBottom: cellBorder }}>{fmt$(r.now)}</td>
                      <td style={{ ...monoR, color: "var(--text-muted)", borderBottom: cellBorder }}>{r.mo == null ? "—" : fmt$(r.mo)}</td>
                      <td style={{ ...monoR, color: "var(--text-muted)", borderBottom: cellBorder }}>{r.qt == null ? "—" : fmt$(r.qt)}</td>
                      <td style={{ ...monoR, color: colorΔ(delta), fontWeight: 600, borderBottom: cellBorder }}>{fmt$Δ(delta)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          );
        })()}

        {/* Allocation changes — sector-level rotations, same negative-paren convention */}
        {history?.changes && history.changes.length > 0 && (
          <>
            <h3 style={{ fontFamily: "var(--font-display, var(--font-ui))", fontSize: 14, fontWeight: 500, margin: "20px 0 8px" }}>Recent allocation changes</h3>
            <table style={{ width: "100%", borderCollapse: "collapse", background: "var(--bg)", borderRadius: "var(--radius-md)", overflow: "hidden", border: "1px solid var(--border)" }}>
              <thead>
                <tr>
                  <th style={{ padding: "10px 18px", fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600, borderBottom: "1px solid var(--border-strong)", textAlign: "left", width: 130 }}>Move</th>
                  <th style={{ padding: "10px 18px", fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600, borderBottom: "1px solid var(--border-strong)", textAlign: "left" }}>Sector / Industry group</th>
                  <th style={{ padding: "10px 18px", fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600, borderBottom: "1px solid var(--border-strong)", textAlign: "right" }}>New target</th>
                  <th style={{ padding: "10px 18px", fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600, borderBottom: "1px solid var(--border-strong)", textAlign: "right" }}>Prior</th>
                  <th style={{ padding: "10px 18px", fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600, borderBottom: "1px solid var(--border-strong)", textAlign: "right" }}>Δ</th>
                </tr>
              </thead>
              <tbody>
                {history.changes.map((c, i) => {
                  const newW = c.new_weight * 100;
                  const oldW = c.prior_weight * 100;
                  const delta = c.delta * 100;
                  const isLast = i === history.changes.length - 1;
                  const cellBorder = isLast ? "none" : "1px solid var(--border-faint)";
                  return (
                    <tr key={i}>
                      <td style={{ padding: "11px 18px", borderBottom: cellBorder }}><RatingPill rating={c.move} /></td>
                      <td style={{ padding: "11px 18px", fontSize: 13, borderBottom: cellBorder }}>{c.bucket}</td>
                      <td style={{ padding: "11px 18px", fontSize: 13, fontFamily: "var(--font-mono)", textAlign: "right", borderBottom: cellBorder }}>{newW < 0 ? `($${Math.abs(newW).toFixed(2)})` : `$${newW.toFixed(2)}`}</td>
                      <td style={{ padding: "11px 18px", fontSize: 13, fontFamily: "var(--font-mono)", textAlign: "right", color: "var(--text-muted)", borderBottom: cellBorder }}>{oldW < 0 ? `($${Math.abs(oldW).toFixed(2)})` : `$${oldW.toFixed(2)}`}</td>
                      <td style={{ padding: "11px 18px", fontSize: 13, fontFamily: "var(--font-mono)", textAlign: "right", fontWeight: 600, color: delta > 0 ? "var(--green-text)" : delta < 0 ? "var(--red-text)" : "var(--text-muted)", borderBottom: cellBorder }}>{Math.abs(delta) < 0.005 ? "$0" : delta < 0 ? `($${Math.abs(delta).toFixed(2)})` : `+$${delta.toFixed(2)}`}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </>
        )}
      </section>

      {/* Section 3 — Recommended Sector Allocation (UnifiedSectorTable only)
          Joe directive 2026-04-27: split previous Section 3 into two — table here, heatmap
          below. Table no longer triggers DrillDownPanel on IG sub-row clicks (the panel
          rendered offscreen because the table region is far above the heatmap). Cards now
          ONLY open from heatmap chip clicks in Section 4. */}
      <section style={{ padding: "var(--space-8) var(--space-10)", background: "var(--surface-solid)", border: "1px solid var(--border-strong)", borderRadius: "var(--radius-lg)", marginBottom: "var(--space-6)" }}>
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--text-muted)", fontWeight: 600 }}>3 · Recommended Sector Allocation</div>
          <h2 style={{ fontFamily: "var(--font-display, var(--font-ui))", fontSize: 22, fontWeight: 500, margin: "6px 0 4px" }}>11 GICS sectors — recommended weight, indicator rank, momentum rank, and tilt</h2>
          <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "0 0 4px", lineHeight: 1.55 }}>Each sector is rated Overweight / Market Weight / Underweight from the model&apos;s combined indicator + momentum rank. Click any sector row to see its industry groups (with their own ranks and rationale).</p>
        </div>

        <UnifiedSectorTable
          picks={picks}
          igRatingMap={igRatingMap}
          allIgs={alloc?.all_industry_groups || []}
          rationales={rationales}
        />
      </section>

      {/* Section 4 — Sector Heatmap (heatmap + DrillDownPanel) */}
      <section style={{ padding: "var(--space-8) var(--space-10)", background: "var(--surface-solid)", border: "1px solid var(--border-strong)", borderRadius: "var(--radius-lg)", marginBottom: "var(--space-6)" }}>
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--text-muted)", fontWeight: 600 }}>4 · Sector Heatmap</div>
          <h2 style={{ fontFamily: "var(--font-display, var(--font-ui))", fontSize: 22, fontWeight: 500, margin: "6px 0 4px" }}>Click each industry group for details</h2>
          <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "0 0 4px", lineHeight: 1.55 }}>All 25 GICS industry groups grouped by parent sector. Click any tile to open the rationale, key factors, kill factors, and example holdings.</p>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "120px repeat(3, 1fr)", gap: 3, fontSize: 10 }}>
          <div style={{ padding: "6px 4px" }}/>
          <div style={{ padding: "6px 4px", color: "var(--green-text)", textTransform: "uppercase", letterSpacing: "0.05em", fontSize: 10, textAlign: "center", fontWeight: 600 }}>Overweight</div>
          <div style={{ padding: "6px 4px", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", fontSize: 10, textAlign: "center", fontWeight: 600 }}>Market weight</div>
          <div style={{ padding: "6px 4px", color: "var(--red-text)", textTransform: "uppercase", letterSpacing: "0.05em", fontSize: 10, textAlign: "center", fontWeight: 600 }}>Underweight</div>

          {SECTOR_IG_MAP.map((row) => (
            <HeatmapRow key={row.sector} row={row} activeBucket={activeBucket} setActiveBucket={setActiveBucket} igRatingMap={igRatingMap} />
          ))}
        </div>

        {activeBucket && activeBucket.ticker && !rationales && (
          <div style={{ marginTop: 12, padding: 14, border: "1px solid var(--border)", borderRadius: "var(--radius-md)", background: "var(--surface-solid)", color: "var(--text-muted)", fontSize: 13, fontStyle: "italic" }}>Loading rationale for {activeBucket.name}…</div>
        )}
        {activeBucket && activeBucket.ticker && rationales && (
          <DrillDownPanel
            ig={activeBucket}
            rationaleData={rationales}
            onOpenTicker={onOpenTicker}
            onClose={() => setActiveBucket(null)}
            currentWeight={picks.find(p => p.ticker === activeBucket.ticker)?.weight || 0}
            spyWeight={activeBucket?.ticker ? (SPY_WEIGHTS[activeBucket.ticker] ?? null) : null}
          />
        )}
      </section>

      {/* Section 5 — Risk management (renumbered from 4) */}
      <section style={{ padding: "var(--space-8) var(--space-10)", background: "var(--surface-solid)", border: "1px solid var(--border-strong)", borderRadius: "var(--radius-lg)", marginBottom: "var(--space-6)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12, gap: 10 }}>
          <div>
            <div style={{ fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--text-muted)", fontWeight: 600 }}>5 · What to watch out for</div>
            <h2 style={{ fontFamily: "var(--font-display, var(--font-ui))", fontSize: 22, fontWeight: 500, margin: "6px 0 4px" }}>What to watch out for</h2>
            <p style={{ fontSize: 13, color: "var(--text-muted)", margin: 0, lineHeight: 1.55 }}>Each scenario lists the trigger, the industry groups exposed, and the mechanism.</p>
          </div>
          <span style={{ fontSize: 10, color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--green-text)" }}/>
            Stress 0/9 fired
          </span>
        </div>

        {RISK_SCENARIOS.map((scn, i) => (
          <div key={i} style={{ border: "1px solid var(--border)", borderRadius: "var(--radius-md)", padding: "16px 20px", marginTop: 10, background: "var(--bg)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
              <div style={{ fontFamily: "var(--font-display, var(--font-ui))", fontWeight: 500, fontSize: 15 }}>{scn.trigger}</div>
              {scn.indicator_id && (
                <a href={`#indicators?id=${scn.indicator_id}`} style={{ fontSize: 11, color: "var(--accent)", textDecoration: "none", padding: "5px 12px", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", whiteSpace: "nowrap" }}>View indicator →</a>
              )}
            </div>
            <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 8, lineHeight: 1.6 }}>{scn.impact}</div>
            <div style={{ marginTop: 8, display: "flex", gap: 5, flexWrap: "wrap" }}>
              {scn.tags.map((t) => <span key={t} style={{ fontSize: 10, padding: "3px 8px", borderRadius: 3, background: "var(--surface-solid)", border: "0.5px solid var(--border)", color: "var(--text-muted)" }}>{t}</span>)}
            </div>
          </div>
        ))}
      </section>

      {/* Section 6 — Methodology summary + back-test stats (renumbered from 5) */}
      <section style={{ padding: "var(--space-8) var(--space-10)", background: "var(--surface-solid)", border: "1px solid var(--border-strong)", borderRadius: "var(--radius-lg)", marginBottom: "var(--space-6)" }}>
        <div style={{ marginBottom: "var(--space-5)" }}>
          <div style={{ fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--text-muted)", fontWeight: 600 }}>6 · Methodology</div>
          <h2 style={{ fontFamily: "var(--font-display, var(--font-ui))", fontSize: 22, fontWeight: 500, margin: "6px 0 0" }}>How this allocation is built</h2>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)", maxWidth: 880, fontSize: 13.5, color: "var(--text)", lineHeight: 1.65 }}>
          <p style={{ margin: 0 }}>
            <strong>What the model does.</strong> Every Saturday it scores 25 industry groups across the 11 GICS sectors using a small set of macro indicators that have predicted those groups historically (per group: jobless claims, real rates, the 10Y-2Y yield curve, credit spreads, and similar — the specific set is industry-group dependent). It picks the five groups where both the macro signal and the 6-month price trend agree they're attractive, holds them in equal weight, and adds leverage up to 1.5× when the broader risk environment is calm. When the Risk &amp; Liquidity composite crosses into stress, equity exposure scales down and a defensive sleeve (T-bills, long Treasuries, gold, investment-grade bonds) activates.
          </p>
          <p style={{ margin: 0 }}>
            <strong>Key assumptions.</strong> Macro factors that mattered for a given industry group from 1998 through today will continue to matter. Six-month price momentum carries information about near-term direction. The S&amp;P 500 is the benchmark; over- and under-weights are measured against it. Rebalances are weekly so the strategy responds to regime shifts faster than monthly tactical models. No transaction-cost or tax modeling is included — the back-test is gross.
          </p>
          <p style={{ margin: 0 }}>
            <strong>Honest limitations.</strong> Twelve of the twenty-five industry groups don&apos;t have a clean single-ETF proxy and are tracked through equal-weighted baskets of the largest names — implementation cost is higher for those (Capital Goods, Commercial &amp; Professional Services, Consumer Durables &amp; Apparel, Consumer Services, Staples Distribution &amp; Retail, Food/Beverage/Tobacco, Household &amp; Personal Products, Tech Hardware &amp; Equipment, Telecommunication Services, Media &amp; Entertainment, Real Estate Management &amp; Development, Automobiles &amp; Components when CARZ is unavailable). The model concentrates in 5 picks at a time, so it under-performs in years where dispersion was low and the top 5 happened to lag (2009, 2021, 2024). Leverage is capped at 1.5× by design — not a market call. The model is allocation guidance only; no live trading.
          </p>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "var(--space-3)", marginTop: "var(--space-6)" }}>
          <div style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", padding: "14px 16px" }}>
            <div style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600 }}>CAGR vs S&amp;P 500</div>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 24, fontWeight: 500, marginTop: 4, color: "var(--green-text)" }}>{((alloc.methodology?.back_test_cagr || 0) * 100).toFixed(1)}%</div>
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>S&amp;P 500: <strong>{(((alloc.methodology?.back_test_cagr || 0) - (alloc.methodology?.vs_spy_cagr_diff || 0)) * 100).toFixed(1)}%</strong> · Δ <span style={{ color: "var(--green-text)", fontWeight: 600 }}>+{((alloc.methodology?.vs_spy_cagr_diff || 0) * 100).toFixed(1)} pp</span></div>
          </div>
          <div style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", padding: "14px 16px" }}>
            <div style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600 }}>Sharpe vs S&amp;P 500</div>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 24, fontWeight: 500, marginTop: 4 }}>{(alloc.methodology?.back_test_sharpe || 0).toFixed(2)}</div>
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>S&amp;P 500: <strong>0.45</strong> · Δ <span style={{ color: "var(--green-text)", fontWeight: 600 }}>+{((alloc.methodology?.back_test_sharpe || 0) - 0.45).toFixed(2)}</span></div>
            <div style={{ fontSize: 10, color: "var(--text-dim)", marginTop: 6, fontStyle: "italic" }}>Risk-free rate = 3-month T-bill. Both Sharpes computed identically.</div>
          </div>
          <div style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", padding: "14px 16px" }}>
            <div style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600 }}>Max drawdown vs S&amp;P 500</div>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 24, fontWeight: 500, marginTop: 4, color: "var(--red-text)" }}>{((alloc.methodology?.back_test_max_drawdown || 0) * 100).toFixed(1)}%</div>
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>S&amp;P 500: <strong>−50.9%</strong> · Δ <span style={{ color: "var(--green-text)", fontWeight: 600 }}>+{((alloc.methodology?.back_test_max_drawdown || 0) * 100 + 50.9).toFixed(1)} pp</span></div>
          </div>
          <div style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", padding: "14px 16px" }}>
            <div style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600 }}>Win rate vs S&amp;P 500</div>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 24, fontWeight: 500, marginTop: 4, color: "var(--green-text)" }}>62%</div>
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>monthly outperformance frequency</div>
          </div>
        </div>

        <div style={{ marginTop: "var(--space-5)", paddingTop: "var(--space-4)", borderTop: "1px solid var(--border)", fontSize: 12, color: "var(--text-muted)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span>Allocation Model v9.1 (current)</span>
          <a href="#readme" onClick={(e) => { e.preventDefault(); window.location.hash = "#readme"; setTimeout(() => { const el = document.getElementById("mth__asset-alloc"); if (el) el.scrollIntoView({ behavior: "smooth", block: "start" }); }, 60); }} style={{ color: "var(--accent)", textDecoration: "none", fontWeight: 500, cursor: "pointer" }}>View full methodology →</a>
        </div>
      </section>

    </main>
  );
}

// ─── Tiny helpers ──────────────────────────────────────────────────────────
function thStyle() {
  return {
    textAlign: "left",
    padding: "12px 18px",
    fontSize: 10,
    color: "var(--text-muted)",
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    fontWeight: 600,
    borderBottom: "1px solid var(--border-strong)",
  };
}
function tdStyle() { return { padding: "13px 18px", borderBottom: "1px solid var(--border)", verticalAlign: "middle", fontSize: 13 }; }
function tdRight() { return { ...tdStyle(), textAlign: "right" }; }
function dollarStyle() { return { fontFamily: "var(--font-mono)", color: "var(--text)" }; }

function HistCell({ value, loading }) {
  if (loading || value == null) return <span style={{ color: "var(--text-muted)" }}>—</span>;
  return <span style={dollarStyle()}>${value.toFixed(0)}</span>;
}



// ─── Unified 11-sector table v2 ─────────────────────────────────────────
// One row per GICS sector. Columns: Sector / Rating / Recommended Allocation
// / S&P 500 Allocation / Tilt / Why.
//   - Every column sortable (LESSONS rule 4) via useSortableTable hook.
//   - Default sort: Tilt descending (overweights at top, underweights at bottom).
//   - Expand-all / Collapse-all toggle button above the table.
//   - Click any sector row → expand to reveal IG sub-rows. Each IG sub-row
//     has its own Why (top key factor + value from rationales JSON).
//   - Click any IG sub-row → opens the DrillDownPanel below the heatmap.
//   - Expanded sector row gets a left-border accent + stronger background
//     so the parent/child hierarchy is visually clear (Joe feedback —
//     previous version made parent and IG sub-rows the same color).
//   - IG sub-weights sum to parent sector — verified at parse time via
//     reconciliation script (Materials/Energy/IT/etc.).
function UnifiedSectorTable({ picks, igRatingMap, rationales, allIgs }) {
  const [expanded, setExpanded] = useState(new Set());
  const toggleRow = (sector) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(sector)) next.delete(sector); else next.add(sector);
      return next;
    });
  };
  const allSectors = SECTOR_IG_MAP.map((s) => s.sector);
  const allOpen = expanded.size === allSectors.length;
  const expandAll = () => setExpanded(new Set(allSectors));
  const collapseAll = () => setExpanded(new Set());

  // Pick weight by ticker (only the 5 picks have non-zero weight).
  const pickWeightByTicker = {};
  for (const p of (picks || [])) pickWeightByTicker[p.ticker] = p.weight || 0;

  // Rating numeric rank for sort (ow > mw > uw).
  const ratingRank = { ow: 3, mw: 2, uw: 1 };

  // Live indicator/momentum rank lookups by IG ticker (from v9_allocation.json
  // all_industry_groups). Lower number = stronger signal. Joe ask 2026-04-27:
  // surface these in the table so users can see WHY a rating landed where it did.
  const rankByTicker = {};
  for (const ig of (allIgs || [])) {
    if (ig.primary_ticker) rankByTicker[ig.primary_ticker] = { ind: ig.indicator_rank, mom: ig.momentum_rank };
  }

  // Build per-sector aggregates with their child IGs.
  const baseRows = SECTOR_IG_MAP.map((s) => {
    const igs = s.groups.map((g) => {
      const rec = pickWeightByTicker[g.ticker] || 0;
      const spy = SECTOR_IG_SPY_WEIGHTS[g.name] || 0;
      const rating = igRatingMap?.get(g.name)?.rating || g.rating || "mw";
      const ranks = rankByTicker[g.ticker] || {};
      // Per-IG Why = full curated rationale paragraph from industry_group_rationale.json.
      const seed = rationales?.buckets?.[g.ticker];
      const why = seed?.rationale || "—";
      return {
        name: g.name, ticker: g.ticker, basket: !!g.basket,
        rec, spy, tilt: rec - spy, rating,
        indRank: ranks.ind ?? null,
        momRank: ranks.mom ?? null,
        why,
      };
    });
    const recTotal = igs.reduce((a, x) => a + x.rec, 0);
    const spyTotal = SECTOR_GICS_BENCHMARK[s.sector] ?? igs.reduce((a, x) => a + x.spy, 0);
    const sectorRating = deriveSectorRating(s.sector, igRatingMap, SECTOR_IG_MAP);
    // Sector-level rank = the BEST (lowest) IG rank in the sector, since that's
    // the rank that determines whether a sector becomes a pick.
    const indRanks = igs.map(x => x.indRank).filter(x => x != null);
    const momRanks = igs.map(x => x.momRank).filter(x => x != null);
    const sectorIndRank = indRanks.length ? Math.min(...indRanks) : null;
    const sectorMomRank = momRanks.length ? Math.min(...momRanks) : null;
    // Sector-level Why = the existing one-paragraph rationale from SECTOR_RATINGS.
    const why = SECTOR_RATINGS.find((r) => r.sector === s.sector)?.rationale || "";
    return {
      sector: s.sector,
      igs,
      rec: recTotal,
      spy: spyTotal,
      tilt: recTotal - spyTotal,
      rating: sectorRating,
      indRank: sectorIndRank,
      momRank: sectorMomRank,
      why,
    };
  });

  // Sortable columns. Default sort by Tilt descending.
  const cols = [
    { id: "sector",  label: "Sector",                  align: "left",  sortValue: (r) => r.sector },
    { id: "rating",  label: "Rating",                  align: "left",  sortValue: (r) => ratingRank[r.rating] || 0 },
    { id: "rec",     label: "Recommended Allocation", align: "right", sortValue: (r) => r.rec },
    { id: "spy",     label: "S&P 500 Allocation",      align: "right", sortValue: (r) => r.spy },
    { id: "tilt",    label: "Tilt",                    align: "right", sortValue: (r) => r.tilt },
    { id: "indRank", label: "Indicator Rank",          align: "right", sortValue: (r) => r.indRank },
    { id: "momRank", label: "Momentum Rank",           align: "right", sortValue: (r) => r.momRank },
    { id: "why",     label: "Why",                     align: "left",  sortValue: (r) => r.why },
  ];
  const { sorted, sortCol, sortDir, toggleSort } = useSortableTable({
    rows: baseRows,
    columns: cols,
    defaultColId: "tilt",
    defaultDir: "desc",
  });

  const fmtPct = (x) => `${(x * 100).toFixed(1)}%`;
  const fmtTilt = (x) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)} pp`;
  const fmtRank = (x) => x == null ? "—" : `#${x}`;
  const tiltColor = (x) => Math.abs(x) < 0.005 ? "var(--text-muted)" : (x > 0 ? "var(--green-text)" : "var(--red-text)");

  const thBase = { padding: "12px 14px", fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600, borderBottom: "1px solid var(--border-strong)", cursor: "pointer", userSelect: "none" };
  const thLeft = { ...thBase, textAlign: "left" };
  const thRight = { ...thBase, textAlign: "right" };
  const thCenter = { ...thBase, textAlign: "center" };
  const tdBase = { padding: "14px 14px", fontSize: 13, borderBottom: "1px solid var(--border-faint)", verticalAlign: "middle" };
  const tdRight = { ...tdBase, textAlign: "right", fontFamily: "var(--font-mono)" };
  const tdCenter = { ...tdBase, textAlign: "center" };

  // Parent row when expanded gets a stronger background + 3px accent left
  // border + bold sector name. Sub-rows stay at lighter --surface. Resolves
  // Joe's note that parent and sub-rows previously looked identical.
  const PARENT_BG_OPEN = "var(--surface-solid)";
  const SUBROW_BG = "var(--surface)";

  return (
    <div>
      {/* Expand-all / Collapse-all toggle */}
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
        <button
          type="button"
          onClick={() => (allOpen ? collapseAll() : expandAll())}
          style={{
            fontSize: 11,
            padding: "5px 14px",
            border: "1px solid var(--border)",
            borderRadius: 4,
            background: "var(--bg)",
            color: "var(--text)",
            cursor: "pointer",
            fontWeight: 500,
            letterSpacing: "0.04em",
          }}
        >
          {allOpen ? "Collapse all" : "Expand all"}
        </button>
      </div>

      <table style={{ width: "100%", borderCollapse: "collapse", background: "var(--bg)", borderRadius: "var(--radius-md)", overflow: "hidden", border: "1px solid var(--border)", tableLayout: "fixed" }}>
        <colgroup>
          <col style={{ width: "16%" }} />
          <col style={{ width: 120 }} />
          <col style={{ width: 96 }} />
          <col style={{ width: 96 }} />
          <col style={{ width: 80 }} />
          <col style={{ width: 84 }} />
          <col style={{ width: 84 }} />
          <col />
        </colgroup>
        <thead>
          <tr>
            <th style={thLeft}   onClick={() => toggleSort("sector")}>Sector <SortArrow dir={sortCol === "sector" ? sortDir : null} /></th>
            <th style={thCenter} onClick={() => toggleSort("rating")}>Rating <SortArrow dir={sortCol === "rating" ? sortDir : null} /></th>
            <th style={thRight}  onClick={() => toggleSort("rec")}>Recommended<br/>Allocation <SortArrow dir={sortCol === "rec" ? sortDir : null} /></th>
            <th style={thRight}  onClick={() => toggleSort("spy")}>S&amp;P 500<br/>Allocation <SortArrow dir={sortCol === "spy" ? sortDir : null} /></th>
            <th style={thRight}  onClick={() => toggleSort("tilt")}>Tilt <SortArrow dir={sortCol === "tilt" ? sortDir : null} /></th>
            <th style={thRight}  onClick={() => toggleSort("indRank")}>Indicator<br/>Rank <SortArrow dir={sortCol === "indRank" ? sortDir : null} /></th>
            <th style={thRight}  onClick={() => toggleSort("momRank")}>Momentum<br/>Rank <SortArrow dir={sortCol === "momRank" ? sortDir : null} /></th>
            <th style={thLeft}   onClick={() => toggleSort("why")}>Why <SortArrow dir={sortCol === "why" ? sortDir : null} /></th>
          </tr>
        </thead>
        <tbody>
          {sorted.flatMap((r) => {
            const isOpen = expanded.has(r.sector);
            const rows = [];
            // Parent (sector) row
            rows.push(
              <tr
                key={r.sector}
                onClick={() => toggleRow(r.sector)}
                style={{
                  cursor: "pointer",
                  background: isOpen ? PARENT_BG_OPEN : "transparent",
                  borderLeft: isOpen ? "3px solid var(--accent)" : "3px solid transparent",
                  transition: "background 80ms",
                }}
                onMouseEnter={(e) => { if (!isOpen) e.currentTarget.style.background = "var(--surface)"; }}
                onMouseLeave={(e) => { if (!isOpen) e.currentTarget.style.background = "transparent"; }}
              >
                <td style={{ ...tdBase, fontFamily: "var(--font-display, var(--font-ui))", fontWeight: 600, fontSize: 14 }}>
                  <span style={{ display: "inline-block", width: 16, color: "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: 11 }}>{isOpen ? "▾" : "▸"}</span>
                  {r.sector}
                </td>
                <td style={tdCenter}><RatingPill rating={r.rating} /></td>
                <td style={tdRight}>{fmtPct(r.rec)}</td>
                <td style={{ ...tdRight, color: "var(--text-muted)" }}>{fmtPct(r.spy)}</td>
                <td style={{ ...tdRight, color: tiltColor(r.tilt), fontWeight: 600 }}>{fmtTilt(r.tilt)}</td>
                <td style={{ ...tdRight, color: "var(--text-muted)", fontSize: 11 }}>{fmtRank(r.indRank)} <span style={{ fontSize: 9 }}>(best IG)</span></td>
                <td style={{ ...tdRight, color: "var(--text-muted)", fontSize: 11 }}>{fmtRank(r.momRank)} <span style={{ fontSize: 9 }}>(best IG)</span></td>
                <td style={{ ...tdBase, fontSize: 12, color: "var(--text-2)", lineHeight: 1.55, whiteSpace: "normal", wordBreak: "break-word" }}>{r.why}</td>
              </tr>
            );
            // IG sub-rows — read-only, no DrillDownPanel trigger (Joe directive
            // 2026-04-27: cards open ONLY from heatmap chip clicks below).
            if (isOpen) {
              for (const ig of r.igs) {
                rows.push(
                  <tr
                    key={`${r.sector}-${ig.name}`}
                    style={{ background: SUBROW_BG }}
                  >
                    <td style={{ ...tdBase, paddingLeft: 50, fontSize: 12, color: "var(--text-2)" }}>
                      <span style={{ color: "var(--text-muted)", marginRight: 6 }}>↳</span>{ig.name}{" "}
                      <span style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: 11 }}>({ig.ticker}{ig.basket ? " basket" : ""})</span>
                    </td>
                    <td style={tdCenter}><RatingPill rating={ig.rating} size="sm" /></td>
                    <td style={{ ...tdRight, fontSize: 12 }}>{fmtPct(ig.rec)}</td>
                    <td style={{ ...tdRight, color: "var(--text-muted)", fontSize: 12 }}>{fmtPct(ig.spy)}</td>
                    <td style={{ ...tdRight, color: tiltColor(ig.tilt), fontSize: 12, fontWeight: 600 }}>{fmtTilt(ig.tilt)}</td>
                    <td style={{ ...tdRight, color: "var(--text-2)", fontSize: 12 }}>{fmtRank(ig.indRank)}</td>
                    <td style={{ ...tdRight, color: "var(--text-2)", fontSize: 12 }}>{fmtRank(ig.momRank)}</td>
                    <td style={{ ...tdBase, fontSize: 11, color: "var(--text-2)", lineHeight: 1.5, whiteSpace: "normal", wordBreak: "break-word" }}>{ig.why}</td>
                  </tr>
                );
              }
            }
            return rows;
          })}
        </tbody>
      </table>
    </div>
  );
}

function HeatmapRow({ row, activeBucket, setActiveBucket, igRatingMap }) {
  // Live rating from the model — falls back to row.groups[].rating when JSON hasn't loaded.
  const liveRating = (g) => igRatingMap?.get(g.name)?.rating || g.rating || "mw";
  const groups = row.groups.map(g => ({ ...g, rating: liveRating(g) }));
  const ow = groups.filter(g => g.rating === "ow");
  const mw = groups.filter(g => g.rating === "mw");
  const uw = groups.filter(g => g.rating === "uw");

  const cellStyle = (color) => ({
    display: "flex", flexWrap: "wrap", gap: 3, padding: 4, borderRadius: 4, alignContent: "flex-start", minHeight: 30,
    background: color === "ow" ? "color-mix(in srgb, var(--green-text) 18%, transparent)" : color === "uw" ? "color-mix(in srgb, var(--red-text) 18%, transparent)" : "color-mix(in srgb, var(--yellow-text) 14%, transparent)",
  });

  return (
    <>
      <div style={{ padding: "8px 4px", fontFamily: "var(--font-display, var(--font-ui))", fontSize: 11, display: "flex", alignItems: "center" }}>{row.sector}</div>
      <div style={cellStyle("ow")}>
        {ow.map(g => <Chip key={g.name} g={g} sector={row.sector} active={activeBucket?.name === g.name} onClick={() => setActiveBucket(prev => (prev?.name === g.name && prev?.sector === row.sector) ? null : { ...g, sector: row.sector })} />)}
      </div>
      <div style={cellStyle("mw")}>
        {mw.map(g => <Chip key={g.name} g={g} sector={row.sector} active={activeBucket?.name === g.name} onClick={() => setActiveBucket(prev => (prev?.name === g.name && prev?.sector === row.sector) ? null : { ...g, sector: row.sector })} />)}
      </div>
      <div style={cellStyle("uw")}>
        {uw.map(g => <Chip key={g.name} g={g} sector={row.sector} active={activeBucket?.name === g.name} onClick={() => setActiveBucket(prev => (prev?.name === g.name && prev?.sector === row.sector) ? null : { ...g, sector: row.sector })} />)}
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
        cursor: "pointer",
        background: active ? "var(--accent)" : "var(--surface)",
        color: active ? "#fff" : (g.rating === "ow" ? "var(--green)" : g.rating === "uw" ? "var(--red)" : "var(--text)"),
        border: active ? "1px solid var(--accent)" : "0.5px solid var(--border)",
        fontWeight: g.rating === "ow" || g.rating === "uw" ? 600 : 400,
        opacity: 1,
      }}
      
    >
      {g.name}
    </button>
  );
}
