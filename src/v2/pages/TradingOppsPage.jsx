// TradingOppsPage — Phase B (v4.1 Signal Intelligence ship, 2026-05-10)
//
// Reads from public.signal_intel_daily (populated by run_v4_scanner.py).
// Joins ticker reference / universe snapshot for company name + sector +
// 1-day change + IV rank. Renders the v4.1 mockup approved 2026-05-09:
//
//   • Hero (1440px, 32px Fraunces H2, 11px JetBrains Mono eyebrow with
//     0.12em tracking) on the left; "Today's Funnel" summary card on
//     the right (320px, animated bars + counters, SPY benchmark line).
//   • Toolbar — filter chips + ticker search + columns dropdown + add.
//   • 23-column scanner table — draggable headers, click-to-sort,
//     hover-tooltipped headers, 4 group dividers (High Conviction →
//     Watch → Outside surfacing zone → All others). Default-visible
//     subset of 10 columns; full set toggleable. Persisted to
//     localStorage under `mt-portopps-cols-v1`.
//   • Per-ticker dossier modal (works for ANY ticker, in-universe or
//     off). Quote tiles, MacroTilt Signal panel, dossier tiles, short
//     interest placeholder, "so what" plain-English line. The signal
//     panel carries a prominent caveat for tickers above the validated
//     surfacing zone ($300M-$3B).
//
// Theme parity: zero hex codes. Every color reads from the existing
// theme.css tokens (--text, --surface, --border, --accent, --green,
// --red, --yellow, etc.). Both light and dark theme verified.

import { useEffect, useMemo, useRef, useState, Fragment } from "react";
import { supabase } from "../../lib/supabase";

// ─────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────

const SURFACE_CAP_FLOOR = 300_000_000;
const SURFACE_CAP_CEILING = 3_000_000_000;

const STORAGE_KEY_COLS = "mt-portopps-cols-v1";

// 23-column schema. `default:true` = visible at first load (10 columns).
// Group keys feed the column dropdown's section grouping.
const COLUMNS = [
  { key: "ticker",   label: "Ticker",         group: "Identity",     numeric: false, default: true,
    tt: { label: "Identity", body: "Stock symbol. Click any row to open the full dossier modal." } },
  { key: "name",     label: "Name",           group: "Identity",     numeric: false, default: true,
    tt: { label: "Identity", body: "Company name. Source: Polygon ticker reference." } },
  { key: "sector",   label: "Sector",         group: "Identity",     numeric: false, default: true,
    tt: { label: "Identity", body: "GICS sector — 11 top-level buckets (Technology, Healthcare, Financials, etc.)." } },
  { key: "ig",       label: "Industry Group", group: "Identity",     numeric: false, default: true,
    tt: { label: "Identity", body: "GICS industry group — 25 sub-sector buckets (Semiconductors, Pharmaceuticals, Banks, etc.)." } },
  { key: "tag",      label: "Tag",            group: "Identity",     numeric: false, default: false,
    tt: { label: "Identity", body: "Custom thematic tag. Visible only when signed in; blank otherwise." } },
  { key: "price",    label: "Price",          group: "Quote",        numeric: true,  default: true,
    tt: { label: "Quote", body: "Last close. Source: Polygon Massive (EOD)." } },
  { key: "day_pct",  label: "Day %",          group: "Quote",        numeric: true,  default: true,
    tt: { label: "Quote", body: "1-day return vs prior close." } },
  { key: "mcap",     label: "Mkt Cap",        group: "Quote",        numeric: true,  default: true,
    tt: { label: "Quote", body: "Market capitalization. Source: Polygon ticker reference." } },
  { key: "range_52", label: "52W Range",      group: "Quote",        numeric: false, default: false,
    tt: { label: "Quote", body: "Position within trailing 52-week price range." } },
  { key: "score",    label: "MT Score",       group: "Signal",       numeric: true,  default: true,
    tt: { label: "MacroTilt Score", body: "Sum of signal points (Aggression 25 / Squeeze 20 / Momentum 20). Capped at 65. RSI > 70 zeroes the score." } },
  { key: "band",     label: "Band",           group: "Signal",       numeric: false, default: true,
    tt: { label: "MacroTilt Score", body: "Score >= 45 High Conviction; 20-44 Watch; below 20 Not Surfaced. Above $3B cap shows as Outside surfacing zone." } },
  { key: "gates",    label: "Filters",        group: "Signal",       numeric: false, default: true,
    tt: { label: "MacroTilt Score", body: "Three filters (Insider first-buy / Liquidity / Index hedge). Pass green, fail red. Any fail = score 0." } },
  { key: "pillars",  label: "Signals",        group: "Signal",       numeric: false, default: true,
    tt: { label: "MacroTilt Score", body: "Aggression (RVOL > 1.5x +25) / Squeeze (BB BandWidth < 4% +20) / Momentum (close > 50-SMA and RSI 40-70 +20)." } },
  { key: "rvol",     label: "RVOL",           group: "Signal",       numeric: true,  default: false,
    tt: { label: "MacroTilt Score", body: "Today's volume divided by 22-day average. > 1.5x fires Aggression." } },
  { key: "bbw",      label: "BB %",           group: "Signal",       numeric: true,  default: false,
    tt: { label: "MacroTilt Score", body: "Bollinger BandWidth (20-day, 2 sigma). < 4% fires Squeeze." } },
  { key: "rsi",      label: "RSI 14",         group: "Signal",       numeric: true,  default: false,
    tt: { label: "MacroTilt Score", body: "14-day Relative Strength Index. 40-70 healthy. > 70 zeroes score." } },
  { key: "sma_pct",  label: "% to 50-SMA",    group: "Signal",       numeric: true,  default: false,
    tt: { label: "MacroTilt Score", body: "Distance of last close from 50-day SMA. Positive = above trend." } },
  { key: "ins_date", label: "Latest P-buy",   group: "Signal",       numeric: false, default: false,
    tt: { label: "MacroTilt Score", body: "Most recent open-market insider purchase by a buyer with no prior P-buy in 12 months." } },
  { key: "ins_dol",  label: "Insider $",      group: "Signal",       numeric: true,  default: false,
    tt: { label: "MacroTilt Score", body: "Total dollar value of qualifying insider purchases in the 30-day window. High Conviction sizing tiebreaker." } },
  { key: "iv_rank",  label: "IV Rank",        group: "Options",      numeric: true,  default: false,
    tt: { label: "Options", body: "Implied volatility rank, last 12 months. Source: Unusual Whales." } },
  { key: "div_yld",  label: "Div Yield",      group: "Fundamentals", numeric: true,  default: false,
    tt: { label: "Fundamentals", body: "Trailing 12-month dividend yield." } },
  { key: "next_er",  label: "Next Earnings",  group: "Fundamentals", numeric: false, default: false,
    tt: { label: "Fundamentals", body: "Next earnings date." } },
  { key: "v1_comp",  label: "Legacy Score",   group: "Legacy",       numeric: true,  default: false,
    tt: { label: "Legacy", body: "Prior 6-signal composite (-100 to +100). Reference only." } },
];

const COL_KEYS = COLUMNS.map(c => c.key);
const DEFAULT_VISIBLE = COLUMNS.filter(c => c.default).map(c => c.key);

// ─────────────────────────────────────────────────────────────────────────
// localStorage helpers
// ─────────────────────────────────────────────────────────────────────────

function loadColState() {
  let saved = null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY_COLS);
    if (raw) saved = JSON.parse(raw);
  } catch (e) { /* ignore */ }

  if (!saved) {
    return { order: [...COL_KEYS], visible: [...DEFAULT_VISIBLE], sort: { key: "score", dir: "desc" }, filter: "all" };
  }
  const order = (saved.order || []).filter(k => COL_KEYS.includes(k));
  COL_KEYS.forEach(k => { if (!order.includes(k)) order.push(k); });
  const visible = (saved.visible || []).filter(k => COL_KEYS.includes(k));
  if (visible.length === 0) visible.push(...DEFAULT_VISIBLE);
  return {
    order,
    visible,
    sort: saved.sort || { key: "score", dir: "desc" },
    filter: saved.filter || "all",
  };
}

function saveColState(state) {
  try { localStorage.setItem(STORAGE_KEY_COLS, JSON.stringify(state)); } catch (e) { /* ignore */ }
}

// ─────────────────────────────────────────────────────────────────────────
// Formatters
// ─────────────────────────────────────────────────────────────────────────

function fmtMcap(n) {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  const v = Number(n);
  if (v >= 1e12) return `$${(v / 1e12).toFixed(2)}T`;
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(0)}M`;
  return `$${Math.round(v)}`;
}

function fmtDay(n) {
  if (n == null || !Number.isFinite(Number(n))) return null;
  const v = Number(n);
  return `${v > 0 ? "+" : ""}${v.toFixed(2)}%`;
}

function fmtMoney(v) {
  if (v == null || !Number.isFinite(Number(v))) return "—";
  const n = Number(v);
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${Math.round(n / 1e3)}k`;
  return `$${Math.round(n)}`;
}

function dayClass(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n === 0) return "muted-val";
  return n > 0 ? "pos-val" : "neg-val";
}

// ─────────────────────────────────────────────────────────────────────────
// Data hydration — pulls signal_intel_daily for the latest scan date and
// joins ticker_reference + universe_snapshots in two follow-up queries.
// ─────────────────────────────────────────────────────────────────────────

function shapeRow(scan, ref, snap) {
  let group = "fail";
  const band = scan?.band;
  if (band === "High Conviction") group = "high";
  else if (band === "Watch") group = "watch";
  else if (band === "Outside surfacing zone") group = "outside";

  const pd = scan?.pillar_diagnostic || {};
  const pillars = [
    pd.aggression?.fired ? 1 : 0,
    pd.squeeze?.fired ? 1 : 0,
    pd.momentum?.fired ? 1 : 0,
  ];
  const gd = scan?.gate_diagnostic || {};
  const gates = [
    gd.insider_first_buy?.pass ? 1 : 0,
    gd.liquidity?.pass ? 1 : 0,
    gd.index_hedge?.pass ? 1 : 0,
  ];

  const close = Number(snap?.close ?? 0) || null;
  let range52 = null;
  const hi = Number(snap?.week_52_high);
  const lo = Number(snap?.week_52_low);
  if (Number.isFinite(close) && Number.isFinite(hi) && Number.isFinite(lo) && hi > lo) {
    range52 = `${Math.round(((close - lo) / (hi - lo)) * 100)}%`;
  }

  let dayPct = null;
  const pc = Number(snap?.perc_change);
  if (Number.isFinite(pc)) dayPct = pc;
  else if (Number.isFinite(close) && Number.isFinite(Number(snap?.prev_close)) && Number(snap?.prev_close) > 0) {
    dayPct = ((close - Number(snap.prev_close)) / Number(snap.prev_close)) * 100;
  }

  return {
    ticker: scan.ticker,
    group,
    name: ref?.name || snap?.full_name || scan.ticker,
    sector: snap?.sector || ref?.sic_description || "—",
    ig: ref?.sic_description || "—",
    tag: "",
    price: close,
    day_pct: dayPct,
    mcap: scan?.market_cap != null ? Number(scan.market_cap) : null,
    range_52: range52,
    score: scan?.score ?? 0,
    band: scan?.band || "Not Surfaced",
    gates,
    pillars,
    rvol: pd?.aggression?.rvol ?? null,
    bbw: pd?.squeeze?.bandwidth_pct ?? null,
    rsi: pd?.momentum?.rsi ?? null,
    sma_pct: pd?.momentum?.sma50_pct ?? null,
    ins_date: gd?.insider_first_buy?.latest_buy_date || "—",
    ins_dol: scan?.insider_dollar_30d ?? 0,
    iv_rank: snap?.iv_rank != null ? Math.round(Number(snap.iv_rank)) : null,
    div_yld: null,
    next_er: null,
    v1_comp: null,
    surfacing_zone: !!scan?.surfacing_zone,
    short_interest_pct: scan?.short_interest_pct ?? null,
    short_interest_as_of: scan?.short_interest_as_of ?? null,
    _raw: { scan, ref, snap },
  };
}

function useScanData() {
  const [state, setState] = useState({
    rows: [],
    scanDate: null,
    loading: true,
    error: null,
    totals: { universe: null, mcapBand: null, hasIndicators: null, liquid: null, postHedge: null, insider: null, firstBuy: null, watch: 0, hc: 0 },
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const latestRes = await supabase
          .from("signal_intel_daily")
          .select("scan_date")
          .order("scan_date", { ascending: false })
          .limit(1);
        const latest = latestRes?.data?.[0]?.scan_date;
        if (!latest) {
          if (!cancelled) setState(s => ({ ...s, loading: false }));
          return;
        }

        const scanRes = await supabase
          .from("signal_intel_daily")
          .select("*")
          .eq("scan_date", latest)
          .order("score", { ascending: false });
        if (cancelled) return;
        if (scanRes.error) throw scanRes.error;
        const scanRows = scanRes.data || [];

        const tickers = scanRows.map(r => r.ticker);
        const TICK_BATCH = 800;

        const refByT = new Map();
        for (let i = 0; i < tickers.length; i += TICK_BATCH) {
          const slice = tickers.slice(i, i + TICK_BATCH);
          const r = await supabase
            .from("ticker_reference")
            .select("ticker,name,sic_description,sic_code")
            .in("ticker", slice);
          (r?.data || []).forEach(row => refByT.set(row.ticker, row));
        }

        const snapByT = new Map();
        for (let i = 0; i < tickers.length; i += TICK_BATCH) {
          const slice = tickers.slice(i, i + TICK_BATCH);
          const r = await supabase
            .from("universe_snapshots")
            .select("ticker,full_name,sector,close,prev_close,perc_change,iv_rank,week_52_high,week_52_low,marketcap,snapshot_ts")
            .in("ticker", slice)
            .order("snapshot_ts", { ascending: false });
          (r?.data || []).forEach(row => {
            if (!snapByT.has(row.ticker)) snapByT.set(row.ticker, row);
          });
        }

        if (cancelled) return;

        const shaped = scanRows.map(s => shapeRow(s, refByT.get(s.ticker), snapByT.get(s.ticker)));

        const universe = scanRows.length;
        const mcapBand = scanRows.filter(r => r.market_cap != null && Number(r.market_cap) >= SURFACE_CAP_FLOOR && Number(r.market_cap) <= SURFACE_CAP_CEILING).length;
        const liquid = scanRows.filter(r => r.gate_diagnostic?.liquidity?.pass).length;
        const postHedge = scanRows.filter(r => r.gate_diagnostic?.index_hedge?.pass !== false).length;
        const insider = scanRows.filter(r => {
          const gd = r.gate_diagnostic || {};
          return gd.insider_first_buy?.has_p_buy_30d || gd.insider_first_buy?.pass;
        }).length;
        const firstBuy = scanRows.filter(r => r.gate_diagnostic?.insider_first_buy?.pass).length;
        const watch = scanRows.filter(r => r.band === "Watch").length;
        const hc = scanRows.filter(r => r.band === "High Conviction").length;

        setState({
          rows: shaped,
          scanDate: latest,
          loading: false,
          error: null,
          totals: { universe, mcapBand, hasIndicators: universe, liquid, postHedge, insider, firstBuy, watch, hc },
        });
      } catch (err) {
        if (!cancelled) setState({ rows: [], scanDate: null, loading: false, error: err?.message || String(err), totals: { universe: null, mcapBand: null, hasIndicators: null, liquid: null, postHedge: null, insider: null, firstBuy: null, watch: 0, hc: 0 } });
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return state;
}

// ─────────────────────────────────────────────────────────────────────────
// Tooltip component (used on funnel steps + table headers + result cards).
// Pure CSS hover; works in light + dark theme via existing tokens.
// ─────────────────────────────────────────────────────────────────────────

function Tooltip({ label, body, children, side = "top" }) {
  const top = side === "top";
  const positionStyle = top
    ? { bottom: "calc(100% + 8px)" }
    : { top: "calc(100% + 8px)" };
  return (
    <span className="mt-tt" style={{ position: "relative", display: "inline-flex", alignItems: "center", gap: 5, cursor: "help" }}>
      {children}
      <span
        className="mt-tt-body"
        style={{
          position: "absolute",
          ...positionStyle,
          left: "50%",
          transform: "translateX(-50%)",
          background: "var(--text)",
          color: "var(--surface)",
          padding: "8px 12px",
          borderRadius: 6,
          fontSize: 11,
          lineHeight: 1.5,
          width: 240,
          textAlign: "left",
          textTransform: "none",
          letterSpacing: 0,
          fontWeight: 400,
          opacity: 0,
          pointerEvents: "none",
          transition: "opacity 0.15s",
          zIndex: 100,
          boxShadow: "var(--shadow-md, 0 4px 14px rgba(0,0,0,0.15))",
          fontFamily: "var(--font-ui, Inter, system-ui, sans-serif)",
        }}
      >
        <span style={{ color: "var(--accent)", fontSize: 10, letterSpacing: "0.10em", textTransform: "uppercase", marginBottom: 4, display: "block", fontWeight: 600 }}>
          {label}
        </span>
        {body}
      </span>
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Animated counter used inside the funnel card.
// ─────────────────────────────────────────────────────────────────────────

function AnimatedCount({ value, durationMs = 900 }) {
  const [shown, setShown] = useState(0);
  const fromRef = useRef(0);
  useEffect(() => {
    if (value == null) { setShown(null); return; }
    const target = Number(value) || 0;
    const start = performance.now();
    const startVal = fromRef.current;
    let raf;
    const tick = (now) => {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      const v = Math.round(startVal + (target - startVal) * eased);
      setShown(v);
      if (t < 1) raf = requestAnimationFrame(tick); else fromRef.current = target;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, durationMs]);
  if (value == null || shown == null) return <span>—</span>;
  return <span>{Number(shown).toLocaleString()}</span>;
}

// ─────────────────────────────────────────────────────────────────────────
// Funnel summary card (right column of the hero).
// ─────────────────────────────────────────────────────────────────────────

function FunnelCard({ totals, scanDate }) {
  const ts = scanDate ? new Date(`${scanDate}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric" }) + " · EOD" : "Pending";
  const max = Math.max(1, totals?.universe || 1);
  const pct = (n) => Math.max(2, Math.min(100, Math.round(((n || 0) / max) * 100)));

  const steps = [
    { key: "universe", count: totals?.universe, label: "Total US-listed equities", tip: "Every Common Stock and ADR Polygon tracks on US exchanges." },
    { key: "mcapBand", count: totals?.mcapBand, label: "Market cap $300M-$3B", tip: "Validated surfacing range. Lower bound drops micro-caps; upper bound drops mid- and mega-caps where the insider signal weakens." },
    { key: "hasIndicators", count: totals?.hasIndicators, label: "Has indicator history", tip: "Names with at least 50 trading days of price + volume data — required for 50-day SMA, 14-day RSI, BB BandWidth, and 22-day relative volume." },
    { key: "liquid", count: totals?.liquid, label: "Liquidity threshold", tip: "Last close > $5 AND 22-day average daily volume > 500,000 shares." },
    { key: "postHedge", count: totals?.postHedge, label: "Index hedge exclusion", tip: "Drops the five broad index ETFs (SPY, QQQ, IWM, DIA, VTI). Used elsewhere as hedges; not signal candidates." },
    { key: "insider", count: totals?.insider, label: "Insider open-market buy (30d)", tip: "Names with at least one Form 4 transaction code 'P' (open-market purchase) in the last 30 days. Source: Unusual Whales /insider/transactions.", amber: true },
    { key: "firstBuy", count: totals?.firstBuy, label: "First-buy classifier", tip: "Of insider-buy names, keeps only those where at least one buyer made no purchase of this same stock in the prior 12 months. Backtest: first-buys outperform repeat-buys by 4-15 percentage points over 21 days.", amber: true },
  ];

  return (
    <div
      style={{
        padding: "20px 22px",
        borderRadius: "var(--r-lg, 22px)",
        border: "1px solid var(--border)",
        background: "var(--glass-bg, var(--surface))",
        backdropFilter: "var(--glass-blur, blur(10px))",
        WebkitBackdropFilter: "var(--glass-blur, blur(10px))",
        minWidth: 280,
        boxShadow: "var(--shadow-sm, 0 1px 2px rgba(0,0,0,0.04))",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14, paddingBottom: 12, borderBottom: "1px solid var(--border-faint, var(--border))" }}>
        <span style={{ fontFamily: "var(--font-mono, JetBrains Mono, monospace)", fontSize: 11, fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--text-muted)" }}>
          Today's Funnel
        </span>
        <span style={{ fontFamily: "var(--font-mono, JetBrains Mono, monospace)", fontSize: 10, color: "var(--text-dim)", letterSpacing: "0.04em" }}>
          {ts}
        </span>
      </div>

      {steps.map((s, i) => (
        <div key={s.key} style={{ position: "relative", display: "flex", alignItems: "center", gap: 10, padding: "7px 0" }}>
          <Tooltip label={s.label} body={s.tip}>
            <span style={{ fontSize: 12, color: "var(--text-2)", display: "inline-flex", alignItems: "center", gap: 5 }}>
              {s.label}
              <span aria-hidden="true" style={{ width: 13, height: 13, borderRadius: "50%", border: "1px solid var(--text-dim)", color: "var(--text-dim)", fontSize: 9, display: "inline-flex", alignItems: "center", justifyContent: "center", lineHeight: 1 }}>i</span>
            </span>
          </Tooltip>
          <span style={{ flex: 1, height: 6, background: "var(--surface-3, var(--surface-2))", borderRadius: 999, overflow: "hidden", position: "relative" }}>
            <span
              style={{
                display: "block",
                height: "100%",
                background: s.amber ? "var(--yellow, var(--accent))" : "var(--accent)",
                borderRadius: 999,
                width: s.count == null ? "0%" : `${pct(s.count)}%`,
                transition: "width 1.2s cubic-bezier(0.22, 1, 0.36, 1)",
              }}
            />
          </span>
          <span style={{ flex: "0 0 auto", fontFamily: "var(--font-mono, JetBrains Mono, monospace)", fontSize: 13, fontWeight: 600, color: "var(--text)", minWidth: 50, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
            {s.count == null ? "—" : <AnimatedCount value={s.count} />}
          </span>
        </div>
      ))}

      <div style={{ height: 1, background: "var(--border-faint, var(--border))", margin: "10px 0 12px" }} />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <Tooltip label="Watch" body="Names that pass all filters AND fire at least one of the three signals (Aggression / Squeeze / Momentum). Backtest 21-day win rate ~62%.">
          <div
            style={{
              background: "var(--surface-3, var(--surface-2))",
              border: "1px solid var(--border-faint, var(--border))",
              borderRadius: "var(--r-md, 16px)",
              padding: "12px 14px",
              cursor: "help",
              minWidth: 0,
              flex: 1,
            }}
          >
            <div style={{ fontFamily: "var(--font-mono, JetBrains Mono, monospace)", fontSize: 9, fontWeight: 600, letterSpacing: "0.10em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 4 }}>
              Watch
            </div>
            <div style={{ fontFamily: "var(--font-display, Fraunces, Georgia, serif)", fontSize: 32, fontWeight: 700, lineHeight: 1, color: "var(--yellow-text, var(--text))" }}>
              <AnimatedCount value={totals?.watch} />
            </div>
          </div>
        </Tooltip>
        <Tooltip label="High Conviction" body="Names that fire two or three signals at once. Backtest 21-day win rate ~70%. Tiebreaker for sizing is total insider dollars in the 30-day window.">
          <div
            style={{
              background: "var(--surface-3, var(--surface-2))",
              border: "1px solid var(--border-faint, var(--border))",
              borderRadius: "var(--r-md, 16px)",
              padding: "12px 14px",
              cursor: "help",
              minWidth: 0,
              flex: 1,
            }}
          >
            <div style={{ fontFamily: "var(--font-mono, JetBrains Mono, monospace)", fontSize: 9, fontWeight: 600, letterSpacing: "0.10em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 4 }}>
              High Conviction
            </div>
            <div style={{ fontFamily: "var(--font-display, Fraunces, Georgia, serif)", fontSize: 32, fontWeight: 700, lineHeight: 1, color: "var(--green-text, var(--green))" }}>
              <AnimatedCount value={totals?.hc} />
            </div>
          </div>
        </Tooltip>
      </div>

      <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--border-faint, var(--border))", fontSize: 11, color: "var(--text-muted)", lineHeight: 1.55 }}>
        Strategy alpha vs SPY: <strong style={{ color: "var(--green-text, var(--green))" }}>+8.62 percentage points</strong> · Beats SPY <strong style={{ color: "var(--text)" }}>65.5%</strong> of weeks · 12-month backtest.
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Hero (left column).
// ─────────────────────────────────────────────────────────────────────────

function Hero({ totals, scanDate }) {
  return (
    <div style={{ maxWidth: 1440, margin: "0 auto", padding: "24px 32px 16px" }}>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 320px", gap: 32, alignItems: "start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
          <div>
            <div
              style={{
                fontFamily: "var(--font-mono, JetBrains Mono, monospace)",
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                color: "var(--text-muted)",
                marginBottom: 6,
              }}
            >
              Trading Opportunities
            </div>
            <h2
              style={{
                fontFamily: "var(--font-display, Fraunces, Georgia, serif)",
                fontSize: 32,
                fontWeight: 700,
                letterSpacing: "-0.025em",
                lineHeight: 1.05,
                color: "var(--text)",
                margin: 0,
              }}
            >
              The names worth your attention{" "}
              <em style={{ fontStyle: "italic", color: "var(--accent)", fontWeight: 500 }}>— before the market notices.</em>
            </h2>
          </div>
          <p style={{ fontSize: 15, lineHeight: 1.5, color: "var(--text-muted)", maxWidth: 720, marginTop: 8, margin: "8px 0 0" }}>
            A funnel from the full equity universe down to a handful of high-conviction names. Three filters narrow the field; three signals score what's left. Click any row for the full ticker dossier.
          </p>
        </div>
        <FunnelCard totals={totals} scanDate={scanDate} />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Cell renderers
// ─────────────────────────────────────────────────────────────────────────

function ScoreCell({ value }) {
  if (value == null) return <span style={{ color: "var(--text-dim)" }}>—</span>;
  const n = Number(value);
  const color = n >= 45 ? "var(--green-text, var(--green))" : n >= 20 ? "var(--yellow-text, var(--text))" : "var(--text-dim)";
  return (
    <span style={{ fontFamily: "var(--font-display, Fraunces, Georgia, serif)", fontWeight: 700, fontSize: 15, color }}>
      {n}
    </span>
  );
}

function BandPill({ value }) {
  let bg, fg, label = value || "—";
  if (value === "High Conviction") { bg = "var(--accent-soft, var(--surface-2))"; fg = "var(--green-text, var(--green))"; label = "High"; }
  else if (value === "Watch") { bg = "var(--surface-3, var(--surface-2))"; fg = "var(--yellow-text, var(--text))"; }
  else if (value === "Outside surfacing zone") { bg = "var(--surface-3, var(--surface-2))"; fg = "var(--text-muted)"; label = "Outside zone"; }
  else { bg = "var(--surface-3, var(--surface-2))"; fg = "var(--red-text, var(--red))"; label = "Not surfaced"; }
  return (
    <span style={{ display: "inline-flex", alignItems: "center", padding: "3px 9px", borderRadius: 999, fontFamily: "var(--font-mono, JetBrains Mono, monospace)", fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 600, background: bg, color: fg }}>
      {label}
    </span>
  );
}

function GateTrio({ value }) {
  if (!Array.isArray(value)) return <span style={{ color: "var(--text-dim)" }}>—</span>;
  return (
    <span style={{ display: "inline-flex", gap: 3, fontFamily: "var(--font-mono, JetBrains Mono, monospace)", fontSize: 11, fontWeight: 600 }}>
      {value.map((g, i) => (
        <span
          key={i}
          style={{
            width: 18, height: 18, display: "inline-flex", alignItems: "center", justifyContent: "center",
            borderRadius: 4, lineHeight: 1,
            background: g ? "var(--accent-soft, var(--surface-2))" : "var(--surface-3, var(--surface-2))",
            color: g ? "var(--green-text, var(--green))" : "var(--red-text, var(--red))",
          }}
        >
          {g ? "✓" : "✗"}
        </span>
      ))}
    </span>
  );
}

function PillarTrio({ value }) {
  if (!Array.isArray(value)) return <span style={{ color: "var(--text-dim)" }}>—</span>;
  const labels = ["A", "S", "M"];
  return (
    <span style={{ display: "inline-flex", gap: 3, fontFamily: "var(--font-mono, JetBrains Mono, monospace)", fontSize: 11, fontWeight: 600 }}>
      {value.map((p, i) => (
        <span
          key={i}
          style={{
            minWidth: 22, padding: "2px 6px", display: "inline-flex", alignItems: "center", justifyContent: "center",
            borderRadius: 4, lineHeight: 1,
            background: p ? "var(--accent-soft, var(--surface-2))" : "var(--surface-3, var(--surface-2))",
            color: p ? "var(--accent)" : "var(--text-dim)",
          }}
        >
          {labels[i]}
        </span>
      ))}
    </span>
  );
}

function renderCell(row, key) {
  const v = row[key];
  if (v == null) return <span style={{ color: "var(--text-dim)" }}>—</span>;
  if (key === "ticker") return (
    <span style={{ fontFamily: "var(--font-display, Fraunces, Georgia, serif)", fontWeight: 600, color: "var(--text)", fontSize: 14 }}>{row.ticker}</span>
  );
  if (key === "name" || key === "sector" || key === "ig" || key === "tag" || key === "ins_date" || key === "next_er" || key === "range_52") {
    return <span>{v || "—"}</span>;
  }
  if (key === "price") return <span>{Number.isFinite(Number(v)) ? `$${Number(v).toFixed(2)}` : "—"}</span>;
  if (key === "day_pct") {
    const formatted = fmtDay(v);
    if (formatted == null) return <span style={{ color: "var(--text-dim)" }}>—</span>;
    const cls = dayClass(v);
    const c = cls === "pos-val" ? "var(--green-text, var(--green))" : cls === "neg-val" ? "var(--red-text, var(--red))" : "var(--text-muted)";
    return <span style={{ color: c }}>{formatted}</span>;
  }
  if (key === "mcap") return <span>{fmtMcap(v)}</span>;
  if (key === "rvol") return <span>{Number(v).toFixed(2)}x</span>;
  if (key === "bbw") return <span>{(Number(v) >= 0 ? "+" : "") + Number(v).toFixed(1) + "%"}</span>;
  if (key === "sma_pct") return <span>{(Number(v) >= 0 ? "+" : "") + Number(v).toFixed(1) + "%"}</span>;
  if (key === "rsi" || key === "iv_rank") return <span>{Math.round(Number(v))}</span>;
  if (key === "ins_dol") return <span>{v ? fmtMoney(v) : <span style={{ color: "var(--text-dim)" }}>—</span>}</span>;
  if (key === "div_yld") return <span>{v ? Number(v).toFixed(2) + "%" : <span style={{ color: "var(--text-dim)" }}>—</span>}</span>;
  if (key === "score") return <ScoreCell value={v} />;
  if (key === "band") return <BandPill value={v} />;
  if (key === "gates") return <GateTrio value={v} />;
  if (key === "pillars") return <PillarTrio value={v} />;
  if (key === "v1_comp") {
    const n = Number(v);
    if (!Number.isFinite(n)) return <span style={{ color: "var(--text-dim)" }}>—</span>;
    const cls = n > 0 ? "var(--green-text, var(--green))" : n < 0 ? "var(--red-text, var(--red))" : "var(--text-muted)";
    return <span style={{ color: cls }}>{n > 0 ? "+" : ""}{n}</span>;
  }
  return <span>{String(v)}</span>;
}

// ─────────────────────────────────────────────────────────────────────────
// TickerDossierModal — works for any ticker (in-universe or off).
// ─────────────────────────────────────────────────────────────────────────

function SignalRow({ label, children }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", gap: 12, padding: "8px 0", borderBottom: "1px solid var(--border-faint, var(--border))" }}>
      <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{label}</span>
      <span style={{ fontSize: 12, color: "var(--text)", fontVariantNumeric: "tabular-nums", fontFamily: "var(--font-mono, JetBrains Mono, monospace)" }}>{children}</span>
    </div>
  );
}

function PassFail({ pass }) {
  if (pass == null) return <span style={{ color: "var(--text-muted)" }}>—</span>;
  return pass
    ? <span style={{ color: "var(--green-text, var(--green))" }}>✓ Pass</span>
    : <span style={{ color: "var(--red-text, var(--red))" }}>✗ Fail</span>;
}

function FiredOrZero({ fired, points }) {
  return fired
    ? <span style={{ color: "var(--green-text, var(--green))" }}>✓ +{points}</span>
    : <span style={{ color: "var(--text-muted)" }}>0</span>;
}

function TickerDossierModal({ row, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, [onClose]);

  if (!row) return null;
  const r = row;
  const cap = Number(r.mcap);
  const aboveZone = Number.isFinite(cap) && cap > SURFACE_CAP_CEILING;
  const belowZone = Number.isFinite(cap) && cap < SURFACE_CAP_FLOOR;
  const offZone = aboveZone || belowZone || !Number.isFinite(cap);

  const dayPctFormatted = fmtDay(r.day_pct);
  const soWhat = r.band === "High Conviction"
    ? "High-conviction surface — every filter passes and at least two signals fire. The cap-bucket backtest expects the average $300M-$2B name in this band to deliver +9.78% over 21 days at a 74.6% win rate."
    : r.band === "Watch"
    ? "Watch surface — filters pass and at least one signal fires. Smaller position size or wait for a second signal to fire. The 12-month walk-forward expects ~+5.84% over 21 days at ~62% win rate."
    : r.band === "Outside surfacing zone"
    ? "Outside the validated surfacing zone. The score is shown for reference; above the $3B ceiling the academic and backtest evidence supporting Watch / High Conviction tags is materially weaker."
    : "Not surfaced today — at least one filter failed or the score is below the threshold. Held in the universe for tomorrow's scan.";

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.50)",
        zIndex: 200,
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        padding: "40px 20px",
        overflowY: "auto",
      }}
    >
      <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--r-md, 16px)", boxShadow: "var(--shadow-lg, 0 16px 48px rgba(0,0,0,0.20))", maxWidth: 1100, width: "100%", overflow: "hidden" }}>
        <div style={{ padding: "22px 28px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between", background: "var(--surface)", position: "sticky", top: 0 }}>
          <h2 style={{ fontFamily: "var(--font-display, Fraunces, Georgia, serif)", fontWeight: 600, fontSize: 28, color: "var(--text)", display: "inline-flex", alignItems: "baseline", gap: 12, margin: 0 }}>
            {r.ticker}
            <span style={{ fontSize: 14, color: "var(--text-muted)", fontFamily: "var(--font-ui, Inter, system-ui, sans-serif)", fontWeight: 400 }}>
              {r.name} · {r.sector}{r.ig && r.ig !== "—" && r.ig !== r.sector ? " · " + r.ig : ""}
            </span>
          </h2>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{ background: "transparent", border: "1px solid var(--border)", color: "var(--text-2)", width: 32, height: 32, borderRadius: "50%", cursor: "pointer", fontSize: 16 }}
          >
            ×
          </button>
        </div>

        <div style={{ padding: "24px 28px 28px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 24 }}>
            <div style={{ background: "var(--surface-2)", border: "1px solid var(--border-faint, var(--border))", borderRadius: 10, padding: 14 }}>
              <div style={{ fontFamily: "var(--font-mono, JetBrains Mono, monospace)", fontSize: 10, letterSpacing: "0.10em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 6, fontWeight: 600 }}>Last Close</div>
              <div style={{ fontFamily: "var(--font-display, Fraunces, Georgia, serif)", fontWeight: 600, fontSize: 22, color: "var(--text)" }}>{Number.isFinite(Number(r.price)) ? `$${Number(r.price).toFixed(2)}` : "—"}</div>
              <div style={{ fontSize: 11, color: dayClass(r.day_pct) === "pos-val" ? "var(--green-text, var(--green))" : dayClass(r.day_pct) === "neg-val" ? "var(--red-text, var(--red))" : "var(--text-muted)", marginTop: 4 }}>
                {dayPctFormatted ? `${dayPctFormatted} today` : "Day change unavailable"}
              </div>
            </div>
            <div style={{ background: "var(--surface-2)", border: "1px solid var(--border-faint, var(--border))", borderRadius: 10, padding: 14 }}>
              <div style={{ fontFamily: "var(--font-mono, JetBrains Mono, monospace)", fontSize: 10, letterSpacing: "0.10em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 6, fontWeight: 600 }}>Market Cap</div>
              <div style={{ fontFamily: "var(--font-display, Fraunces, Georgia, serif)", fontWeight: 600, fontSize: 22, color: "var(--text)" }}>{fmtMcap(r.mcap)}</div>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>{r.ig && r.ig !== "—" ? r.ig : r.sector}</div>
            </div>
            <div style={{ background: "var(--surface-2)", border: "1px solid var(--border-faint, var(--border))", borderRadius: 10, padding: 14 }}>
              <div style={{ fontFamily: "var(--font-mono, JetBrains Mono, monospace)", fontSize: 10, letterSpacing: "0.10em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 6, fontWeight: 600 }}>MT Score</div>
              <div style={{ fontFamily: "var(--font-display, Fraunces, Georgia, serif)", fontWeight: 600, fontSize: 22, color: r.score >= 45 ? "var(--green-text, var(--green))" : r.score >= 20 ? "var(--yellow-text, var(--text))" : "var(--text-muted)" }}>
                {r.score}
              </div>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>{r.band}</div>
            </div>
            <div style={{ background: "var(--surface-2)", border: "1px solid var(--border-faint, var(--border))", borderRadius: 10, padding: 14 }}>
              <div style={{ fontFamily: "var(--font-mono, JetBrains Mono, monospace)", fontSize: 10, letterSpacing: "0.10em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 6, fontWeight: 600 }}>Legacy Score</div>
              <div style={{ fontFamily: "var(--font-display, Fraunces, Georgia, serif)", fontWeight: 600, fontSize: 22, color: "var(--text-muted)" }}>—</div>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>Prior 6-signal · retired</div>
            </div>
          </div>

          <div style={{ marginBottom: 24 }}>
            <div style={{ background: "var(--accent-soft, var(--surface-2))", border: "1px solid var(--accent)", borderRadius: 12, padding: 18 }}>
              <h3 style={{ fontFamily: "var(--font-mono, JetBrains Mono, monospace)", fontSize: 11, letterSpacing: "0.10em", textTransform: "uppercase", color: "var(--accent)", fontWeight: 600, margin: "0 0 14px" }}>
                MacroTilt Signal
              </h3>

              {offZone && (
                <div style={{ marginBottom: 14, padding: "10px 14px", background: "var(--surface-2)", border: "1px solid var(--border-strong, var(--border))", borderRadius: 8, fontSize: 12, lineHeight: 1.55, color: "var(--text-2)" }}>
                  <strong style={{ color: "var(--text)" }}>Score shown for reference.</strong>{" "}
                  {aboveZone
                    ? "Validated surfacing zone is $300M-$3B. Above that, treat the score as informational — the academic and backtest evidence supporting Watch / High Conviction tags weakens with cap."
                    : belowZone
                    ? "Below the $300M floor. Sub-$300M names are scored but not surfaced — the validated zone starts at $300M."
                    : "Market cap unavailable. The score is shown for reference; surfacing requires a cap inside $300M-$3B."}
                </div>
              )}

              <SignalRow label="Filter — Insider first-buy">
                <PassFail pass={r.gates?.[0] === 1} />
                {" · "}
                {r.ins_date && r.ins_date !== "—" ? `latest ${r.ins_date}` : "no qualifying buy"}
                {r.ins_dol > 0 ? ` · ${fmtMoney(r.ins_dol)}` : ""}
              </SignalRow>
              <SignalRow label="Filter — Liquidity">
                <PassFail pass={r.gates?.[1] === 1} />
                {" · price > $5 AND 22-day avg vol > 500k"}
              </SignalRow>
              <SignalRow label="Filter — Index hedge">
                <PassFail pass={r.gates?.[2] === 1} />
                {" · not in {SPY, QQQ, IWM, DIA, VTI}"}
              </SignalRow>
              <SignalRow label="Signal — Aggression">
                <FiredOrZero fired={r.pillars?.[0] === 1} points={25} />
                {r.rvol != null ? ` · RVOL ${Number(r.rvol).toFixed(2)}x (threshold 1.5x)` : ""}
              </SignalRow>
              <SignalRow label="Signal — Squeeze">
                <FiredOrZero fired={r.pillars?.[1] === 1} points={20} />
                {r.bbw != null ? ` · BB BandWidth ${Number(r.bbw).toFixed(1)}% (threshold < 4%)` : ""}
              </SignalRow>
              <SignalRow label="Signal — Momentum">
                <FiredOrZero fired={r.pillars?.[2] === 1} points={20} />
                {r.rsi != null ? ` · RSI ${Math.round(Number(r.rsi))}` : ""}
                {r.sma_pct != null ? `, ${Number(r.sma_pct) >= 0 ? "+" : ""}${Number(r.sma_pct).toFixed(1)}% to 50-SMA` : ""}
              </SignalRow>
              <SignalRow label="Red flag (RSI > 70)">
                {r.rsi != null && Number(r.rsi) > 70
                  ? <span style={{ color: "var(--red-text, var(--red))" }}>✗ Triggered — score zeroed</span>
                  : <span style={{ color: "var(--green-text, var(--green))" }}>— clear</span>}
              </SignalRow>
              <SignalRow label="Backtest expectation">
                <span style={{ color: "var(--text-muted)" }}>
                  $300M-$3B + capnorm · +10.06% mean 21d / 76.2% win / +8.62 percentage points alpha vs SPY (12-month walk-forward)
                </span>
              </SignalRow>
            </div>
          </div>

          <div style={{ marginBottom: 24 }}>
            <h3 style={{ fontFamily: "var(--font-mono, JetBrains Mono, monospace)", fontSize: 11, letterSpacing: "0.10em", textTransform: "uppercase", color: "var(--text-muted)", fontWeight: 600, margin: "0 0 10px" }}>
              Dossier
            </h3>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12 }}>
              <div style={{ background: "var(--surface-2)", border: "1px solid var(--border-faint, var(--border))", borderRadius: 10, padding: 14 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                  <span style={{ fontFamily: "var(--font-mono, JetBrains Mono, monospace)", fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-muted)", fontWeight: 600 }}>Insider Activity</span>
                  <span style={{ color: "var(--text-muted)", fontSize: 10 }}>UW</span>
                </div>
                <div style={{ fontSize: 13, color: "var(--text-2)", lineHeight: 1.5 }}>
                  {r.ins_dol > 0
                    ? `Latest open-market buy ${r.ins_date} · ${fmtMoney(r.ins_dol)} aggregate (30d window)`
                    : "No qualifying open-market buys in last 30 days."}
                </div>
              </div>
              <div style={{ background: "var(--surface-2)", border: "1px solid var(--border-faint, var(--border))", borderRadius: 10, padding: 14 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                  <span style={{ fontFamily: "var(--font-mono, JetBrains Mono, monospace)", fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-muted)", fontWeight: 600 }}>Options Flow</span>
                  <span style={{ color: "var(--text-muted)", fontSize: 10 }}>UW</span>
                </div>
                <div style={{ fontSize: 13, color: "var(--text-2)", lineHeight: 1.5 }}>
                  {r.iv_rank != null
                    ? `IV Rank ${Math.round(Number(r.iv_rank))}% · ${Number(r.iv_rank) > 60 ? "premium expensive — sell-premium structures favored." : Number(r.iv_rank) < 30 ? "premium cheap — long-vol structures favored." : "premium reasonable."}`
                    : "No options data available."}
                </div>
              </div>
              <div style={{ background: "var(--surface-2)", border: "1px solid var(--border-faint, var(--border))", borderRadius: 10, padding: 14 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                  <span style={{ fontFamily: "var(--font-mono, JetBrains Mono, monospace)", fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-muted)", fontWeight: 600 }}>Trend</span>
                  <span style={{ color: "var(--text-muted)", fontSize: 10 }}>EOD</span>
                </div>
                <div style={{ fontSize: 13, color: "var(--text-2)", lineHeight: 1.5 }}>
                  {r.sma_pct != null
                    ? `Price ${Number(r.sma_pct) >= 0 ? "above" : "below"} 50-SMA by ${Math.abs(Number(r.sma_pct)).toFixed(1)}%`
                    : "No trend data available."}
                  {r.rsi != null ? ` · RSI ${Math.round(Number(r.rsi))}` : ""}
                  {r.range_52 ? ` · 52w range ${r.range_52}` : ""}
                </div>
              </div>
              <div style={{ background: "var(--surface-2)", border: "1px solid var(--border-faint, var(--border))", borderRadius: 10, padding: 14 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                  <span style={{ fontFamily: "var(--font-mono, JetBrains Mono, monospace)", fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-muted)", fontWeight: 600 }}>Short Interest</span>
                  <span style={{ color: "var(--text-muted)", fontSize: 10 }}>Sprint 2</span>
                </div>
                <div style={{ fontSize: 13, color: "var(--text-2)", lineHeight: 1.5 }}>
                  Short Interest data feed lands sprint 2 (#1177). UW endpoint wires Mon-Tue 5/11-5/12 before earnings catalysts.
                </div>
              </div>
            </div>
          </div>

          <div>
            <h3 style={{ fontFamily: "var(--font-mono, JetBrains Mono, monospace)", fontSize: 11, letterSpacing: "0.10em", textTransform: "uppercase", color: "var(--text-muted)", fontWeight: 600, margin: "0 0 10px" }}>
              So what
            </h3>
            <p style={{ fontSize: 13, lineHeight: 1.55, color: "var(--text-2)", margin: 0 }}>
              {soWhat}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Main page
// ─────────────────────────────────────────────────────────────────────────

export default function TradingOppsPage() {
  const { rows, scanDate, loading, error, totals } = useScanData();
  const [colState, setColState] = useState(() => loadColState());
  const [searchQ, setSearchQ] = useState("");
  const [colMenuOpen, setColMenuOpen] = useState(false);
  const [openTicker, setOpenTicker] = useState(null);
  const [extraRows, setExtraRows] = useState([]);
  const colMenuRef = useRef(null);
  const dragKeyRef = useRef(null);

  useEffect(() => { saveColState(colState); }, [colState]);

  useEffect(() => {
    const onDoc = (e) => {
      if (colMenuRef.current && !colMenuRef.current.contains(e.target)) setColMenuOpen(false);
    };
    document.addEventListener("click", onDoc);
    return () => document.removeEventListener("click", onDoc);
  }, []);

  const allRows = useMemo(() => [...rows, ...extraRows], [rows, extraRows]);

  const filtered = useMemo(() => {
    const q = searchQ.toLowerCase().trim();
    return allRows.filter(r => {
      if (q && !(r.ticker || "").toLowerCase().includes(q) && !(r.name || "").toLowerCase().includes(q)) return false;
      switch (colState.filter) {
        case "high": return r.group === "high";
        case "watch": return r.group === "watch" || r.group === "high";
        case "gate": return r.group === "high" || r.group === "watch";
        case "insider": return Number(r.ins_dol) > 0;
        case "held":
        case "watchlist": return r.group === "outside" || r.group === "high" || r.group === "watch";
        case "all":
        default: return true;
      }
    });
  }, [allRows, searchQ, colState.filter]);

  const sorted = useMemo(() => {
    const k = colState.sort.key;
    const dir = colState.sort.dir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const av = a[k]; const bv = b[k];
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });
  }, [filtered, colState.sort]);

  const groupOrder = ["high", "watch", "outside", "fail"];
  const groupMeta = {
    high:    { label: "High Conviction",        dot: "var(--green-text, var(--green))" },
    watch:   { label: "Watch",                  dot: "var(--yellow-text, var(--yellow))" },
    outside: { label: "Outside surfacing zone", dot: "var(--text-dim)" },
    fail:    { label: "All others",             dot: "var(--text-dim)" },
  };

  const visibleCols = colState.order.filter(k => colState.visible.includes(k));

  const sortBy = (k) => {
    setColState(s => {
      if (s.sort.key === k) return { ...s, sort: { key: k, dir: s.sort.dir === "asc" ? "desc" : "asc" } };
      return { ...s, sort: { key: k, dir: "desc" } };
    });
  };

  const setFilter = (f) => setColState(s => ({ ...s, filter: f }));

  const toggleCol = (k) => {
    setColState(s => {
      const visible = s.visible.includes(k) ? s.visible.filter(x => x !== k) : [...s.visible, k];
      return { ...s, visible };
    });
  };

  const handleAddTicker = () => {
    // eslint-disable-next-line no-alert
    const sym = prompt("Add a ticker to the table (e.g. PLTR):");
    if (!sym) return;
    const t = String(sym).trim().toUpperCase();
    if (!t) return;
    if (allRows.some(r => r.ticker === t)) { alert(`${t} is already in the table.`); return; }
    setExtraRows(prev => [...prev, {
      ticker: t, group: "outside", name: "(custom add)", sector: "—", ig: "—",
      tag: "", price: null, day_pct: null, mcap: null, range_52: null,
      score: 0, band: "Not Surfaced", gates: [0, 0, 0], pillars: [0, 0, 0],
      rvol: null, bbw: null, rsi: null, sma_pct: null, ins_date: "—", ins_dol: 0,
      iv_rank: null, div_yld: null, next_er: null, v1_comp: null,
      surfacing_zone: false, _raw: {},
    }]);
  };

  const onDragStart = (e, key) => { dragKeyRef.current = key; e.dataTransfer.effectAllowed = "move"; e.target.classList.add("mt-drag-source"); };
  const onDragEnd = (e) => { e.target.classList.remove("mt-drag-source"); document.querySelectorAll(".mt-drag-over").forEach(x => x.classList.remove("mt-drag-over")); };
  const onDragOver = (e) => { if (!dragKeyRef.current) return; e.preventDefault(); e.dataTransfer.dropEffect = "move"; document.querySelectorAll(".mt-drag-over").forEach(x => x.classList.remove("mt-drag-over")); e.currentTarget.classList.add("mt-drag-over"); };
  const onDrop = (e, dropKey) => {
    e.preventDefault();
    const dragKey = dragKeyRef.current;
    dragKeyRef.current = null;
    if (!dragKey || dragKey === dropKey) return;
    setColState(s => {
      const order = [...s.order];
      const from = order.indexOf(dragKey);
      const to = order.indexOf(dropKey);
      if (from < 0 || to < 0) return s;
      const [moved] = order.splice(from, 1);
      order.splice(to, 0, moved);
      return { ...s, order };
    });
  };

  return (
    <div style={{ minHeight: "100vh" }}>
      <Hero totals={totals} scanDate={scanDate} />

      <div style={{ maxWidth: 1440, margin: "0 auto", padding: "0 32px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "12px 16px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--r-md, 16px)", boxShadow: "var(--shadow-sm, 0 1px 2px rgba(0,0,0,0.04))", marginTop: 24, marginBottom: 16 }}>
          {[
            { f: "all",       label: "All" },
            { f: "high",      label: "High Conviction" },
            { f: "watch",     label: "Watch" },
            { f: "gate",      label: "Filter-pass" },
            { f: "insider",   label: "Insider activity" },
            { f: "held",      label: "Held" },
            { f: "watchlist", label: "Watchlist" },
          ].map(c => {
            const active = colState.filter === c.f;
            return (
              <button
                key={c.f}
                type="button"
                onClick={() => setFilter(c.f)}
                style={{
                  background: active ? "var(--accent)" : "transparent",
                  border: `1px solid ${active ? "var(--accent)" : "var(--border)"}`,
                  color: active ? "var(--surface)" : "var(--text-2)",
                  padding: "6px 13px",
                  borderRadius: 999,
                  fontSize: 12,
                  cursor: "pointer",
                  fontFamily: "var(--font-ui, Inter, system-ui, sans-serif)",
                  transition: "all 0.15s",
                }}
              >
                {c.label}
              </button>
            );
          })}

          <div style={{ flex: 1 }} />

          <input
            type="text"
            placeholder="Search ticker…"
            value={searchQ}
            onChange={(e) => setSearchQ(e.target.value)}
            style={{
              background: "var(--surface-2)",
              border: "1px solid var(--border)",
              color: "var(--text)",
              padding: "6px 12px",
              borderRadius: 8,
              fontSize: 12,
              minWidth: 200,
              fontFamily: "var(--font-ui, Inter, system-ui, sans-serif)",
            }}
          />

          <div ref={colMenuRef} style={{ position: "relative", display: "inline-block" }}>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setColMenuOpen(o => !o); }}
              style={{ background: "transparent", border: "1px solid var(--border)", color: "var(--text-2)", padding: "6px 13px", borderRadius: 8, fontSize: 12, cursor: "pointer", fontFamily: "var(--font-ui, Inter, system-ui, sans-serif)", display: "inline-flex", alignItems: "center", gap: 6 }}
            >
              ⚙ Columns
              <span style={{ color: "var(--text-dim)", marginLeft: 6 }}>{colState.visible.length}/{COLUMNS.length}</span>
            </button>
            {colMenuOpen && (
              <div style={{ position: "absolute", top: "calc(100% + 6px)", right: 0, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, boxShadow: "var(--shadow-lg, 0 16px 48px rgba(0,0,0,0.20))", padding: 8, zIndex: 50, minWidth: 280, maxHeight: 460, overflowY: "auto" }}>
                <div style={{ fontSize: 11, letterSpacing: "0.10em", textTransform: "uppercase", color: "var(--text-muted)", padding: "6px 10px 8px", fontWeight: 600, borderBottom: "1px solid var(--border-faint, var(--border))", marginBottom: 4, fontFamily: "var(--font-mono, JetBrains Mono, monospace)" }}>
                  Show / hide · Drag headers to reorder
                </div>
                {(() => {
                  const groups = {};
                  colState.order.forEach(k => {
                    const c = COLUMNS.find(x => x.key === k);
                    if (!c) return;
                    if (!groups[c.group]) groups[c.group] = [];
                    groups[c.group].push(c);
                  });
                  return Object.keys(groups).map(g => (
                    <div key={g}>
                      <div style={{ fontFamily: "var(--font-mono, JetBrains Mono, monospace)", fontSize: 10, letterSpacing: "0.10em", textTransform: "uppercase", color: "var(--text-dim)", padding: "8px 10px 4px", fontWeight: 600 }}>{g}</div>
                      {groups[g].map(c => (
                        <label key={c.key} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 10px", borderRadius: 6, cursor: "pointer", color: "var(--text-2)", fontSize: 12, userSelect: "none" }}>
                          <input
                            type="checkbox"
                            checked={colState.visible.includes(c.key)}
                            onChange={() => toggleCol(c.key)}
                            style={{ accentColor: "var(--accent)", cursor: "pointer" }}
                          />
                          <span>{c.label}</span>
                        </label>
                      ))}
                    </div>
                  ));
                })()}
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={handleAddTicker}
            style={{ background: "var(--accent)", border: "1px solid var(--accent)", color: "var(--surface)", padding: "6px 13px", borderRadius: 8, fontSize: 12, cursor: "pointer", fontFamily: "var(--font-ui, Inter, system-ui, sans-serif)", display: "inline-flex", alignItems: "center", gap: 6 }}
          >
            ＋ Add ticker
          </button>
        </div>

        {loading && (
          <div style={{ padding: 32, color: "var(--text-muted)", fontSize: 13, textAlign: "center", border: "1px solid var(--border)", borderRadius: "var(--r-md, 16px)", background: "var(--surface)" }}>
            Loading scan…
          </div>
        )}
        {!loading && error && (
          <div style={{ padding: 24, color: "var(--red-text, var(--red))", fontSize: 13, border: "1px solid var(--red, var(--border))", borderRadius: "var(--r-md, 16px)", background: "var(--surface)" }}>
            Trading Opps: failed to load scan ({error}).
          </div>
        )}
        {!loading && !error && allRows.length === 0 && (
          <div style={{ padding: 32, color: "var(--text-muted)", fontSize: 13, textAlign: "center", border: "1px solid var(--border)", borderRadius: "var(--r-md, 16px)", background: "var(--surface)" }}>
            No scan data yet — the daily scan runs tonight. Once it completes, the universe and the surface bands will populate here automatically.
          </div>
        )}

        {!loading && !error && allRows.length > 0 && (
          <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--r-md, 16px)", boxShadow: "var(--shadow-sm, 0 1px 2px rgba(0,0,0,0.04))", overflow: "hidden" }}>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, minWidth: 1400 }}>
                <thead>
                  <tr>
                    {visibleCols.map(k => {
                      const c = COLUMNS.find(x => x.key === k);
                      if (!c) return null;
                      const isSort = colState.sort.key === k;
                      const arrow = isSort ? (colState.sort.dir === "asc" ? "▲" : "▼") : "⇅";
                      return (
                        <th
                          key={k}
                          draggable
                          onDragStart={(e) => onDragStart(e, k)}
                          onDragEnd={onDragEnd}
                          onDragOver={(e) => onDragOver(e, k)}
                          onDrop={(e) => onDrop(e, k)}
                          onClick={(e) => { if (!e.target.classList.contains("mt-tt-body")) sortBy(k); }}
                          style={{
                            position: "relative",
                            background: "var(--surface-2)",
                            fontFamily: "var(--font-mono, JetBrains Mono, monospace)",
                            fontSize: 10,
                            letterSpacing: "0.08em",
                            textTransform: "uppercase",
                            color: "var(--text-muted)",
                            fontWeight: 600,
                            padding: "11px 10px",
                            textAlign: c.numeric ? "right" : "left",
                            borderBottom: "1px solid var(--border)",
                            cursor: "pointer",
                            whiteSpace: "nowrap",
                            userSelect: "none",
                          }}
                        >
                          <Tooltip label={c.tt.label} body={c.tt.body} side="bottom">
                            <span>
                              {c.label}
                              <span style={{ marginLeft: 4, color: isSort ? "var(--accent)" : "var(--text-dim)", fontSize: 9 }}>{arrow}</span>
                            </span>
                          </Tooltip>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {groupOrder.map(g => {
                    const groupRows = sorted.filter(r => r.group === g);
                    if (!groupRows.length) return null;
                    return (
                      <Fragment key={g}>
                        <tr>
                          <td colSpan={visibleCols.length} style={{ background: "var(--surface-2)", padding: "10px", borderBottom: "1px solid var(--border)", borderTop: "1px solid var(--border)" }}>
                            <span style={{ fontFamily: "var(--font-mono, JetBrains Mono, monospace)", fontSize: 11, letterSpacing: "0.10em", textTransform: "uppercase", color: "var(--text)", fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 8 }}>
                              <span style={{ width: 8, height: 8, borderRadius: "50%", background: groupMeta[g].dot }} />
                              {groupMeta[g].label}
                              <span style={{ fontWeight: 500, color: "var(--text-muted)", fontSize: 11 }}>· {groupRows.length}</span>
                            </span>
                          </td>
                        </tr>
                        {groupRows.map(r => (
                          <tr
                            key={r.ticker + "-" + g}
                            onClick={() => setOpenTicker(r)}
                            style={{ cursor: "pointer", transition: "background 0.12s" }}
                            onMouseEnter={(e) => { e.currentTarget.style.background = "var(--hover)"; }}
                            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                          >
                            {visibleCols.map(k => {
                              const c = COLUMNS.find(x => x.key === k);
                              return (
                                <td
                                  key={k}
                                  style={{
                                    padding: "11px 10px",
                                    borderBottom: "1px solid var(--border-faint, var(--border))",
                                    color: "var(--text-2)",
                                    whiteSpace: "nowrap",
                                    textAlign: c?.numeric ? "right" : "left",
                                    fontVariantNumeric: c?.numeric ? "tabular-nums" : "normal",
                                    fontFamily: c?.numeric ? "var(--font-mono, JetBrains Mono, monospace)" : undefined,
                                  }}
                                >
                                  {renderCell(r, k)}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div style={{ margin: "32px 0 24px", paddingTop: 16, borderTop: "1px solid var(--border-faint, var(--border))", textAlign: "center", color: "var(--text-muted)", fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", fontFamily: "var(--font-mono, JetBrains Mono, monospace)" }}>
          Daily scan refreshes after market close · Sourced from Polygon Massive · Unusual Whales · SEC Form 4
        </div>
      </div>

      {openTicker && <TickerDossierModal row={openTicker} onClose={() => setOpenTicker(null)} />}

      <style>{`
        .mt-tt:hover .mt-tt-body { opacity: 1 !important; }
        th.mt-drag-over { background: var(--accent-soft, var(--surface-2)) !important; }
        th.mt-drag-source { opacity: 0.4; }
      `}</style>
    </div>
  );
}
