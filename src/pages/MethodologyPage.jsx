// MethodologyPage v2 — one unified "Data & Methodology" page.
//
// Six sections, top-to-bottom:
//   §1  Header + overview (what MacroTilt is)
//   §2  By tab — Home / Macro / Sector / Scanner / Portfolio
//   §3  Indicator → Category Map (auto-rendered from IND + WEIGHTS + CATS)
//   §4  Composite Score Math (auto-rendered from WEIGHTS + CONVICTION)
//   §5  Signal Score Math (auto-rendered from sectionComposites.js)
//   §6  Data Streams Catalog (existing 36-tile searchable grid)
//
// Props (all passed from App.jsx so there is a single source of truth):
//   ind          — the IND registry (IND[id] = [short, long, cat, tier,
//                  unit, dec, now, mo1, mo3, m6, m12, invertDir, desc, narrative])
//   asOf         — map of id → latest-data stamp ({vix:"Apr 16 2026", ...})
//   weights      — the WEIGHTS map used by compScore (id → 1.5/1.2/1.0)
//   cats         — the CATS map (category key → {label, color})
//   indFreq      — IND_FREQ map (id → "D"|"W"|"M"|"Q")
//
// SECTION_WEIGHTS for the scanner signal score is imported directly from
// ../ticker/sectionComposites.js — that file is already the single source
// of truth (the Python mirror in trading-scanner/scanner/signal_composite.py
// carries a "MUST mirror" comment).

import React, { useMemo, useState } from "react";
import { DATA_REGISTRY, DATA_SECTIONS, buildSearchBlob } from "../data/dataRegistry";
import {
  SECTION_WEIGHTS,
  SECTION_ORDER,
  SECTION_LABELS,
} from "../ticker/sectionComposites";

// ─── MIRRORS ────────────────────────────────────────────────────────────────
// Mirror of the CONVICTION array in App.jsx. Duplicated here (4 lines) rather
// than plumbed through props because it's trivial to keep in sync and the
// methodology page is the only other consumer. If these numbers change in
// App.jsx, update them here. Kept narrow: just what §4 renders.
const CONVICTION_MIRROR = [
  { level: 1, label: "LOW",      range: [-99, 0.25], color: "#30d158", eq: 90, bd: 5,  ca: 3,  au: 2,
    action: "Risk-on. Historically benign conditions. Consider adding cyclical beta." },
  { level: 2, label: "NORMAL",   range: [0.25, 0.88], color: "#ffd60a", eq: 75, bd: 15, ca: 7,  au: 3,
    action: "Market baseline. Maintain diversified exposure. Trim highest-beta on spikes." },
  { level: 3, label: "ELEVATED", range: [0.88, 1.6],  color: "#ff9f0a", eq: 55, bd: 28, ca: 12, au: 5,
    action: "Active hedging warranted. Sell covered calls. Rotate defensive. Reduce leverage." },
  { level: 4, label: "EXTREME",  range: [1.6, 99],    color: "#ff453a", eq: 20, bd: 30, ca: 35, au: 15,
    action: "Crisis regime. Maximum defensiveness. Harvest losses. Hold dry powder." },
];

// Frequency color accents for freq pills on tiles.
const FREQ_COLORS = { Daily: "var(--accent)", Weekly: "#14b8a6", Monthly: "#f59e0b", Quarterly: "#a78bfa" };
function freqAccent(freq) {
  if (!freq) return "var(--text-dim)";
  for (const [k, v] of Object.entries(FREQ_COLORS)) { if (freq.startsWith(k)) return v; }
  return "#ec4899";
}
// Indicator-frequency labels (D/W/M/Q → human words).
const FREQ_LABEL = { D: "Daily", W: "Weekly", M: "Monthly", Q: "Quarterly" };

// Precompute search blobs once per registry entry.
const REGISTRY_WITH_BLOBS = DATA_REGISTRY.map((row) => ({ ...row, _blob: buildSearchBlob(row) }));

// ─── MAIN COMPONENT ─────────────────────────────────────────────────────────
export default function MethodologyPage({ ind, asOf, weights, cats, indFreq }) {
  return (
    <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 28 }}>
      <HeaderOverview />
      <JumpNav />
      <TabWalkthrough />
      <CategoryMap ind={ind} weights={weights} cats={cats} indFreq={indFreq} />
      <CompositeMath ind={ind} weights={weights} cats={cats} />
      <SignalScoreMath />
      <CatalogSection ind={ind} asOf={asOf} cats={cats} />
      <Disclaimer />
    </div>
  );
}

// ─── §1 HEADER + OVERVIEW ───────────────────────────────────────────────────
function HeaderOverview() {
  return (
    <section id="methodology-overview" data-testid="methodology-section-overview"
      style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ fontSize: 22, fontWeight: 700, color: "var(--text)" }}>
        Data & Methodology
      </div>
      <div style={{ fontSize: 13, color: "var(--text-2)", lineHeight: 1.7, maxWidth: 880 }}>
        How every number in MacroTilt is built, where it comes from, and how it's weighted —
        top-down from macro to micro.
      </div>
      <div style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.75, maxWidth: 880 }}>
        MacroTilt is two engines stacked on top of each other. The <strong>macro engine</strong> converts
        25 indicators into a 0–100 Composite Stress Score — where we are in the regime. The <strong>sector
        engine</strong> drops one level down to ask which sectors are likely to out- or under-perform
        given that regime. The <strong>micro engine</strong> scans individual stocks for conviction-trade
        setups — insiders, Congress, options flow, technicals — and scores each one from −100 (bearish)
        to +100 (bullish). Your <strong>portfolio view</strong> is the overlay: macro → sector → micro
        lined up against your actual holdings and watchlist.
      </div>
    </section>
  );
}

// ─── JUMP NAV ───────────────────────────────────────────────────────────────
function JumpNav() {
  const links = [
    ["By tab",           "#methodology-tabs"],
    ["Category map",     "#methodology-catmap"],
    ["Composite math",   "#methodology-composite-math"],
    ["Signal math",      "#methodology-signal-math"],
    ["Data streams",     "#methodology-catalog"],
  ];
  return (
    <nav data-testid="methodology-toc"
      style={{ display: "flex", flexWrap: "wrap", gap: 8, fontFamily: "var(--font-mono)", fontSize: 11,
               borderTop: "1px solid var(--border)", borderBottom: "1px solid var(--border)",
               padding: "10px 0", color: "var(--text-dim)" }}>
      <span style={{ color: "var(--text-dim)", letterSpacing: "0.08em" }}>JUMP TO:</span>
      {links.map(([label, href], i) => (
        <React.Fragment key={href}>
          <a href={href} style={{ color: "var(--accent)", textDecoration: "none" }}>{label}</a>
          {i < links.length - 1 && <span style={{ color: "var(--border)" }}>·</span>}
        </React.Fragment>
      ))}
    </nav>
  );
}

// ─── §2 BY TAB ──────────────────────────────────────────────────────────────
const TAB_CONTENT = [
  {
    key: "home",
    title: "Home",
    tagline: "Landing page — all tiles",
    what: "Four tiles at a glance: Macro (Composite Stress Score + category breakdown), Micro (Scanner top Buy/Near Trigger), Portfolio (macro + micro overlayed onto your holdings), and a Sector strip (brief cross-sectional read).",
    dataFeed: "Every upstream the dashboard uses — FRED, CBOE, ICE BofA, Chicago Fed, St. Louis Fed, NY Fed, FDIC, ISM, BLS, Shiller, Unusual Whales, Yahoo Finance.",
    cadence: "Each tile refreshes on its source cadence. Market-vol (VIX, MOVE, yield curve) is daily; Fed surveys are weekly; ISM and CAPE are monthly; SLOOS and FDIC are quarterly. Scanner output is daily (3:30 PM ET) plus scan-on-add.",
    howComputed: "Each tile is a compressed view of its full tab. No new math here — Home just aggregates. Click any tile to drill into the full tab.",
    howRead: "Tile colors reflect conviction bands — green (benign), yellow (normal), amber (elevated), red (crisis). Colors come from the Composite SD-unit bands (see Composite math below).",
  },
  {
    key: "macro",
    title: "Macro",
    tagline: "Which direction is the market likely to go",
    what: "Composite Stress Score gauge (0–100), 6-category breakdown, 25-indicator grid, historical stress chart with timeframe selector, and a trend/velocity chip showing whether stress is rising or falling over the last 4 weeks.",
    dataFeed: "25 indicators across six categories — Equity & Vol, Credit Markets, Rates & Duration, Financial Conditions, Bank & Money Supply, Labor & Economy. Sources below in the Category Map.",
    cadence: "Indicator-specific. Daily for market-vol and yield-curve series; weekly for Fed stress indices and bank credit; monthly for ISM, CAPE, JOLTS; quarterly for SLOOS surveys and FDIC unrealized losses.",
    howComputed: "See Composite Math below for the full walk. Short version: each indicator is z-scored against its own history, direction-flipped if 'lower is worse' (e.g. yield-curve inversion), weighted by tier (T1 = 1.5×, T2 = 1.2×, T3 = 1.0×), and averaged.",
    howRead: "The raw Composite is in SD units (negative = benign, positive = stress). Conviction bands on the SD scale: LOW (<0.25), NORMAL (0.25–0.88), ELEVATED (0.88–1.6), EXTREME (>1.6). The 0–100 gauge is a rescaling of the same number for display.",
  },
  {
    key: "sector",
    title: "Sector",
    tagline: "One level below Macro — which sectors out/underperform",
    what: "Cross-sectional sector scoring. Ranks sector ETFs on factor tilts given the current macro regime.",
    dataFeed: "Sector ETF prices (Yahoo), macro-factor overlays (from the Composite engine), fundamentals (Unusual Whales screener aggregates).",
    cadence: "Rebuilds daily when underlying snapshots and macro indicators refresh.",
    howComputed: "Cross-sectional factor engine, independent of the macro Composite per the two-engine architecture — Sector scores are relative (rank-based), not absolute stress. A macro-conditioned overlay tilts the factor mix based on the current regime (what works in LOW is different from what works in EXTREME).",
    howRead: "Currently admin-only (Sector Lab · BETA) while being rebuilt. Methodology on this page will fill in automatically as the new tab exposes its factor weights and scoring rules.",
    betaNote: true,
  },
  {
    key: "scanner",
    title: "Scanner",
    tagline: "Micro — stock-specific triggers",
    what: "Per-ticker directional signal score (−100 to +100). Rows tag as Buy Alert (STRONG BULL), Near Trigger (BULLISH upper half), or lower tiers. Six section sub-composites visible on ticker detail — Technicals, Options, Insider, Congress, Analyst, Dark Pool.",
    dataFeed: "Unusual Whales (options flow, dark-pool prints, SEC Form 4 insider trades, Congressional PTR disclosures, screener fundamentals, news). Yahoo Finance for prices and technicals. Analyst ratings from UW.",
    cadence: "Daily full scan at 3:30 PM ET across the union of all users' watchlists. Scan-on-add within seconds when you insert a new ticker. News / events refresh 3×/weekday (10:00, 13:00, 15:45 ET).",
    howComputed: "See Signal Math below. Each of 6 sections emits a −100..+100 score; the composite is a weighted blend with the weights shown there.",
    howRead: "Composite ≥60 STRONG BULL (Buy Alert); ≥40 BULLISH upper half (Near Trigger — calibrated 2026-04-20 up from 30); ≥10 TILT BULL; (−10, 10) NEUTRAL; ≤−10 TILT BEAR; ≤−30 BEARISH; ≤−60 STRONG BEAR. The directional label boundary for BULLISH stays at 30 (label ≠ tier membership).",
  },
  {
    key: "portfolio",
    title: "Portfolio",
    tagline: "How it all comes together on your portfolio and watchlist",
    what: "Positions table, watchlist, and Trading Opportunities panel. Fuses macro regime guidance (what should I hold in EXTREME?) with sector tilts (am I over- or under-weight the right sectors?) and micro triggers (scanner Buy Alerts within my watchlist).",
    dataFeed: "User-entered positions and watchlist tickers (row-level-security scoped to your account), overlayed with universe_snapshots for fresh prices / IV / flow, and user_scan_data for the latest scanner signal per ticker.",
    cadence: "Holdings are static until you edit them. Prices, IV, and flow refresh on the 3×/weekday snapshot cadence. Scanner signal columns refresh nightly + on scan-on-add.",
    howComputed: "PnL Day = (latest price − prior close) × quantity. % Wealth = position value ÷ total portfolio value. The Trading Opportunities panel filters the scanner output to your watchlist and ranks by composite. Concentration and beta flags fire at preset rule thresholds (no subjective scoring).",
    howRead: "Positions rows surface a REVIEW flag when the scanner has a meaningful signal on one of your holdings. Observations are rules-driven only — concentration >10% of portfolio, beta outliers, deployable cash, scanner REVIEW. Silent when no rule fires.",
  },
];

function TabWalkthrough() {
  return (
    <section id="methodology-tabs" data-testid="methodology-section-tabs"
      style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <SectionHeader label="BY TAB" sub={`${TAB_CONTENT.length} user-facing tabs`}/>
      <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.65, maxWidth: 820 }}>
        For each tab: what you see, what data feeds it, refresh cadence, how it's computed, and how to read it.
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(420px, 1fr))", gap: 14 }}>
        {TAB_CONTENT.map((t) => <TabBlock key={t.key} tab={t}/>)}
      </div>
    </section>
  );
}

function TabBlock({ tab }) {
  return (
    <article data-testid={`methodology-tab-${tab.key}`}
      style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8,
               padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>{tab.title}</div>
        {tab.betaNote && (
          <span style={{ fontSize: 10, fontFamily: "var(--font-mono)", color: "#a78bfa",
                         border: "1px solid #a78bfa", borderRadius: 3, padding: "1px 6px", letterSpacing: "0.05em" }}>
            BETA · admin
          </span>
        )}
      </div>
      <div style={{ fontSize: 11, color: "var(--text-dim)", fontFamily: "var(--font-mono)",
                    letterSpacing: "0.06em", textTransform: "uppercase" }}>
        {tab.tagline}
      </div>
      <FieldRow label="What you see"        body={tab.what}/>
      <FieldRow label="Data feeding it"     body={tab.dataFeed}/>
      <FieldRow label="Refresh cadence"     body={tab.cadence}/>
      <FieldRow label="How it's computed"   body={tab.howComputed}/>
      <FieldRow label="How to read it"      body={tab.howRead}/>
    </article>
  );
}

function FieldRow({ label, body }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <div style={{ fontSize: 10, color: "var(--text-dim)", fontFamily: "var(--font-mono)",
                    letterSpacing: "0.08em", textTransform: "uppercase" }}>
        {label}
      </div>
      <div style={{ fontSize: 12, color: "var(--text-2)", lineHeight: 1.7 }}>
        {body}
      </div>
    </div>
  );
}

// ─── §3 INDICATOR → CATEGORY MAP ────────────────────────────────────────────
function CategoryMap({ ind, weights, cats, indFreq }) {
  // Group IND keys by category (IND[id][2]) and sort within category by tier asc.
  const grouped = useMemo(() => {
    const g = {};
    Object.keys(ind || {}).forEach((id) => {
      const row = ind[id] || [];
      const cat = row[2];
      if (!cat) return;
      if (!g[cat]) g[cat] = [];
      g[cat].push({
        id,
        short: row[0],
        long: row[1],
        tier: row[3],
        unit: row[4],
        weight: (weights && weights[id]) || 0,
        freq: (indFreq && indFreq[id]) || "",
      });
    });
    Object.values(g).forEach((rows) => rows.sort((a,b) => (a.tier - b.tier) || a.short.localeCompare(b.short)));
    return g;
  }, [ind, weights, indFreq]);

  // Keep category rendering order stable and consistent with App.jsx order.
  const CAT_ORDER = ["equity", "credit", "rates", "fincond", "bank", "labor"];
  const orderedCats = CAT_ORDER.filter((k) => grouped[k] && grouped[k].length > 0);
  const totalCount = Object.values(grouped).reduce((n, rows) => n + rows.length, 0);

  return (
    <section id="methodology-catmap" data-testid="methodology-section-catmap"
      style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <SectionHeader label="INDICATOR → CATEGORY MAP" sub={`${totalCount} macro indicators · ${orderedCats.length} categories`}/>
      <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.65, maxWidth: 820 }}>
        Every macro indicator that feeds the Composite, grouped by category and shown with its tier weight.
        Rendered live from <code style={{ fontFamily: "var(--font-mono)" }}>IND</code> + <code style={{ fontFamily: "var(--font-mono)" }}>WEIGHTS</code> in App.jsx — if a weight changes, this table updates automatically.
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {orderedCats.map((ck) => {
          const cat = cats?.[ck];
          if (!cat) return null;
          const rows = grouped[ck];
          return (
            <div key={ck} style={{ background: "var(--surface)", border: "1px solid var(--border)",
                                    borderRadius: 8, overflow: "hidden" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px",
                            background: "var(--surface-2)", borderBottom: "1px solid var(--border)" }}>
                <span style={{ width: 10, height: 10, borderRadius: 2, background: cat.color }}/>
                <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text)",
                               fontFamily: "var(--font-mono)", letterSpacing: "0.06em", textTransform: "uppercase" }}>
                  {cat.label}
                </span>
                <span style={{ fontSize: 10, color: "var(--text-dim)", fontFamily: "var(--font-mono)" }}>
                  · {rows.length} {rows.length === 1 ? "indicator" : "indicators"}
                </span>
              </div>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, fontFamily: "var(--font-mono)" }}>
                <thead>
                  <tr style={{ color: "var(--text-dim)" }}>
                    <th style={thStyle}>Indicator</th>
                    <th style={thStyle}>Long name</th>
                    <th style={{ ...thStyle, textAlign: "center" }}>Tier</th>
                    <th style={{ ...thStyle, textAlign: "right" }}>Weight</th>
                    <th style={{ ...thStyle, textAlign: "center" }}>Freq</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} style={{ borderTop: "1px solid var(--border)" }}>
                      <td style={{ ...tdStyle, color: "var(--text)", fontWeight: 600 }}>{r.short}</td>
                      <td style={{ ...tdStyle, color: "var(--text-2)" }}>{r.long}</td>
                      <td style={{ ...tdStyle, textAlign: "center", color: cat.color, fontWeight: 700 }}>T{r.tier}</td>
                      <td style={{ ...tdStyle, textAlign: "right", color: "var(--text-2)" }}>{r.weight.toFixed(1)}×</td>
                      <td style={{ ...tdStyle, textAlign: "center", color: "var(--text-muted)" }}>
                        {FREQ_LABEL[r.freq] || r.freq || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })}
      </div>
    </section>
  );
}

const thStyle = { textAlign: "left", fontWeight: 600, fontSize: 10, letterSpacing: "0.08em",
                   textTransform: "uppercase", padding: "8px 12px" };
const tdStyle = { padding: "8px 12px", verticalAlign: "top" };

// ─── §4 COMPOSITE MATH ──────────────────────────────────────────────────────
function CompositeMath({ ind, weights }) {
  // Tier distribution pulled live from WEIGHTS.
  const tierBuckets = useMemo(() => {
    const buckets = { 1: [], 2: [], 3: [] };
    if (!ind || !weights) return buckets;
    Object.keys(weights).forEach((id) => {
      const w = weights[id];
      const tier = w >= 1.5 ? 1 : w >= 1.2 ? 2 : 3;
      const short = ind[id]?.[0] || id;
      buckets[tier].push(short);
    });
    return buckets;
  }, [ind, weights]);

  const tierRows = [
    { tier: 1, weight: 1.5, label: "most market-sensitive" },
    { tier: 2, weight: 1.2, label: "important but less real-time" },
    { tier: 3, weight: 1.0, label: "structural / context" },
  ];

  return (
    <section id="methodology-composite-math" data-testid="methodology-section-compmath"
      style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <SectionHeader label="COMPOSITE SCORE MATH" sub="How the 25 indicators roll up into one number"/>

      <Prose>
        <P><strong>Step 1 — z-score each indicator against its own history.</strong> Mean and standard deviation
        are computed from each indicator's own historical series, so the question is <em>"how unusual is
        today's reading for this particular metric?"</em> not <em>"how high is this number?"</em>. A VIX of
        20 is a different signal than an ISM PMI of 20. Formula: <code>r = (v − μ<sub>id</sub>) / σ<sub>id</sub></code>.</P>

        <P><strong>Step 2 — flip sign where lower is worse.</strong> Most indicators point the same way ("up
        = stress") but some are inverted — yield curve inversion (low = recessionary), ISM PMI (low =
        contraction), copper/gold (low = growth fear), CAPE (high = rich valuation = stress). Those
        indicators get sign-flipped so that every contributor runs the same direction before aggregation.
        The flip is controlled by each indicator's direction flag in <code>SD[id].dir</code>.</P>

        <P><strong>Step 3 — apply tier weights.</strong> The 25 indicators split into three tiers by market
        sensitivity:</P>
      </Prose>

      {/* Tier table — tier, weight, count, list of short names (auto-rendered). */}
      <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, fontFamily: "var(--font-mono)" }}>
          <thead>
            <tr style={{ color: "var(--text-dim)", background: "var(--surface-2)" }}>
              <th style={thStyle}>Tier</th>
              <th style={{ ...thStyle, textAlign: "right" }}>Weight</th>
              <th style={{ ...thStyle, textAlign: "center" }}>Count</th>
              <th style={thStyle}>Description</th>
              <th style={thStyle}>Indicators</th>
            </tr>
          </thead>
          <tbody>
            {tierRows.map((row) => (
              <tr key={row.tier} style={{ borderTop: "1px solid var(--border)" }}>
                <td style={{ ...tdStyle, fontWeight: 700, color: "var(--text)" }}>T{row.tier}</td>
                <td style={{ ...tdStyle, textAlign: "right", color: "var(--text)" }}>{row.weight.toFixed(1)}×</td>
                <td style={{ ...tdStyle, textAlign: "center", color: "var(--text-2)" }}>
                  {tierBuckets[row.tier]?.length || 0}
                </td>
                <td style={{ ...tdStyle, color: "var(--text-2)" }}>{row.label}</td>
                <td style={{ ...tdStyle, color: "var(--text-muted)" }}>
                  {(tierBuckets[row.tier] || []).join(", ")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Prose>
        <P><strong>Step 4 — weighted average.</strong> The Composite is the weighted mean of the z-scored,
        sign-flipped indicators:</P>
        <Formula>COMP = Σ(sdScore(id) × W[id]) / Σ(W[id])</Formula>
        <P>Only indicators with a non-null reading in the current snapshot contribute — a missing data point
        drops out of the numerator and denominator, so it doesn't falsely pull the composite toward zero.</P>

        <P><strong>Step 5 — rescale for display.</strong> The raw Composite is in SD units (negative =
        benign, positive = stress). The 0–100 gauge is a linear rescale clamped to [0, 100]:</P>
        <Formula>COMP<sub>100</sub> = clamp(((COMP + 1) / 4) × 100, 0, 100)</Formula>
        <P>So an SD-unit composite of 0 renders as 25, +1 as 50, +3 as 100. The bands below are named on the
        SD scale; the gauge shows the rescaled value.</P>
      </Prose>

      {/* Conviction bands — auto-rendered from CONVICTION_MIRROR. */}
      <div>
        <div style={{ fontSize: 10, color: "var(--text-dim)", fontFamily: "var(--font-mono)",
                      letterSpacing: "0.08em", marginBottom: 8 }}>
          CONVICTION BANDS
        </div>
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, fontFamily: "var(--font-mono)" }}>
            <thead>
              <tr style={{ color: "var(--text-dim)", background: "var(--surface-2)" }}>
                <th style={thStyle}>Band</th>
                <th style={thStyle}>SD range</th>
                <th style={{ ...thStyle, textAlign: "center" }}>EQ</th>
                <th style={{ ...thStyle, textAlign: "center" }}>BD</th>
                <th style={{ ...thStyle, textAlign: "center" }}>CA</th>
                <th style={{ ...thStyle, textAlign: "center" }}>AU</th>
                <th style={thStyle}>Guidance</th>
              </tr>
            </thead>
            <tbody>
              {CONVICTION_MIRROR.map((c) => {
                const lo = c.range[0] === -99 ? "<" : `${c.range[0].toFixed(2)} – `;
                const hi = c.range[1] ===  99 ? "" : c.range[1].toFixed(2);
                const rng = c.range[0] === -99 ? `< ${c.range[1].toFixed(2)}`
                          : c.range[1] ===  99 ? `≥ ${c.range[0].toFixed(2)}`
                          : `${c.range[0].toFixed(2)} – ${c.range[1].toFixed(2)}`;
                return (
                  <tr key={c.label} style={{ borderTop: "1px solid var(--border)" }}>
                    <td style={{ ...tdStyle, fontWeight: 700, color: c.color }}>{c.label}</td>
                    <td style={{ ...tdStyle, color: "var(--text-2)" }}>{rng}</td>
                    <td style={{ ...tdStyle, textAlign: "center", color: "var(--text-2)" }}>{c.eq}%</td>
                    <td style={{ ...tdStyle, textAlign: "center", color: "var(--text-2)" }}>{c.bd}%</td>
                    <td style={{ ...tdStyle, textAlign: "center", color: "var(--text-2)" }}>{c.ca}%</td>
                    <td style={{ ...tdStyle, textAlign: "center", color: "var(--text-2)" }}>{c.au}%</td>
                    <td style={{ ...tdStyle, color: "var(--text-muted)" }}>{c.action}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 6 }}>
          EQ / BD / CA / AU = equities / bonds / cash / alternatives (illustrative allocation shifts; not investment advice).
        </div>
      </div>
    </section>
  );
}

// ─── §5 SIGNAL SCORE MATH ───────────────────────────────────────────────────
function SignalScoreMath() {
  // Tier bands for the directional composite (mirror of labelFromScore in sectionComposites.js).
  const TIER_BANDS = [
    { label: "STRONG BULL", range: "≥ 60",   note: "Buy Alert",                   color: "#30d158" },
    { label: "BULLISH",     range: "30 – 59", note: "Near Trigger ≥ 40 (calibrated 2026-04-20)", color: "#30d158" },
    { label: "TILT BULL",   range: "10 – 29", note: "below threshold",            color: "#86efac" },
    { label: "NEUTRAL",     range: "−10 – 10", note: "no directional read",       color: "#ffd60a" },
    { label: "TILT BEAR",   range: "−29 – −10", note: "below threshold",          color: "#fbbf24" },
    { label: "BEARISH",     range: "−59 – −30", note: "directional short bias",   color: "#ff9f0a" },
    { label: "STRONG BEAR", range: "≤ −60",  note: "conviction bear",             color: "#ff453a" },
  ];

  const SECTION_BLURBS = {
    technicals: "RSI momentum, MACD crossover direction, price vs. 50-/200-day moving averages. Scanner emits an SCTR-style composite in [−100, +100].",
    insider:    "SEC Form 4 purchases and sales weighted by dollar notional across qualifying rows. Insider BUYs carry more weight than SELLs (selling is far more common and less informative).",
    options:    "Unusual Whales real-time options flow. Sweep vs. block, call/put mix, premium size. Large call sweeps with meaningful premium push the score up.",
    congress:   "Unusual Whales congressional PTR disclosures, 45-day rolling window. Scored by disclosed dollar-range tier and buy/sell direction.",
    analyst:    "Rating changes and price-target revisions from the UW analyst feed. Upgrades and PT increases lift the score.",
    darkpool:   "Dark-pool block prints weighted by volume vs. ADV and recency. Intentionally small (5%) — historically a weak tiebreaker, not a standalone signal.",
  };

  const weightsTotal = SECTION_ORDER.reduce((s, k) => s + (SECTION_WEIGHTS[k] || 0), 0);

  return (
    <section id="methodology-signal-math" data-testid="methodology-section-signalmath"
      style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <SectionHeader label="SIGNAL SCORE MATH" sub="How the scanner turns 6 section scores into one tier"/>

      <Prose>
        <P>Every scanned ticker carries <strong>two parallel scores</strong>. The legacy <em>bullish-only 0–100
        score</em> is preserved for historical sorting (some report views and sort columns still read it).
        The <strong>bidirectional composite in [−100, +100]</strong> is what drives current tiering — Buy
        Alert, Near Trigger, and the directional label you see in the modal. When decisions get made, the
        composite is what matters.</P>

        <P><strong>The composite is a weighted average of 6 section scores.</strong> Each section independently
        emits a score in [−100, +100] — bullish, bearish, or null for "no qualifying activity". Weights sum
        to {weightsTotal}:</P>
      </Prose>

      {/* Section weights table — auto-rendered from SECTION_WEIGHTS. */}
      <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, fontFamily: "var(--font-mono)" }}>
          <thead>
            <tr style={{ color: "var(--text-dim)", background: "var(--surface-2)" }}>
              <th style={thStyle}>Section</th>
              <th style={{ ...thStyle, textAlign: "right" }}>Weight</th>
              <th style={thStyle}>What it scores</th>
            </tr>
          </thead>
          <tbody>
            {SECTION_ORDER.map((k) => (
              <tr key={k} style={{ borderTop: "1px solid var(--border)" }}>
                <td style={{ ...tdStyle, fontWeight: 700, color: "var(--text)" }}>{SECTION_LABELS[k] || k}</td>
                <td style={{ ...tdStyle, textAlign: "right", color: "var(--text-2)" }}>
                  {SECTION_WEIGHTS[k]}%
                </td>
                <td style={{ ...tdStyle, color: "var(--text-muted)" }}>
                  {SECTION_BLURBS[k] || ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Prose>
        <P><strong>Aggregation rule.</strong> The composite is the weighted average across sections with a
        non-null score. A section with no qualifying activity drops out of both numerator and denominator,
        so one empty section doesn't dilute the others toward zero.</P>

        <Formula>composite = Σ(section<sub>i</sub> × w<sub>i</sub>) / Σ(w<sub>i</sub>)   (over sections with score ≠ null)</Formula>

        <P>Both sides of the system use the same numbers: <code>src/ticker/sectionComposites.js</code> (the
        dashboard) and <code>trading-scanner/scanner/signal_composite.py</code> (the scanner). The Python
        file carries a "MUST mirror" comment enforcing parity.</P>

        <P><strong>Directional label + tier bands.</strong> The composite maps to a named direction (for the
        modal label) and to a tier (for Buy Alert / Near Trigger membership). Label and tier are decoupled
        — the Near Trigger threshold was lifted from 30 → 40 on 2026-04-20 to drop the arithmetic noise in
        the 30-34 band (51/67 Near Trigger names on the 2026-04-19 scan were in that band purely from
        weighted-average dilution). The BULLISH label boundary stays at 30.</P>
      </Prose>

      {/* Tier band table. */}
      <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, fontFamily: "var(--font-mono)" }}>
          <thead>
            <tr style={{ color: "var(--text-dim)", background: "var(--surface-2)" }}>
              <th style={thStyle}>Directional label</th>
              <th style={thStyle}>Composite range</th>
              <th style={thStyle}>Tier meaning</th>
            </tr>
          </thead>
          <tbody>
            {TIER_BANDS.map((t) => (
              <tr key={t.label} style={{ borderTop: "1px solid var(--border)" }}>
                <td style={{ ...tdStyle, fontWeight: 700, color: t.color }}>{t.label}</td>
                <td style={{ ...tdStyle, color: "var(--text-2)" }}>{t.range}</td>
                <td style={{ ...tdStyle, color: "var(--text-muted)" }}>{t.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ─── §6 CATALOG — tiles + search ────────────────────────────────────────────
function CatalogSection({ ind, asOf, cats }) {
  const [query, setQuery] = useState("");
  const [openKeys, setOpenKeys] = useState(() => new Set());

  const q = query.trim().toLowerCase();

  const filtered = useMemo(() => {
    if (!q) return REGISTRY_WITH_BLOBS;
    return REGISTRY_WITH_BLOBS.filter((row) => row._blob.includes(q));
  }, [q]);

  const bySection = useMemo(() => {
    const map = new Map(DATA_SECTIONS.map((s) => [s.key, []]));
    for (const row of filtered) {
      const bucket = map.get(row.section);
      if (bucket) bucket.push(row);
    }
    return map;
  }, [filtered]);

  const totalCount = REGISTRY_WITH_BLOBS.length;
  const matchCount = filtered.length;

  function toggle(key) {
    setOpenKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }
  function expandAllVisible() { setOpenKeys(new Set(filtered.map((r) => r.key))); }
  function collapseAll()      { setOpenKeys(new Set()); }

  return (
    <section id="methodology-catalog" data-testid="methodology-section-catalog"
      style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <SectionHeader label="DATA STREAMS CATALOG" sub={`${totalCount} streams · searchable`}/>

      <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.65, maxWidth: 820 }}>
        Every upstream data stream in one place. Click a tile to expand. Use the search box to filter by
        name, source, series ID, keyword, or downstream tab.
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search streams, sources, series IDs, keywords…"
          aria-label="Search data streams"
          data-testid="methodology-search"
          style={{
            flex: "1 1 320px", minWidth: 260, maxWidth: 560,
            fontSize: 13, padding: "9px 12px",
            border: "1px solid var(--border)", borderRadius: 6,
            background: "var(--surface-2)", color: "var(--text)",
            fontFamily: "var(--font-mono)", outline: "none",
          }}
        />
        <span data-testid="methodology-match-count"
          style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--text-dim)", whiteSpace: "nowrap" }}>
          {q ? `${matchCount} / ${totalCount} streams` : `${totalCount} streams`}
        </span>
        <button type="button" onClick={expandAllVisible} style={catalogBtnStyle}>Expand visible</button>
        <button type="button" onClick={collapseAll}     style={catalogBtnStyle}>Collapse all</button>
      </div>

      {DATA_SECTIONS.map((sec) => {
        const rows = bySection.get(sec.key) || [];
        if (q && rows.length === 0) return null;
        return (
          <div key={sec.key} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10,
                          paddingBottom: 6, borderBottom: "1px solid var(--border)" }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)",
                            fontFamily: "var(--font-mono)", letterSpacing: "0.08em" }}>
                {sec.label.toUpperCase()}
              </div>
              <div style={{ fontSize: 11, color: "var(--text-dim)", fontFamily: "var(--font-mono)" }}>
                · {rows.length} {rows.length === 1 ? "stream" : "streams"}
              </div>
            </div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.55, maxWidth: 820, marginBottom: 4 }}>
              {sec.blurb}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))", gap: 10 }}>
              {rows.map((row) => (
                <Tile key={row.key} row={row} cats={cats}
                  open={openKeys.has(row.key)} onToggle={() => toggle(row.key)}
                  ind={ind} asOf={asOf}/>
              ))}
            </div>
          </div>
        );
      })}

      {q && matchCount === 0 && (
        <div style={{ background: "var(--surface)", border: "1px dashed var(--border)",
                      borderRadius: 8, padding: "16px 18px",
                      fontSize: 13, color: "var(--text-muted)", textAlign: "center" }}>
          No streams match <code style={{ color: "var(--text)" }}>{JSON.stringify(query)}</code>.
          Try <code>fred</code>, <code>options</code>, or <code>quarterly</code>.
        </div>
      )}
    </section>
  );
}

const catalogBtnStyle = {
  fontSize: 11, fontFamily: "var(--font-mono)",
  padding: "6px 10px", borderRadius: 4,
  background: "var(--surface-2)", color: "var(--text-2)",
  border: "1px solid var(--border)", cursor: "pointer",
};

function Tile({ row, open, onToggle, ind, asOf, cats }) {
  const cat = row.category && cats ? cats[row.category] : null;
  const freqColor = freqAccent(row.freq);

  const longDescription = row.section === "macro" && row.indId
    ? (ind?.[row.indId]?.[12] || row.details || row.summary)
    : (row.details || row.summary);
  const latestData = row.section === "macro" && row.indId ? (asOf?.[row.indId] || null) : null;

  return (
    <div role="button" tabIndex={0} onClick={onToggle}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggle(); } }}
      aria-expanded={open}
      data-testid={`methodology-tile-${row.key}`}
      style={{ background: "var(--surface)", border: "1px solid var(--border)",
               borderRadius: 8, padding: "12px 14px", cursor: "pointer",
               transition: "background 120ms ease, border-color 120ms ease" }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
        {cat && <div title={cat.label}
          style={{ width: 10, height: 10, borderRadius: 2, background: cat.color, marginTop: 5, flexShrink: 0 }}/>}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 6, flexWrap: "wrap" }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", fontFamily: "var(--font-mono)" }}>
              {row.name}
            </div>
            {row.tier && (
              <span style={{ fontSize: 9, color: cat?.color || "var(--text-dim)",
                             fontFamily: "var(--font-mono)", letterSpacing: "0.08em", fontWeight: 700 }}>
                T{row.tier}
              </span>
            )}
          </div>
          {row.longName && row.longName !== row.name && (
            <div style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "var(--font-mono)", marginTop: 2 }}>
              {row.longName}
            </div>
          )}
        </div>
        <div style={{ fontSize: 14, color: "var(--text-dim)", lineHeight: 1, marginTop: 2, flexShrink: 0 }}>
          {open ? "▾" : "▸"}
        </div>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
        <Chip label={row.source} tone="neutral"/>
        <Chip label={row.freq} tone="accent" color={freqColor}/>
      </div>

      <div style={{ fontSize: 12, color: "var(--text-2)", lineHeight: 1.65, marginTop: 8 }}>
        {row.summary}
      </div>

      {open && (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px dashed var(--border)",
                      display: "flex", flexDirection: "column", gap: 8 }}>
          {row.seriesId && <Field label="Series / endpoint" value={row.seriesId} mono/>}
          {latestData && <Field label="Latest data" value={latestData} mono/>}
          {row.powers?.length > 0 && (
            <Field label="Powers" valueNode={
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: "var(--text-2)", lineHeight: 1.6 }}>
                {row.powers.map((p) => <li key={p}>{p}</li>)}
              </ul>
            }/>
          )}
          <Field label="Detail" valueNode={
            <div style={{ fontSize: 12, color: "var(--text-2)", lineHeight: 1.75 }}>
              {longDescription}
            </div>
          }/>
          {cat && <Field label="Category" value={cat.label}/>}
        </div>
      )}
    </div>
  );
}

function Chip({ label, tone, color }) {
  if (!label) return null;
  const baseColor = color || (tone === "accent" ? "var(--accent)" : "var(--text-muted)");
  return (
    <span style={{ fontSize: 10, fontFamily: "var(--font-mono)", letterSpacing: "0.04em",
                    color: baseColor, border: `1px solid ${baseColor}`, borderRadius: 3,
                    padding: "2px 6px", lineHeight: 1.45, whiteSpace: "nowrap", opacity: 0.9 }}>
      {label}
    </span>
  );
}

function Field({ label, value, valueNode, mono }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <div style={{ fontSize: 10, color: "var(--text-dim)", fontFamily: "var(--font-mono)",
                    letterSpacing: "0.08em" }}>
        {label.toUpperCase()}
      </div>
      {valueNode ? valueNode : (
        <div style={{ fontSize: 12, color: "var(--text-2)",
                      fontFamily: mono ? "var(--font-mono)" : "inherit", lineHeight: 1.6 }}>
          {value}
        </div>
      )}
    </div>
  );
}

// ─── Shared widgets ─────────────────────────────────────────────────────────
function SectionHeader({ label, sub }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 10, borderBottom: "1px solid var(--border)", paddingBottom: 6 }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text)",
                    fontFamily: "var(--font-mono)", letterSpacing: "0.08em" }}>
        {label}
      </div>
      {sub && (
        <div style={{ fontSize: 11, color: "var(--text-dim)", fontFamily: "var(--font-mono)" }}>
          · {sub}
        </div>
      )}
    </div>
  );
}

function Prose({ children }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 900,
                   fontSize: 13, color: "var(--text-2)", lineHeight: 1.75 }}>
      {children}
    </div>
  );
}

function P({ children }) {
  return <div>{children}</div>;
}

function Formula({ children }) {
  return (
    <div style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text)",
                   background: "var(--surface-2)", border: "1px solid var(--border)",
                   borderRadius: 6, padding: "10px 12px" }}>
      {children}
    </div>
  );
}

// ─── Disclaimer ─────────────────────────────────────────────────────────────
function Disclaimer() {
  return (
    <div style={{ background: "var(--surface-2)", border: "1px solid var(--border)",
                   borderRadius: 8, padding: "12px 14px" }}>
      <div style={{ fontSize: 11, color: "var(--text-dim)", fontFamily: "var(--font-mono)",
                    letterSpacing: "0.1em", marginBottom: 6 }}>
        DISCLAIMER
      </div>
      <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.75 }}>
        This dashboard is for informational and educational purposes only. It is not financial advice,
        investment advice, or a solicitation to buy or sell any security. All data is sourced from public
        databases and third-party providers and may have errors or delays. Past relationships between
        indicators and market outcomes do not guarantee future results.
      </div>
    </div>
  );
}
