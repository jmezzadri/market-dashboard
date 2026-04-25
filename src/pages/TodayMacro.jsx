/**
 * TodayMacro.jsx — Three-composite macro overview (v9 design).
 *
 * Senior Quant's drawdown-confidence backtest v2 surfaces three composites:
 *   • Risk & Liquidity     (3-mo horizon · 4 indicators · AUC 0.69)
 *   • Growth               (6-mo horizon · 3 indicators · AUC 0.66)
 *   • Inflation & Rates    (18-mo horizon · 2 indicators · AUC 0.78)
 *
 * Score formula: composite EWMA z-score × 50, clipped to ±100.
 *   z = 0  → score 0  (at long-run mean)
 *   z = ±1 → score ±50  (one standard deviation)
 *   z = ±2 → score ±100 (two-sigma extreme — pegged)
 *
 * Data source:
 *   /composite_history_daily.json  — 5,558 daily rows (2005-2026)
 *     [{ d, RL, GR, IR, SPX, DJI, NDX, SPXp, DJIp, NDXp }]
 *   /composite_weights.json        — per-composite indicator weights + AUC
 *   /composite_event_markers.json  — five historical drawdown events
 *
 * "Today" values come from the LAST row of the daily series. Live recompute
 * (FRED + UW pulls + EWMA fit on the daily refresh job) is a follow-up.
 *
 * No chart library — top + bottom panel SVG drawn by the component.
 *
 * THEMING (2026-04-24 — UAT pass for PR #110):
 * The page-scoped --tm-* tokens are MAPPED to the existing app theme tokens
 * (theme.css `var(--bg)`, `var(--surface-solid)`, `var(--text)`, etc.) so
 * the page automatically follows the user's light / dark theme toggle.
 * Semantic stress hues (calm green / elevated amber / stressed red) stay
 * literal because they carry meaning regardless of theme.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import FreshnessDot from "../components/FreshnessDot";
import { useSortableTable, SortArrow, sortableHeaderProps } from "../hooks/useSortableTable.jsx";

// ────────────────────────────────────────────────────────────────────────────
// Palette — page-scoped tokens MAPPED to app theme tokens. Each --tm-* alias
// resolves through theme.css so light/dark toggle just works. Don't hardcode
// hex values in this object — they bypass the theme system.
// ────────────────────────────────────────────────────────────────────────────
const PAGE_VARS = {
  // Surfaces — follow app theme (parchment in paper, neutral ink in dark)
  "--tm-bg":         "var(--bg)",
  "--tm-card":       "var(--surface-solid)",
  "--tm-inset":      "var(--surface-2)",
  "--tm-line":       "var(--border)",

  // Text ramp — map to app's 4-step ink ramp
  "--tm-ink-0":      "var(--text)",
  "--tm-ink-1":      "var(--text-2)",
  "--tm-ink-2":      "var(--text-muted)",
  "--tm-ink-3":      "var(--text-dim)",

  // Brand accent — parchment (paper) / parchment (dark) via app token
  "--tm-accent":     "var(--accent)",
  "--tm-accent-soft":"var(--accent-soft)",

  // Semantic stress hues — kept LITERAL (meaning is theme-invariant).
  // These read fine on both parchment and neutral-ink backgrounds.
  "--tm-calm":       "#1f9d60",
  "--tm-quiet":      "#69b585",
  "--tm-normal":     "var(--text-muted)",
  "--tm-elevated":   "#b8811c",
  "--tm-stressed":   "#d23040",

  // Soft pill backgrounds — use rgba of the semantic color so they read
  // correctly on cream AND on dark ink. Fixed-opacity tints give the same
  // visual weight in both themes.
  "--tm-calm-soft":     "rgba(31,157,96,0.14)",
  "--tm-quiet-soft":    "rgba(105,181,133,0.16)",
  "--tm-normal-soft":   "var(--surface-3)",
  "--tm-elevated-soft": "rgba(184,129,28,0.16)",
  "--tm-stressed-soft": "rgba(210,48,64,0.14)",

  // Fonts — point at the app's existing font stacks
  "--tm-fdisp":  "var(--font-display)",
  "--tm-fbody":  "var(--font-ui)",
  "--tm-fmono":  "var(--font-mono)",
};

// ────────────────────────────────────────────────────────────────────────────
// Stylesheet — injected once, scoped under .tm-page
// ────────────────────────────────────────────────────────────────────────────
const STYLES = `
.tm-page * { box-sizing: border-box; }
.tm-page { background: var(--tm-bg); color: var(--tm-ink-0); font-family: var(--tm-fbody); font-size: 14px; line-height: 1.55; padding: 8px 24px 60px; max-width: 1240px; margin: 0 auto; }

.tm-hero { padding: 18px 0 24px; border-bottom: 1px solid var(--tm-line); margin-bottom: 24px; }
.tm-eyebrow { font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--tm-ink-2); }
.tm-hero-headline { font-family: var(--tm-fdisp); font-weight: 400; font-size: 30px; line-height: 1.25; margin: 8px 0 0; max-width: 920px; color: var(--tm-ink-0); }
.tm-hero-headline em { font-style: italic; color: var(--tm-accent); }
.tm-hero-meta { display: flex; align-items: center; gap: 14px; margin-top: 14px; flex-wrap: wrap; }
.tm-quadrant-chip { display: inline-flex; align-items: center; gap: 8px; padding: 6px 14px; background: var(--tm-accent-soft); color: var(--tm-accent); border: 1px solid var(--tm-line); border-radius: 999px; font-size: 12px; font-weight: 500; cursor: help; position: relative; }
.tm-quadrant-chip .dot { width: 6px; height: 6px; border-radius: 50%; background: var(--tm-accent); }
.tm-regime-summary { display: flex; gap: 6px; align-items: center; font-size: 12.5px; color: var(--tm-ink-2); flex-wrap: wrap; }
.tm-regime-summary .pill { padding: 3px 10px; border-radius: 999px; font-weight: 500; font-size: 11.5px; cursor: help; position: relative; }

/* ── Instant-show tooltip — no native title delay, no hover transition ──
   Apple-style inline-definition tooltip used on hero pills/chips.        */
.tm-itip-host { position: relative; display: inline-flex; }
.tm-itip-host .tm-itip {
  visibility: hidden;
  opacity: 0;
  position: absolute;
  bottom: calc(100% + 8px);
  left: 50%;
  transform: translateX(-50%);
  width: 240px;
  padding: 10px 12px;
  background: var(--tm-card);
  color: var(--tm-ink-1);
  border: 1px solid var(--tm-line);
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.08);
  font-family: var(--tm-fbody);
  font-size: 12px;
  font-weight: 400;
  line-height: 1.45;
  text-align: left;
  letter-spacing: 0;
  text-transform: none;
  pointer-events: none;
  z-index: 50;
  white-space: normal;
  /* No transition on opacity/visibility — show INSTANTLY on hover. */
  transition: none;
}
.tm-itip-host:hover .tm-itip,
.tm-itip-host:focus-visible .tm-itip {
  visibility: visible;
  opacity: 1;
}

.tm-composites { display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px; margin-bottom: 28px; }
.tm-cc { background: var(--tm-card); border: 1px solid var(--tm-line); border-radius: 14px; padding: 22px 22px 20px; transition: border-color 0.15s; }
.tm-cc.is-active { border-color: var(--tm-accent); box-shadow: 0 1px 0 rgba(0,0,0,0.02); }
.tm-cc-head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 6px; gap: 12px; }
.tm-cc-name { font-family: var(--tm-fdisp); font-weight: 400; font-size: 21px; margin: 0; color: var(--tm-ink-0); }
.tm-cc-horizon { font-size: 11px; color: var(--tm-ink-3); margin-top: 3px; font-family: var(--tm-fmono); letter-spacing: 0.02em; }
.tm-tag { padding: 4px 12px; border-radius: 999px; font-size: 11px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; white-space: nowrap; }
.tm-tag.calm     { background: var(--tm-calm-soft);     color: var(--tm-calm); }
.tm-tag.quiet    { background: var(--tm-quiet-soft);    color: var(--tm-quiet); }
.tm-tag.normal   { background: var(--tm-normal-soft);   color: var(--tm-normal); }
.tm-tag.elevated { background: var(--tm-elevated-soft); color: var(--tm-elevated); }
.tm-tag.stressed { background: var(--tm-stressed-soft); color: var(--tm-stressed); }

.tm-dial-wrap { padding: 8px 0 12px; }
.tm-dial-svg { width: 100%; max-width: 240px; height: auto; display: block; margin: 0 auto; }
.tm-dial-readout { display: flex; flex-direction: column; align-items: center; margin-top: -8px; }
.tm-dial-score { font-family: var(--tm-fmono); font-size: 38px; font-weight: 500; line-height: 1; letter-spacing: -0.02em; }
.tm-dial-score.calm     { color: var(--tm-calm); }
.tm-dial-score.quiet    { color: var(--tm-quiet); }
.tm-dial-score.normal   { color: var(--tm-ink-0); }
.tm-dial-score.elevated { color: var(--tm-elevated); }
.tm-dial-score.stressed { color: var(--tm-stressed); }
.tm-dial-suffix { font-family: var(--tm-fmono); font-size: 11px; color: var(--tm-ink-3); margin-top: 3px; letter-spacing: 0.04em; }
.tm-dial-velocity { font-size: 12px; color: var(--tm-ink-2); margin-top: 8px; text-align: center; line-height: 1.45; }
.tm-dial-velocity strong { color: var(--tm-ink-0); font-weight: 500; }
.tm-arrow-up { color: var(--tm-stressed); }
.tm-arrow-down { color: var(--tm-calm); }
.tm-arrow-flat { color: var(--tm-ink-2); }

.tm-layman { background: var(--tm-inset); padding: 12px 14px; border-radius: 8px; margin-top: 14px; font-size: 13.5px; color: var(--tm-ink-1); line-height: 1.5; }
.tm-layman .prob { font-family: var(--tm-fmono); font-weight: 500; color: var(--tm-ink-0); }
.tm-layman .compare { font-style: italic; color: var(--tm-accent); }

.tm-expand-btn { display: flex; justify-content: space-between; align-items: center; width: 100%; margin-top: 14px; padding: 10px 14px; background: transparent; border: 1px solid var(--tm-line); border-radius: 8px; cursor: pointer; font-family: var(--tm-fbody); font-size: 12.5px; color: var(--tm-ink-1); transition: border-color 0.15s, background 0.15s; }
.tm-expand-btn:hover { border-color: var(--tm-accent); background: var(--tm-accent-soft); color: var(--tm-accent); }
.tm-expand-btn .chev { transition: transform 0.2s; display: inline-block; }
.tm-expand-btn.is-open .chev,
.tm-cc.is-active .tm-expand-btn .chev { transform: rotate(180deg); }

.tm-drilldown { margin-top: 16px; padding-top: 18px; border-top: 1px solid var(--tm-line); }
.tm-dd-section { margin-bottom: 20px; }
.tm-dd-section:last-child { margin-bottom: 0; }
.tm-dd-h { font-family: var(--tm-fdisp); font-weight: 400; font-size: 15px; margin: 0 0 8px; color: var(--tm-ink-0); }
.tm-dd-explain { font-size: 12.5px; color: var(--tm-ink-1); line-height: 1.55; margin: 0 0 10px; }
.tm-dd-explain code { font-family: var(--tm-fmono); font-size: 11.5px; background: var(--tm-inset); padding: 1px 5px; border-radius: 4px; color: var(--tm-ink-0); }
.tm-dd-stats { display: flex; gap: 18px; padding: 12px 14px; background: var(--tm-inset); border-radius: 8px; flex-wrap: wrap; margin-bottom: 14px; }
.tm-dd-stat .lbl { font-size: 9.5px; letter-spacing: 0.05em; text-transform: uppercase; color: var(--tm-ink-2); }
.tm-dd-stat .val { font-family: var(--tm-fmono); font-size: 13.5px; font-weight: 500; color: var(--tm-ink-0); margin-top: 2px; }

.tm-ind-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.tm-ind-table th { text-align: left; font-weight: 500; color: var(--tm-ink-2); padding: 6px 8px 6px 0; font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; border-bottom: 1px solid var(--tm-line); }
.tm-ind-table td { padding: 8px 8px 8px 0; border-bottom: 1px solid var(--tm-line); vertical-align: middle; }
.tm-ind-table tr:last-child td { border-bottom: none; }
.tm-ind-table .ind-key  { font-family: var(--tm-fmono); color: var(--tm-ink-2); font-size: 10.5px; }
.tm-ind-table .ind-name { font-weight: 500; color: var(--tm-ink-0); }
.tm-ind-table .ind-w    { font-family: var(--tm-fmono); text-align: right; color: var(--tm-accent); font-weight: 500; }
.tm-ind-table .ind-auc  { font-family: var(--tm-fmono); text-align: right; color: var(--tm-ink-2); }
.tm-ind-table th.tm-ind-th-sortable { cursor: pointer; user-select: none; transition: color 50ms; }
.tm-ind-table th.tm-ind-th-sortable:hover { color: var(--tm-ink-0); }
.tm-ind-table th.tm-ind-th-sortable[aria-sort="ascending"], .tm-ind-table th.tm-ind-th-sortable[aria-sort="descending"] { color: var(--tm-ink-0); }
.tm-tier-dot { display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: var(--tm-accent); margin-right: 8px; vertical-align: middle; }

/* ── Collapsible sections (trajectory + lead-time table) ──
   Tile-mode = compact preview row. Expanded mode reveals full content.   */
.tm-collapsible { background: var(--tm-card); border: 1px solid var(--tm-line); border-radius: 14px; margin-bottom: 22px; }
.tm-collapsible-head { display: flex; justify-content: space-between; align-items: center; gap: 16px; padding: 18px 24px; cursor: pointer; user-select: none; }
.tm-collapsible-head:hover { background: var(--tm-inset); }
.tm-collapsible-head:hover .tm-collapsible-toggle { border-color: var(--tm-accent); color: var(--tm-accent); }
.tm-collapsible.is-open .tm-collapsible-head { border-bottom: 1px solid var(--tm-line); }
.tm-collapsible-meta { flex: 1; min-width: 0; }
.tm-collapsible-title { font-family: var(--tm-fdisp); font-weight: 400; font-size: 18px; margin: 0; color: var(--tm-ink-0); }
.tm-collapsible-sub { font-size: 12.5px; color: var(--tm-ink-2); margin-top: 4px; }
.tm-collapsible-spark { display: flex; align-items: center; gap: 16px; }
.tm-collapsible-spark svg { display: block; }
.tm-collapsible-toggle { display: inline-flex; align-items: center; gap: 8px; padding: 8px 14px; background: transparent; border: 1px solid var(--tm-line); border-radius: 999px; font-family: var(--tm-fbody); font-size: 12px; font-weight: 500; color: var(--tm-ink-1); cursor: pointer; white-space: nowrap; transition: border-color 0.15s, color 0.15s; }
.tm-collapsible-toggle .chev { display: inline-block; transition: transform 0.2s; }
.tm-collapsible.is-open .tm-collapsible-toggle .chev { transform: rotate(180deg); }
.tm-collapsible-body { padding: 4px 24px 22px; }

.tm-trajectory { /* now lives inside .tm-collapsible-body — no own border */ }
.tm-traj-head { margin: 8px 0 12px; }

.tm-chart-controls { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; margin: 8px 0 14px; padding: 12px 14px; background: var(--tm-inset); border-radius: 10px; flex-wrap: wrap; }
.tm-control-label { font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--tm-ink-3); font-weight: 500; }

.tm-timeline-buttons { display: flex; gap: 4px; align-items: center; flex-wrap: wrap; }
.tm-timeline-buttons button { padding: 5px 12px; font-family: var(--tm-fbody); font-size: 12px; font-weight: 500; background: transparent; color: var(--tm-ink-2); border: 1px solid var(--tm-line); border-radius: 6px; cursor: pointer; transition: all 0.15s; }
.tm-timeline-buttons button:hover { background: var(--tm-card); color: var(--tm-ink-0); }
.tm-timeline-buttons button.is-active { background: var(--tm-accent); color: var(--tm-card); border-color: var(--tm-accent); }

.tm-date-controls { display: flex; align-items: center; gap: 6px; padding: 0 8px; border-left: 1px solid var(--tm-line); border-right: 1px solid var(--tm-line); flex-wrap: wrap; }
.tm-date-controls input[type="date"] { padding: 4px 7px; font-family: var(--tm-fmono); font-size: 11.5px; border: 1px solid var(--tm-line); border-radius: 5px; background: var(--tm-card); color: var(--tm-ink-0); }
.tm-date-controls input[type="date"]:focus { outline: 1px solid var(--tm-accent); border-color: var(--tm-accent); }
.tm-apply-btn { padding: 5px 13px; font-family: var(--tm-fbody); font-size: 12px; font-weight: 500; background: var(--tm-accent); color: var(--tm-card); border: 1px solid var(--tm-accent); border-radius: 5px; cursor: pointer; }
.tm-apply-btn:hover { opacity: 0.85; }

.tm-markers-toggle { padding: 0 8px; }
.tm-toggle { display: inline-flex; align-items: center; gap: 6px; cursor: pointer; font-size: 12px; color: var(--tm-ink-1); user-select: none; }
.tm-toggle input { margin: 0; cursor: pointer; }
.tm-toggle .swatch { display: inline-block; width: 14px; height: 2px; vertical-align: middle; }

.tm-series-toggles { display: flex; gap: 18px; flex-wrap: wrap; }
.tm-toggle-group { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }

.tm-chart-container { position: relative; width: 100%; }
.tm-chart-svg { width: 100%; height: auto; display: block; }

.tm-tooltip { position: absolute; background: var(--tm-card); border: 1px solid var(--tm-line); border-radius: 8px; padding: 10px 13px; font-size: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.10); pointer-events: none; opacity: 0; transition: opacity 0.1s; min-width: 240px; z-index: 10; }
.tm-tooltip .tt-date { font-family: var(--tm-fmono); font-size: 11px; color: var(--tm-ink-2); margin-bottom: 6px; padding-bottom: 6px; border-bottom: 1px solid var(--tm-line); }
.tm-tooltip .tt-row { display: flex; justify-content: space-between; align-items: center; gap: 14px; padding: 3px 0; font-size: 12px; }
.tm-tooltip .tt-row .tt-label { display: flex; align-items: center; gap: 6px; color: var(--tm-ink-1); }
.tm-tooltip .tt-row .tt-label .swatch { display: inline-block; width: 10px; height: 2px; }
.tm-tooltip .tt-row .tt-val { font-family: var(--tm-fmono); font-weight: 500; color: var(--tm-ink-0); white-space: nowrap; }
.tm-tooltip .tt-section { font-size: 9.5px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--tm-ink-3); margin: 6px 0 2px; padding-top: 4px; border-top: 1px dashed var(--tm-line); }

.tm-event-marker-line { stroke: var(--tm-stressed); stroke-width: 1; stroke-dasharray: 3 3; opacity: 0.5; }
.tm-event-marker-line.spx { stroke: #2862c2; }
.tm-event-marker-label { font-family: var(--tm-fbody); font-size: 9.5px; font-weight: 500; fill: var(--tm-ink-1); }

.tm-lt-sub { font-size: 13px; color: var(--tm-ink-2); margin-bottom: 14px; }
.tm-lead-time-table-el { width: 100%; border-collapse: collapse; font-size: 12.5px; margin-top: 10px; }
.tm-lead-time-table-el th { text-align: left; font-weight: 500; color: var(--tm-ink-2); padding: 8px 12px 8px 0; font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.06em; border-bottom: 1px solid var(--tm-line); }
.tm-lead-time-table-el td { padding: 9px 12px 9px 0; border-bottom: 1px solid var(--tm-line); font-family: var(--tm-fmono); }
.tm-lead-time-table-el td.label { font-family: var(--tm-fbody); }
.tm-lead-time-table-el td.lead-good { color: var(--tm-calm); font-weight: 500; }
.tm-lead-time-table-el td.lead-bad { color: var(--tm-stressed); font-weight: 500; }
.tm-lead-time-table-el td.lead-coincident { color: var(--tm-ink-2); }
.tm-lead-time-table-el td.detail { color: var(--tm-ink-2); font-size: 11.5px; }
.tm-lead-time-table-el th.detail { color: var(--tm-ink-3); font-size: 9.5px; }
.tm-honest-read { font-size: 13px; color: var(--tm-ink-1); margin-top: 14px; line-height: 1.6; }

.tm-foot { background: var(--tm-card); border: 1px solid var(--tm-line); border-radius: 12px; padding: 16px 22px; font-size: 12px; color: var(--tm-ink-2); display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; }
.tm-foot a { color: var(--tm-accent); text-decoration: none; border-bottom: 1px solid currentColor; cursor: pointer; }

.tm-loading { padding: 48px 24px; text-align: center; color: var(--tm-ink-2); font-family: var(--tm-fmono); font-size: 13px; }

@media (max-width: 1100px) { .tm-composites { grid-template-columns: 1fr; } }
@media (max-width: 720px) {
  .tm-page { padding: 8px 14px 40px; }
  .tm-hero-headline { font-size: 24px; }
  .tm-chart-controls { padding: 10px 12px; }
  .tm-collapsible-head { padding: 14px 16px; flex-wrap: wrap; }
  .tm-collapsible-body { padding: 4px 16px 18px; }
}
`;

const COMPOSITES = [
  {
    key: "RL",
    name: "Risk & Liquidity",
    horizonLabel: "Forward 3 months · 10%+ drawdown",
    horizonMonths: 3,
    drawdownPct: 10,
    color: "#17181c",
    baseline: 0.21,
    weightsKey: "Risk & Liquidity",
  },
  {
    key: "GR",
    name: "Growth",
    horizonLabel: "Forward 6 months · 15%+ drawdown",
    horizonMonths: 6,
    drawdownPct: 15,
    color: "#6b6f78",
    baseline: 0.22,
    weightsKey: "Growth",
  },
  {
    key: "IR",
    name: "Inflation & Rates",
    horizonLabel: "Forward 18 months · 20%+ drawdown",
    horizonMonths: 18,
    drawdownPct: 20,
    color: "#9d3545",
    baseline: 0.28,
    weightsKey: "Inflation & Rates",
  },
];

// Lead-time event-study rows. Each row carries BOTH the reader-facing summary
// columns (composite that turned first / lead time / max S&P drawdown) and the
// underlying detail columns ("show your work" — +30 cross date, S&P -15% date,
// lead at +30, lead at composite>0). The summary columns come straight from
// Joe's mockup screenshot; detail columns are computed from the daily series.
const LEAD_TIME_ROWS = [
  {
    event: "GFC",
    summaryComp: "Risk & Liquidity",
    summaryLead: "≈9 months",
    summaryDD:   "−52.6%",
    comp: "Risk & Liquidity",  cross: "2007-03-02", spx: "2008-01-18",
    lead30:   { label: "+46 weeks",            cls: "lead-good" },
    leadZero: { label: "+46 weeks",            cls: "lead-good" },
  },
  {
    event: "2011 EU crisis",
    summaryComp: "Risk & Liquidity + Inflation & Rates",
    summaryLead: "≈3 months",
    summaryDD:   "−18%",
    comp: "Risk & Liquidity",  cross: "2011-09-30", spx: "2011-04-08",
    lead30:   { label: "−25 weeks (lagged)",   cls: "lead-bad"  },
    leadZero: { label: "−17 weeks",            cls: "lead-bad"  },
  },
  {
    event: "2018 Q4",
    summaryComp: "Risk & Liquidity",
    summaryLead: "≈4 months",
    summaryDD:   "−14.0%",
    comp: "Risk & Liquidity",  cross: "2018-12-17", spx: "2018-12-20",
    lead30:   { label: "+0.4 weeks (coincident)", cls: "lead-coincident" },
    leadZero: { label: "+45 weeks",            cls: "lead-good" },
  },
  {
    event: "COVID",
    summaryComp: "none — exogenous shock",
    summaryLead: "0 (coincident)",
    summaryDD:   "−20.0%",
    comp: "Risk & Liquidity",  cross: "2020-02-28", spx: "2020-03-09",
    lead30:   { label: "+1.4 weeks (coincident)", cls: "lead-coincident" },
    leadZero: { label: "+27 weeks",            cls: "lead-good" },
  },
  {
    event: "2022 hike cycle",
    summaryComp: "Inflation & Rates",
    summaryLead: "≈6 months",
    summaryDD:   "−24.8%",
    comp: "Inflation & Rates", cross: "2021-11-01", spx: "2022-05-09",
    lead30:   { label: "+27 weeks",            cls: "lead-good" },
    leadZero: { label: "+46 weeks",            cls: "lead-good" },
  },
];

const SERIES_META = {
  RL:  { name: "Risk & Liquidity",   color: "#17181c", panel: "top",    suffix: "",  priceKey: null   },
  GR:  { name: "Growth",             color: "#6b6f78", panel: "top",    suffix: "",  priceKey: null   },
  IR:  { name: "Inflation & Rates",  color: "#9d3545", panel: "top",    suffix: "",  priceKey: null   },
  SPX: { name: "S&P 500",            color: "#2862c2", panel: "bottom", suffix: "%", priceKey: "SPXp" },
  DJI: { name: "Dow",                color: "#1f9d60", panel: "bottom", suffix: "%", priceKey: "DJIp" },
  NDX: { name: "NASDAQ",             color: "#b8811c", panel: "bottom", suffix: "%", priceKey: "NDXp" },
};

const TIMELINE_DAYS = { "1": 252, "2": 504, "5": 1260, "10": 2520, max: null };
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

const LAYOUT = {
  marginLeft: 60, marginRight: 20, marginTop: 20, marginBottom: 60,
  topPanel:    { y0: 20,  y1: 200, yMin: -100, yMax: 100 },
  bottomPanel: { y0: 260, y1: 460, yMin: -60,  yMax: 0   },
  width: 1100, height: 520,
};

// ── Hero pill tooltip copy. TODO: parameterize when regime computation is
// wired live — today's read is Normal across all three composites, so we
// hardcode the Normal-state text. When the regime can flip elsewhere, swap
// these strings on the live regime label.
const HERO_TOOLTIPS = {
  quadrantGoldilocks:
    "The Bridgewater All-Weather framework places today in the Goldilocks " +
    "quadrant — growth is firm and inflation is cooling. Historically a " +
    "favorable equity environment.",
  rlNormal:
    "Risk & Liquidity composite reads Normal — financial-conditions stress, " +
    "equity volatility, and credit spreads are sitting near their long-run " +
    "averages.",
  growthNormal:
    "Growth composite reads Normal — real-economy momentum (jobless claims, " +
    "broad activity, bank-equity ratio) is at trend.",
  inflationRatesNormal:
    "Inflation & Rates composite reads Normal — Treasury volatility and " +
    "money-supply growth are sitting near their long-run averages.",
};

function regimeForScore(s) {
  if (s == null || Number.isNaN(s)) return "normal";
  if (s <= -50) return "calm";
  if (s <= -20) return "quiet";
  if (s <  +20) return "normal";
  if (s <  +50) return "elevated";
  return "stressed";
}
function regimeLabel(c) {
  return { calm: "Calm", quiet: "Quiet", normal: "Normal", elevated: "Elevated", stressed: "Stressed" }[c] || "Normal";
}

function probFromZ(z, baseline) {
  if (z == null || Number.isNaN(z)) return baseline;
  const p0 = Math.max(0.02, Math.min(0.98, baseline));
  const logit0 = Math.log(p0 / (1 - p0));
  const slope = 0.7;
  const logit = logit0 + slope * z;
  const p = 1 / (1 + Math.exp(-logit));
  return Math.max(0.01, Math.min(0.99, p));
}

function fmtSigned(n, digits = 0) {
  if (n == null || Number.isNaN(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return sign + n.toFixed(digits);
}

function fmtPrice(v) {
  if (v == null) return "—";
  return v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function findRowByOffset(rows, fromIdx, monthsBack) {
  const targetIdx = Math.max(0, fromIdx - monthsBack * 21);
  return rows[targetIdx] || rows[0];
}

function DialGauge({ score }) {
  const cx = 120, cy = 125, R = 92, innerR = 78;
  const clamped = Math.max(-100, Math.min(100, score == null ? 0 : score));
  const scoreToRad = (s) => ((180 - (s + 100) * 0.9) * Math.PI) / 180;
  const pointOnArc = (s, r) => {
    const a = scoreToRad(s);
    return [cx + r * Math.cos(a), cy - r * Math.sin(a)];
  };
  const zones = [
    [-100, -50, "#1f9d60"],
    [ -50, -20, "#69b585"],
    [ -20,  20, "#9a9ea8"],
    [  20,  50, "#b8811c"],
    [  50, 100, "#d23040"],
  ];
  const arcs = zones.map(([s0, s1, color], i) => {
    const [x1, y1] = pointOnArc(s0, R);
    const [x2, y2] = pointOnArc(s1, R);
    return (
      <path key={i}
        d={"M " + x1.toFixed(2) + " " + y1.toFixed(2) + " A " + R + " " + R + " 0 0 1 " + x2.toFixed(2) + " " + y2.toFixed(2)}
        stroke={color} strokeWidth="13" fill="none" strokeLinecap="butt"/>
    );
  });
  const ticks = [-100, -50, 0, 50, 100].map((s) => {
    const [xo, yo] = pointOnArc(s, R + 9);
    const [xi, yi] = pointOnArc(s, R - 12);
    let [xl, yl] = pointOnArc(s, R + 18);
    let anchor = "middle";
    if (s === -100) { anchor = "start"; xl -= 2; }
    else if (s === 100) { anchor = "end"; xl += 2; }
    return (
      <g key={s}>
        <line x1={xi.toFixed(1)} y1={yi.toFixed(1)} x2={xo.toFixed(1)} y2={yo.toFixed(1)} stroke="currentColor" strokeWidth="0.8" opacity="0.5"/>
        <text x={xl.toFixed(1)} y={(yl + 3).toFixed(1)} textAnchor={anchor} fontFamily="JetBrains Mono" fontSize="9" fill="currentColor" opacity="0.55">
          {(s > 0 ? "+" : "") + s}
        </text>
      </g>
    );
  });
  const zoneLabels = [
    [-75, "CALM",     "#1f9d60"],
    [-35, "QUIET",    "#69b585"],
    [  0, "NORMAL",   "currentColor"],
    [ 35, "ELEVATED", "#b8811c"],
    [ 75, "STRESSED", "#d23040"],
  ].map(([s, label, color]) => {
    const [xl, yl] = pointOnArc(s, R - 26);
    return (
      <text key={label} x={xl.toFixed(1)} y={yl.toFixed(1)} textAnchor="middle"
            fontFamily="Inter" fontSize="7.5" fontWeight="500" letterSpacing="0.06em"
            fill={color} opacity={color === "currentColor" ? 0.55 : 1}>
        {label}
      </text>
    );
  });
  const [tipX, tipY] = pointOnArc(clamped, innerR);
  // Needle + center hub use currentColor → inherits .tm-dial-svg color, which
  // we pin to var(--tm-ink-0). Auto-flips with theme.
  return (
    <svg className="tm-dial-svg" viewBox="0 0 240 145" preserveAspectRatio="xMidYMid meet"
         style={{ color: "var(--tm-ink-0)" }}>
      {arcs}
      {ticks}
      {zoneLabels}
      <line x1={cx} y1={cy} x2={tipX.toFixed(2)} y2={tipY.toFixed(2)} stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
      <circle cx={cx} cy={cy} r="6" fill="currentColor"/>
      <circle cx={tipX.toFixed(2)} cy={tipY.toFixed(2)} r="3.5" fill="currentColor" stroke="var(--tm-card)" strokeWidth="1.5"/>
    </svg>
  );
}

// IndicatorContributionTable — drilldown row of an expanded composite tile.
// Click any column header to sort. Default sort: Weight desc (largest
// contributors first, matching how the data lands from the weights JSON).
//
// Council: Lead Developer led; UX Designer signed off on header
// affordance (cursor, hover, ▲/▼/↕ arrow placement); Senior Quant signed
// off on AUC/Weight numeric ordering — sorting by AUC desc surfaces the
// strongest discriminators in this composite, sorting by Weight desc
// surfaces the indicators carrying the most influence on today's score.
function IndicatorContributionTable({ indicators, indicatorAsOfIso, indicatorFreq }) {
  const columns = useMemo(() => ([
    { id: "name", label: "Indicator", align: "left",  sortValue: (r) => r.name },
    { id: "auc",  label: "AUC",       align: "right", sortValue: (r) => (r.auc == null ? null : r.auc) },
    { id: "w",    label: "Weight",    align: "right", sortValue: (r) => (r.weight == null ? null : r.weight) },
  ]), []);
  const { sorted, sortCol, sortDir, toggleSort } = useSortableTable({
    rows: indicators,
    columns,
    defaultColId: "w",
    defaultDir: "desc",
  });
  const headerCls = "tm-ind-th-sortable";
  return (
    <table className="tm-ind-table">
      <thead>
        <tr>
          <th className={headerCls} {...sortableHeaderProps({ colId: "name", sortCol, sortDir, toggleSort })}>
            Indicator <SortArrow dir={sortCol === "name" ? sortDir : null}/>
          </th>
          <th className={"ind-auc " + headerCls} {...sortableHeaderProps({ colId: "auc", sortCol, sortDir, toggleSort })}>
            AUC <SortArrow dir={sortCol === "auc" ? sortDir : null}/>
          </th>
          <th className={"ind-w " + headerCls} {...sortableHeaderProps({ colId: "w", sortCol, sortDir, toggleSort })}>
            Weight <SortArrow dir={sortCol === "w" ? sortDir : null}/>
          </th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((ind) => (
          <tr key={ind.key}>
            <td>
              <span className="tm-tier-dot"/>
              <span className="ind-name">{ind.name}</span>{" "}
              <span className="ind-key">({ind.key})</span>{" "}
              <FreshnessDot indicatorId={ind.key} size={5} asOfIso={indicatorAsOfIso&&indicatorAsOfIso[ind.key]} cadence={indicatorFreq&&indicatorFreq[ind.key]}/>
            </td>
            <td className="ind-auc">{ind.auc != null ? ind.auc.toFixed(2) : "—"}</td>
            <td className="ind-w">{(ind.weight * 100).toFixed(1)}%</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function CompositeTile({ comp, score, prevScore, weightsBlock, asOfIso, indicatorAsOfIso, indicatorFreq }) {
  const [open, setOpen] = useState(false);
  const regime = regimeForScore(score);
  const regimeText = regimeLabel(regime);
  const z = score == null ? null : score / 50;
  const prob = z == null ? comp.baseline : probFromZ(z, comp.baseline);
  const baseline = comp.baseline;
  const delta = (score != null && prevScore != null) ? Math.round(score - prevScore) : null;
  let arrowEl, velocityVerb;
  if (delta == null) { arrowEl = <span className="tm-arrow-flat">{"→"}</span>; velocityVerb = "no prior reading"; }
  else if (delta >= 1) { arrowEl = <span className="tm-arrow-up">{"↗"}</span>; velocityVerb = "rising"; }
  else if (delta <= -1) { arrowEl = <span className="tm-arrow-down">{"▼"}</span>; velocityVerb = "falling"; }
  else { arrowEl = <span className="tm-arrow-flat">{"→"}</span>; velocityVerb = "flat"; }
  const indicators = (weightsBlock && weightsBlock.indicators) || [];
  const auc = weightsBlock && weightsBlock.composite_auc;
  const lead = weightsBlock && weightsBlock.composite_lead_months;
  const probPct = Math.round(prob * 100);
  const baselinePct = Math.round(baseline * 100);

  return (
    <div className={"tm-cc" + (open ? " is-active" : "")}>
      <div className="tm-cc-head">
        <div>
          <h2 className="tm-cc-name" style={{display:"inline-flex",alignItems:"center",gap:8}}>
            {comp.name}
            {/* RAG dot for the composite's underlying daily series. Click → /#readme freshness section. */}
            <FreshnessDot indicatorId={`composite_${comp.key.toLowerCase()}`} size={7} asOfIso={asOfIso} cadence="D"/>
          </h2>
          <div className="tm-cc-horizon">{comp.horizonLabel}</div>
        </div>
        <span className={"tm-tag " + regime}>{regimeText}</span>
      </div>

      <div className="tm-dial-wrap">
        <DialGauge score={score == null ? 0 : Math.round(score)}/>
        <div className="tm-dial-readout">
          <div className={"tm-dial-score " + regime}>
            {score == null ? "—" : (score > 0 ? "+" : "") + Math.round(score)}
          </div>
          <div className="tm-dial-suffix">SCORE / ±100 · {regimeText.toUpperCase()}</div>
        </div>
        <div className="tm-dial-velocity">
          {arrowEl}{" "}
          <strong>
            {delta == null
              ? "Velocity unavailable"
              : fmtSigned(delta) + " over the last 4 months — " + velocityVerb + "."}
          </strong>
        </div>
      </div>

      <div className="tm-layman">
        Risk of a {comp.drawdownPct}%+ S&amp;P drawdown over the next {comp.horizonMonths} months is{" "}
        <span className="prob">{probPct}%</span> — vs.{" "}
        <span className="compare">the {baselinePct}% historical baseline.</span>
      </div>

      <button className="tm-expand-btn" onClick={() => setOpen((v) => !v)}>
        <span>Show the math · {indicators.length} indicators · AUC {auc ? auc.toFixed(2) : "—"}</span>
        <span className="chev">▾</span>
      </button>

      {open && (
        <div className="tm-drilldown">
          <div className="tm-dd-section">
            <h4 className="tm-dd-h">How the score is built</h4>
            <p className="tm-dd-explain">
              Each indicator is converted to an EWMA z-score with an 18-month half-life, so recent
              observations carry more weight. The composite z is the AUC-weighted average across
              the {indicators.length} surviving indicators.{" "}
              <strong>Score = composite z × 50</strong>, clipped to ±100 — so 0 means
              today's reading sits at the long-run mean, ±50 means one standard deviation from
              it, ±100 means a two-sigma extreme. The drawdown probability shown above comes
              from running today's composite z through the same logistic regression that was fit on
              21 years of data, evaluated for the {comp.horizonMonths}-month forward {comp.drawdownPct}%+ drawdown event.
            </p>
          </div>

          <div className="tm-dd-stats">
            <div className="tm-dd-stat"><div className="lbl">Composite z</div><div className="val">{z == null ? "—" : (z >= 0 ? "+" : "") + z.toFixed(2)}</div></div>
            <div className="tm-dd-stat"><div className="lbl">Drawdown probability</div><div className="val">{probPct}%</div></div>
            <div className="tm-dd-stat"><div className="lbl">Historical baseline</div><div className="val">{baselinePct}%</div></div>
            <div className="tm-dd-stat"><div className="lbl">Composite AUC</div><div className="val">{auc ? auc.toFixed(2) : "—"}</div></div>
            <div className="tm-dd-stat"><div className="lbl">Lead time when warns</div><div className="val">{lead == null ? "—" : lead.toFixed(1) + " mo"}</div></div>
          </div>

          <div className="tm-dd-section">
            <h4 className="tm-dd-h">Indicator contributions</h4>
            <IndicatorContributionTable
              indicators={indicators}
              indicatorAsOfIso={indicatorAsOfIso}
              indicatorFreq={indicatorFreq}
            />
            <p className="tm-dd-explain" style={{ marginTop: 10, fontSize: 12, color: "var(--tm-ink-2)" }}>
              The remaining {comp.name} indicators stay visible on the All Indicators tab — they
              didn't clear the drawdown-prediction threshold but are still useful as standalone
              gauges, with a "composite contribution" badge showing where they sit.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Mini sparkline preview shown in the collapsed trajectory tile head.
//    Single composite line, last ~2y of daily data, no axes — just shape.
function MiniSpark({ data }) {
  if (!data || data.length < 2) return null;
  const slice = data.slice(-Math.min(504, data.length)); // ~2y trading days
  const w = 140, h = 36;
  const vals = slice.map((r) => (r.RL == null ? 0 : r.RL));
  const min = Math.min(...vals), max = Math.max(...vals);
  const span = (max - min) || 1;
  const pts = vals.map((v, i) => {
    const x = (i / (vals.length - 1)) * (w - 2) + 1;
    const y = h - 1 - ((v - min) / span) * (h - 2);
    return x.toFixed(1) + "," + y.toFixed(1);
  }).join(" ");
  return (
    <svg width={w} height={h} viewBox={"0 0 " + w + " " + h} aria-hidden="true">
      <polyline points={pts} fill="none" stroke="var(--tm-accent)" strokeWidth="1.2"
                strokeLinejoin="round" strokeLinecap="round" opacity="0.85"/>
    </svg>
  );
}

function TrajectoryChart({ data, eventMarkers }) {
  const [timeline, setTimeline] = useState("max");
  const [mode, setMode] = useState("preset");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [showMarkers, setShowMarkers] = useState(false);
  const [visible, setVisible] = useState({ RL: true, GR: true, IR: true, SPX: true, DJI: true, NDX: true });
  const [hover, setHover] = useState(null);
  const containerRef = useRef(null);
  const svgRef = useRef(null);

  const filtered = useMemo(() => {
    if (mode === "custom" && fromDate && toDate) {
      return data.filter((r) => r.d >= fromDate && r.d <= toDate);
    }
    if (timeline === "max") return data;
    return data.slice(-TIMELINE_DAYS[timeline]);
  }, [data, mode, timeline, fromDate, toDate]);

  const n = filtered.length;
  const xRange = LAYOUT.width - LAYOUT.marginLeft - LAYOUT.marginRight;

  const xFor = (idx) => LAYOUT.marginLeft + (xRange * idx) / Math.max(1, n - 1);
  const yForTop = (s) => {
    const p = LAYOUT.topPanel;
    return p.y0 + ((p.yMax - s) / (p.yMax - p.yMin)) * (p.y1 - p.y0);
  };
  const yForBottom = (dd) => {
    const p = LAYOUT.bottomPanel;
    return p.y0 + ((p.yMax - dd) / (p.yMax - p.yMin)) * (p.y1 - p.y0);
  };

  const polylines = useMemo(() => {
    if (n === 0) return [];
    const out = [];
    Object.keys(SERIES_META).forEach((key) => {
      if (!visible[key]) return;
      const meta = SERIES_META[key];
      const yFn = meta.panel === "top" ? yForTop : yForBottom;
      const pts = [];
      for (let i = 0; i < n; i++) {
        const v = filtered[i][key];
        if (v == null) continue;
        pts.push(xFor(i).toFixed(1) + "," + yFn(v).toFixed(1));
      }
      if (pts.length >= 2) {
        out.push({ key, color: meta.color, points: pts.join(" ") });
      }
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, visible, n]);

  const xTicks = useMemo(() => {
    if (n === 0) return [];
    const tickCount = 7;
    const ticks = [];
    const span = (new Date(filtered[n - 1].d) - new Date(filtered[0].d)) / (1000 * 60 * 60 * 24 * 365.25);
    for (let i = 0; i < tickCount; i++) {
      const idx = Math.floor((i * (n - 1)) / (tickCount - 1));
      const d = filtered[idx].d;
      const parts = d.split("-");
      const yr = parts[0]; const mo = parts[1];
      let label;
      if (span < 1.5) label = MONTHS[parseInt(mo, 10) - 1] + " '" + yr.slice(2);
      else if (span < 6) label = MONTHS[parseInt(mo, 10) - 1] + " " + yr;
      else label = yr;
      ticks.push({ idx, label });
    }
    return ticks;
  }, [filtered, n]);

  const visibleMarkers = useMemo(() => {
    if (!showMarkers || n === 0) return [];
    const findIdx = (date) => {
      for (let i = 0; i < n; i++) if (filtered[i].d >= date) return i;
      return -1;
    };
    return eventMarkers.map((m) => Object.assign({}, m, {
      compIdx: findIdx(m.cross_date),
      spxIdx: findIdx(m.spx_breakdown_date),
    })).filter((m) => m.compIdx >= 0 || m.spxIdx >= 0);
  }, [eventMarkers, filtered, n, showMarkers]);

  const onMouseMove = (evt) => {
    if (n === 0) return;
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const xRatio = (evt.clientX - rect.left) / rect.width;
    const xVB = xRatio * LAYOUT.width;
    const idxFrac = ((xVB - LAYOUT.marginLeft) / xRange) * (n - 1);
    const idx = Math.max(0, Math.min(n - 1, Math.round(idxFrac)));
    setHover({ idx, clientX: evt.clientX, clientY: evt.clientY });
  };
  const onMouseLeave = () => setHover(null);

  const handleApplyDates = () => {
    if (!fromDate || !toDate) { window.alert("Pick both From and To dates"); return; }
    if (fromDate >= toDate) { window.alert("From must be before To"); return; }
    setMode("custom");
    setTimeline("");
  };

  let tt = null;
  if (hover && filtered[hover.idx]) {
    const d = filtered[hover.idx];
    const dParts = d.d.split("-");
    const dateLabel = MONTHS[parseInt(dParts[1], 10) - 1] + " " + parseInt(dParts[2], 10) + ", " + dParts[0];
    const topVisible = ["RL","GR","IR"].filter((k) => visible[k] && d[k] != null);
    const bottomVisible = ["SPX","DJI","NDX"].filter((k) => visible[k] && d[k] != null);
    const cr = containerRef.current && containerRef.current.getBoundingClientRect();
    let leftPx = cr ? hover.clientX - cr.left + 14 : 0;
    let topPx = cr ? hover.clientY - cr.top - 10 : 0;
    if (cr) {
      const ttW = 280; const ttH = 40 + (topVisible.length + bottomVisible.length) * 22;
      if (leftPx + ttW > cr.width - 10) leftPx = hover.clientX - cr.left - ttW - 14;
      if (topPx + ttH > cr.height) topPx = cr.height - ttH - 10;
      if (topPx < 0) topPx = 0;
    }
    tt = (
      <div className="tm-tooltip" style={{ opacity: 1, left: leftPx, top: topPx }}>
        <div className="tt-date">{dateLabel}</div>
        {topVisible.length > 0 && (
          <>
            <div className="tt-section">Composite scores</div>
            {topVisible.map((k) => {
              const m = SERIES_META[k]; const v = d[k];
              return (
                <div key={k} className="tt-row">
                  <span className="tt-label"><span className="swatch" style={{ background: m.color }}/>{m.name}</span>
                  <span className="tt-val">{(v > 0 ? "+" : "") + v.toFixed(1)}</span>
                </div>
              );
            })}
          </>
        )}
        {bottomVisible.length > 0 && (
          <>
            <div className="tt-section">Equity index — level &amp; drawdown</div>
            {bottomVisible.map((k) => {
              const m = SERIES_META[k]; const v = d[k];
              const price = m.priceKey ? d[m.priceKey] : null;
              return (
                <div key={k} className="tt-row">
                  <span className="tt-label"><span className="swatch" style={{ background: m.color }}/>{m.name}</span>
                  <span className="tt-val">
                    {fmtPrice(price)}
                    <span style={{ color: "var(--tm-ink-3)", marginLeft: 8 }}>{v.toFixed(2)}%</span>
                  </span>
                </div>
              );
            })}
          </>
        )}
      </div>
    );
  }

  return (
    <div className="tm-trajectory">
      <div className="tm-traj-head">
        <div className="tm-collapsible-sub" style={{ marginTop: 0, maxWidth: 720 }}>
          Top: composite scores (z × 50, ±100). Bottom: S&amp;P 500, Dow, NASDAQ
          drawdowns from running peak. Composites lead, drawdowns follow. Hover for values; toggle
          series; pick a window.
        </div>
      </div>

      <div className="tm-chart-controls">
        <div className="tm-timeline-buttons">
          <span className="tm-control-label" style={{ marginRight: 6 }}>QUICK</span>
          {["1","2","5","10","max"].map((y) => (
            <button key={y}
              className={mode === "preset" && timeline === y ? "is-active" : ""}
              onClick={() => { setMode("preset"); setTimeline(y); setFromDate(""); setToDate(""); }}
            >{y === "max" ? "Max" : (y + "Y")}</button>
          ))}
        </div>

        <div className="tm-date-controls">
          <span className="tm-control-label">CUSTOM RANGE</span>
          <input type="date" value={fromDate} min="2005-01-03" max="2026-04-22" onChange={(e) => setFromDate(e.target.value)}/>
          <span style={{ color: "var(--tm-ink-3)", fontSize: 12 }}>to</span>
          <input type="date" value={toDate} min="2005-01-03" max="2026-04-22" onChange={(e) => setToDate(e.target.value)}/>
          <button className="tm-apply-btn" onClick={handleApplyDates}>Apply</button>
        </div>

        <div className="tm-markers-toggle">
          <label className="tm-toggle">
            <input type="checkbox" checked={showMarkers} onChange={(e) => setShowMarkers(e.target.checked)}/>
            <span>Show event markers</span>
          </label>
        </div>

        <div className="tm-series-toggles">
          <div className="tm-toggle-group">
            <span className="tm-control-label">COMPOSITES</span>
            {["RL","GR","IR"].map((k) => (
              <label key={k} className="tm-toggle">
                <input type="checkbox" checked={visible[k]} onChange={(e) => setVisible((v) => Object.assign({}, v, { [k]: e.target.checked }))}/>
                <span className="swatch" style={{ background: SERIES_META[k].color }}/>{SERIES_META[k].name}
              </label>
            ))}
          </div>
          <div className="tm-toggle-group">
            <span className="tm-control-label">EQUITY DRAWDOWNS</span>
            {["SPX","DJI","NDX"].map((k) => (
              <label key={k} className="tm-toggle">
                <input type="checkbox" checked={visible[k]} onChange={(e) => setVisible((v) => Object.assign({}, v, { [k]: e.target.checked }))}/>
                <span className="swatch" style={{ background: SERIES_META[k].color }}/>{SERIES_META[k].name}
              </label>
            ))}
          </div>
        </div>
      </div>

      <div className="tm-chart-container" ref={containerRef}>
        <svg ref={svgRef} className="tm-chart-svg" viewBox={"0 0 " + LAYOUT.width + " " + LAYOUT.height}
             preserveAspectRatio="none"
             onMouseMove={onMouseMove} onMouseLeave={onMouseLeave}
             style={{ height: 520, cursor: "crosshair", color: "var(--tm-ink-3)" }}>
          {[-100,-50,0,50,100].map((v) => {
            const y = yForTop(v); const isZero = v === 0;
            return (
              <g key={"top-" + v}>
                <line x1={LAYOUT.marginLeft} y1={y} x2={LAYOUT.width - LAYOUT.marginRight} y2={y}
                      stroke="currentColor" strokeWidth={isZero ? 0.8 : 0.5}
                      strokeDasharray={isZero ? "3 3" : undefined}
                      opacity={isZero ? 0.6 : 0.35}/>
                <text x={LAYOUT.marginLeft - 8} y={y + 3} textAnchor="end" fontFamily="JetBrains Mono" fontSize="9.5" fill="currentColor">
                  {v > 0 ? "+" + v : v}
                </text>
              </g>
            );
          })}
          <text x={LAYOUT.marginLeft} y="14" fontFamily="Inter" fontSize="10" fill="var(--tm-ink-2)" fontWeight="500">COMPOSITE SCORE (LEAD)</text>

          {[0,-15,-30,-45,-60].map((v) => {
            const y = yForBottom(v);
            return (
              <g key={"bot-" + v}>
                <line x1={LAYOUT.marginLeft} y1={y} x2={LAYOUT.width - LAYOUT.marginRight} y2={y}
                      stroke="currentColor" strokeWidth={v === 0 ? 0.8 : 0.5}
                      opacity={v === 0 ? 0.6 : 0.35}/>
                <text x={LAYOUT.marginLeft - 8} y={y + 3} textAnchor="end" fontFamily="JetBrains Mono" fontSize="9.5" fill="currentColor">
                  {v}%
                </text>
              </g>
            );
          })}
          <text x={LAYOUT.marginLeft} y="254" fontFamily="Inter" fontSize="10" fill="var(--tm-ink-2)" fontWeight="500">EQUITY DRAWDOWN FROM RUNNING PEAK (FOLLOW)</text>

          {xTicks.map((t, i) => {
            const x = xFor(t.idx);
            return (
              <g key={"x-" + i}>
                <text x={x} y="240" fontFamily="JetBrains Mono" fontSize="9.5" fill="currentColor" textAnchor="middle">{t.label}</text>
                <text x={x} y="478" fontFamily="JetBrains Mono" fontSize="9.5" fill="currentColor" textAnchor="middle">{t.label}</text>
              </g>
            );
          })}

          {visibleMarkers.map((m, i) => (
            <g key={"mk-" + i}>
              {m.compIdx >= 0 && (
                <>
                  <line className="tm-event-marker-line" x1={xFor(m.compIdx)} y1="20" x2={xFor(m.compIdx)} y2="200"/>
                  <text className="tm-event-marker-label" x={xFor(m.compIdx)} y="34" textAnchor="middle">{m.label}</text>
                  <text className="tm-event-marker-label" x={xFor(m.compIdx)} y="46" textAnchor="middle" style={{ fontSize: 9, fill: "var(--tm-ink-2)" }}>
                    {m.comp} cross
                  </text>
                </>
              )}
              {m.spxIdx >= 0 && (
                <>
                  <line className="tm-event-marker-line spx" x1={xFor(m.spxIdx)} y1="260" x2={xFor(m.spxIdx)} y2="460"/>
                  <text className="tm-event-marker-label" x={xFor(m.spxIdx)} y="276" textAnchor="middle" style={{ fill: "#2862c2" }}>
                    S&amp;P {m.spx_breakdown_value != null ? m.spx_breakdown_value.toFixed(0) + "%" : ""}
                  </text>
                </>
              )}
            </g>
          ))}

          {polylines.map((p) => (
            <polyline key={p.key} points={p.points} fill="none" stroke={p.color} strokeWidth="1.2"
                      strokeLinejoin="round" strokeLinecap="round"/>
          ))}

          {n > 0 && (
            <line x1={xFor(n - 1)} y1="20" x2={xFor(n - 1)} y2="460"
                  stroke="var(--tm-accent)" strokeWidth="0.8" strokeDasharray="2 2" opacity="0.5"/>
          )}

          {hover && filtered[hover.idx] && (
            <g>
              <line x1={xFor(hover.idx)} y1="20" x2={xFor(hover.idx)} y2="460"
                    stroke="var(--tm-accent)" strokeWidth="0.8" strokeDasharray="3 3" opacity="0.6"/>
              {Object.keys(SERIES_META).map((k) => {
                if (!visible[k]) return null;
                const v = filtered[hover.idx][k];
                if (v == null) return null;
                const y = SERIES_META[k].panel === "top" ? yForTop(v) : yForBottom(v);
                return (
                  <circle key={k} cx={xFor(hover.idx)} cy={y} r="3.5"
                          fill={SERIES_META[k].color} stroke="var(--tm-card)" strokeWidth="1.5"/>
                );
              })}
            </g>
          )}

          {n === 0 && (
            <text x={LAYOUT.width / 2} y="260" textAnchor="middle" fontFamily="Inter" fontSize="14" fill="var(--tm-ink-3)">
              No data in selected range
            </text>
          )}
        </svg>
        {tt}
      </div>
    </div>
  );
}

// ── Generic collapsible section wrapper. Click the head row to expand/collapse.
//    When closed, only the head shows (compact tile mode). When open, body is rendered.
function Collapsible({ title, sub, preview, openLabel, closeLabel, defaultOpen, children }) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <div className={"tm-collapsible" + (open ? " is-open" : "")}>
      <div className="tm-collapsible-head" onClick={() => setOpen((v) => !v)}
           role="button" tabIndex={0}
           onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen((v) => !v); } }}>
        <div className="tm-collapsible-meta">
          <h3 className="tm-collapsible-title">{title}</h3>
          {sub && <div className="tm-collapsible-sub">{sub}</div>}
        </div>
        <div className="tm-collapsible-spark">
          {!open && preview}
          <button className="tm-collapsible-toggle" onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}>
            <span>{open ? closeLabel : openLabel}</span>
            <span className="chev">▾</span>
          </button>
        </div>
      </div>
      {open && <div className="tm-collapsible-body">{children}</div>}
    </div>
  );
}

export default function TodayMacro({ onNavToReadme, asOfIso, indFreq }) {
  const [data, setData] = useState(null);
  const [weights, setWeights] = useState(null);
  const [eventMarkers, setEventMarkers] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    const id = "tm-page-styles";
    if (document.getElementById(id)) return;
    const tag = document.createElement("style");
    tag.id = id;
    tag.textContent = STYLES;
    document.head.appendChild(tag);
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch("/composite_history_daily.json").then((r) => r.json()),
      fetch("/composite_weights.json").then((r) => r.json()),
      fetch("/composite_event_markers.json").then((r) => r.json()),
    ])
      .then(([d, w, e]) => {
        if (cancelled) return;
        setData(d);
        setWeights(w);
        setEventMarkers(e);
      })
      .catch((err) => {
        if (cancelled) return;
        // eslint-disable-next-line no-console
        console.error("[TodayMacro] load failed", err);
        setError(err);
      });
    return () => { cancelled = true; };
  }, []);

  const snapshot = useMemo(() => {
    if (!data || data.length === 0) return null;
    const last = data[data.length - 1];
    const lastIdx = data.length - 1;
    const fourMonthsAgo = findRowByOffset(data, lastIdx, 4);
    return {
      asOf: last.d,
      RL: { score: last.RL, prev: fourMonthsAgo ? fourMonthsAgo.RL : null },
      GR: { score: last.GR, prev: fourMonthsAgo ? fourMonthsAgo.GR : null },
      IR: { score: last.IR, prev: fourMonthsAgo ? fourMonthsAgo.IR : null },
    };
  }, [data]);

  if (error) {
    return (
      <div className="tm-page" style={PAGE_VARS}>
        <div className="tm-loading" style={{ color: "var(--tm-stressed)" }}>
          Failed to load composite history. Try refreshing.
        </div>
      </div>
    );
  }

  if (!snapshot || !weights) {
    return (
      <div className="tm-page" style={PAGE_VARS}>
        <div className="tm-loading">Loading composite history…</div>
      </div>
    );
  }

  const regimes = COMPOSITES.map((c) => ({
    comp: c, regime: regimeForScore(snapshot[c.key].score), score: snapshot[c.key].score,
  }));
  const allBenign = regimes.every((r) => r.regime === "calm" || r.regime === "quiet" || r.regime === "normal");
  const hasStressed = regimes.some((r) => r.regime === "stressed");
  const hasElevated = regimes.some((r) => r.regime === "elevated");

  let quadrantLabel, headline;
  if (hasStressed) {
    quadrantLabel = "All-Weather quadrant: Reflation/Crisis";
    headline = (
      <>One or more composites is in <em>stressed</em> territory — lean defensive and watch the
      lead-time table below for false-positive history.</>
    );
  } else if (hasElevated) {
    quadrantLabel = "All-Weather quadrant: Stagflation watch";
    headline = (
      <>At least one composite reads <em>elevated</em> — the framework is starting to flag
      stress; check which composite and which underlying indicator is driving it.</>
    );
  } else if (allBenign) {
    quadrantLabel = "All-Weather quadrant: Goldilocks";
    headline = (
      <>All three composites read benign — risk-on conditions across liquidity, growth, and
      rates. <em>Goldilocks regime, normal-range readings.</em></>
    );
  } else {
    quadrantLabel = "All-Weather quadrant: Mixed";
    headline = (
      <>Composites are sending mixed signals — read the per-composite drilldowns below to see
      which dimension is driving the divergence.</>
    );
  }

  // Resolve the right tooltip text for each pill given current regime label.
  // TODO: parameterize when regime computation is wired live — today's read
  // is Normal across all three composites, so we hardcode the Normal-state
  // copy. Quadrant tooltip currently always returns Goldilocks copy.
  const quadrantTip = HERO_TOOLTIPS.quadrantGoldilocks;
  const pillTipFor = (compKey) => {
    if (compKey === "RL") return HERO_TOOLTIPS.rlNormal;
    if (compKey === "GR") return HERO_TOOLTIPS.growthNormal;
    if (compKey === "IR") return HERO_TOOLTIPS.inflationRatesNormal;
    return "";
  };

  // Total observation count for the trajectory tile preview line
  const obsCount = data ? data.length : 0;
  const yearSpan = data && data.length > 1
    ? Math.round((new Date(data[data.length - 1].d) - new Date(data[0].d)) / (365.25 * 86400000))
    : 0;
  const trajPreview = (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <MiniSpark data={data}/>
      <span style={{ fontSize: 11.5, color: "var(--tm-ink-3)", fontFamily: "var(--tm-fmono)", whiteSpace: "nowrap" }}>
        {yearSpan}Y · {obsCount.toLocaleString()} obs
      </span>
    </div>
  );

  return (
    <div className="tm-page" style={PAGE_VARS}>
      <div className="tm-hero">
        <div className="tm-eyebrow">Today's setup</div>
        <h1 className="tm-hero-headline">{headline}</h1>
        <div className="tm-hero-meta">
          <span className="tm-itip-host" tabIndex={0}>
            <span className="tm-quadrant-chip"><span className="dot"/>{quadrantLabel}</span>
            <span className="tm-itip" role="tooltip">{quadrantTip}</span>
          </span>
          <span className="tm-regime-summary">
            <span>Composites:</span>
            {regimes.map((r) => {
              const cls = r.regime;
              const bg = "var(--tm-" + cls + "-soft)";
              const col = "var(--tm-" + cls + ")";
              const shortName = r.comp.key === "RL" ? "R&L" : r.comp.key === "GR" ? "Growth" : "Inflation & Rates";
              return (
                <span key={r.comp.key} className="tm-itip-host" tabIndex={0}>
                  <span className="pill" style={{ background: bg, color: col }}>
                    {shortName} {regimeLabel(cls)}
                  </span>
                  <span className="tm-itip" role="tooltip">{pillTipFor(r.comp.key)}</span>
                </span>
              );
            })}
          </span>
        </div>
      </div>

      <div className="tm-composites">
        {COMPOSITES.map((c) => (
          <CompositeTile key={c.key} comp={c}
            score={snapshot[c.key].score}
            prevScore={snapshot[c.key].prev}
            weightsBlock={weights[c.weightsKey]}
            asOfIso={snapshot.asOf}
            indicatorAsOfIso={asOfIso}
            indicatorFreq={indFreq}
          />
        ))}
      </div>

      <Collapsible
        title="Composite history vs. equity drawdowns"
        sub={"21 years · " + obsCount.toLocaleString() + " daily observations · Hover, toggle, and zoom available when expanded"}
        preview={trajPreview}
        openLabel="Show chart"
        closeLabel="Hide chart"
      >
        <TrajectoryChart data={data} eventMarkers={eventMarkers}/>
      </Collapsible>

      <Collapsible
        title="Lead-time event study — what the chart actually shows"
        sub={"Five major drawdowns since 2007 — when each composite turned, when the S&P broke down, and the lead between them."}
        openLabel="Show event study"
        closeLabel="Hide event study"
      >
        <div className="tm-lt-sub">
          For each major drawdown since 2007, the composite that crossed +30 first (a stress
          signal), how far ahead of the S&amp;P −15% drawdown that signal arrived, and the
          eventual peak-to-trough drawdown. Toggle "Show event markers" on the chart above to see
          these dates as vertical lines.
        </div>
        <table className="tm-lead-time-table-el">
          <thead>
            <tr>
              <th>Event</th>
              <th>Composite that turned first</th>
              <th>Lead time</th>
              <th>Max S&amp;P drawdown</th>
              <th className="detail">+30 cross date</th>
              <th className="detail">S&amp;P −15% date</th>
              <th className="detail">Lead at +30</th>
              <th className="detail">Lead at composite&gt;0</th>
            </tr>
          </thead>
          <tbody>
            {LEAD_TIME_ROWS.map((r) => (
              <tr key={r.event}>
                <td className="label">{r.event}</td>
                <td className="label">{r.summaryComp}</td>
                <td className="label">{r.summaryLead}</td>
                <td>{r.summaryDD}</td>
                <td className="detail">{r.cross}</td>
                <td className="detail">{r.spx}</td>
                <td className={"detail " + r.lead30.cls}>{r.lead30.label}</td>
                <td className={"detail " + r.leadZero.cls}>{r.leadZero.label}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="tm-honest-read">
          <strong>Honest read:</strong> at the +30 threshold, the composite is a CONFIRMATION signal
          — it tells you stress has arrived, not that it's coming. At the lower threshold of{" "}
          <em>composite &gt; 0</em> (above long-run mean), the lead time is meaningfully better
          — averaging 29 weeks across these 5 events, with one false negative (2011 EU). The
          composite was NOT elevated 12 months before COVID, 2018-Q4, or 2011 — those are
          surprises by this measure. Only the GFC and 2022 hike cycle gave a clean 12+ month signal.
          The framework is a probabilistic risk gauge over a 1–12 month horizon, not a
          deterministic timing tool. Today's reading lowers conditional drawdown probability but
          does not eliminate it.
        </p>
      </Collapsible>

      <div className="tm-foot">
        <div>
          <strong>Methodology:</strong> EWMA z-score (18-month half-life, ±3σ winsorized)
          → score = z × 50. Drawdown probability via logistic regression fit on 21 years
          of data.{" "}
          {onNavToReadme && (
            <a onClick={(e) => { e.preventDefault(); onNavToReadme(); }}>Read the full methodology</a>
          )}
        </div>
        <div style={{ fontFamily: "var(--tm-fmono)" }}>
          As of {snapshot.asOf} · Risk &amp; Liquidity: 4 weighted · 6 reference. Growth:
          3 weighted · 7 reference. Inflation &amp; Rates: 2 weighted · 5 reference.
        </div>
      </div>
    </div>
  );
}
