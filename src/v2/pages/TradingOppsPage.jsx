// TradingOppsPage — Trading Opportunities screener (dual-direction rebuild).
//
// Reads public.trading_opps_signals — the nightly results table written by
// the rebuilt screener (Phase 2 engine). One row per launched stock for the
// most recent scan_date. The page is PageHero + a controls row + a wide
// 33-column results table. Clicking a row opens the existing global stock
// modal via the onOpenTicker prop.
//
// This file faithfully translates the finalized design mockup
// (trading_opps_page_mockup.html) into the real app shell. The design is
// locked — nothing here is a redesign.
//
// Theme parity: every color is a CSS variable defined in src/theme.css for
// BOTH light and dark. The few mockup-only tokens (--drv shade, --track) are
// re-defined in the injected <style> block below in terms of real tokens.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import PageHero from "../components/PageHero";
import { supabase } from "../../lib/supabase";
import { useSortableTable, SortArrow } from "../../hooks/useSortableTable";
import { InfoTip } from "../../InfoTip";
import {
  latestTradingSessionDate,
  isNYSETradingDay,
} from "../../lib/freshnessClock";

// ─────────────────────────────────────────────────────────────────────────
// Column spec — 33 columns, five groups, in the exact left-to-right order
// from the locked mockup. `drv:true` marks the five score-driving columns
// that get a shaded background wherever they sit.
// ─────────────────────────────────────────────────────────────────────────

export const COLS = [
  // ── Stock ──────────────────────────────────────────────────────────────
  { k: "last",    grp: "Stock", lbl: "Last Trade", numeric: false,
    tip: "[INFO] The most recent timestamp the stock executed a trade." },
  { k: "ticker",  grp: "Stock", lbl: "Ticker", numeric: false,
    tip: "The stock symbol." },
  { k: "sig",     grp: "Stock", lbl: "Signal", numeric: false,
    tip: "System-generated directional bias (Buy / Long, Sell / Short, Watchlist)." },
  { k: "score",   grp: "Stock", lbl: "Score", numeric: true,
    tip: "The integrated screener score, out of 10 — insider buying, the price trend, dark-pool clustering and options activity. A name reaches the list when its insider-and-trend foundation hits 3; the dark-pool and options layers then add conviction on top." },
  { k: "w1",      grp: "Stock", lbl: "Score 1W", numeric: true,
    tip: "Screener score one week ago." },
  { k: "m1",      grp: "Stock", lbl: "Score 1M", numeric: true,
    tip: "Screener score one month ago. A dash means the stock was not on the list then." },
  { k: "insider", grp: "Stock", lbl: "Insider Activity", numeric: true, drv: true,
    tip: "[SCORING INPUT] Open-market buying by a company's own officers and directors. The letter tags are the rules that fired — A: a CEO or CFO conviction buy; B: combined insider buying that is large relative to company size; C: three or more insiders buying in the window. The number is the signal's age in days — full weight for the first 15 days, then fading to zero by day 31. Drives up to 4 points." },
  { k: "dp",      grp: "Stock", lbl: "Dark Pool Anchor", numeric: false, drv: true,
    tip: "[SCORING INPUT] The dark-pool price-clustering zone — an institutional support floor when price sits above it. Drives up to 2 points of the score. Live, but not yet backtested." },
  { k: "chart",   grp: "Stock", lbl: "Chart", numeric: false, sortable: false,
    tip: "[INFO] Recent price sparkline." },
  { k: "price",   grp: "Stock", lbl: "Price", numeric: true,
    tip: "[INFO] Current closing price." },
  { k: "chg",     grp: "Stock", lbl: "Change", numeric: true,
    tip: "[INFO] Day change, percent and dollar." },
  { k: "vol",     grp: "Stock", lbl: "Volume", numeric: true,
    tip: "[INFO] Session share volume, with relative volume versus the 90-day norm." },
  { k: "r52",     grp: "Stock", lbl: "52w Range", numeric: true,
    tip: "[INFO] 52-week low and high, with the current price marked." },
  { k: "mcap",    grp: "Stock", lbl: "Mkt Cap", numeric: true,
    tip: "[INFO] Market capitalization." },
  // ── Options ────────────────────────────────────────────────────────────
  { k: "opts",    grp: "Options", lbl: "Options Vol Shock", numeric: true, drv: true,
    tip: "[SCORING INPUT] Fresh, aggressively-bought volume on medium-dated out-of-the-money call contracts, versus their open interest. Drives up to 4 points of the score. Live, but not yet backtested." },
  { k: "pc",      grp: "Options", lbl: "P/C", numeric: true,
    tip: "[INFO] Put-to-call volume ratio." },
  { k: "netprem", grp: "Options", lbl: "Net Prem", numeric: true,
    tip: "[INFO] Net premium from directional options flow. Positive means bullish." },
  { k: "ivr",     grp: "Options", lbl: "IV Rank", numeric: true,
    tip: "[INFO] Current implied volatility versus its 52-week range, 0 to 100." },
  { k: "iv",      grp: "Options", lbl: "IV", numeric: true,
    tip: "[INFO] Implied volatility." },
  { k: "imp7",    grp: "Options", lbl: "Implied 7D", numeric: true,
    tip: "[INFO] Expected 7-day move implied by options pricing." },
  { k: "imp30",   grp: "Options", lbl: "Implied 30D", numeric: true,
    tip: "[INFO] Expected 30-day move implied by options pricing." },
  // ── Statistics ─────────────────────────────────────────────────────────
  { k: "rv",      grp: "Statistics", lbl: "RV", numeric: true,
    tip: "[INFO] Realized volatility from past price movement." },
  { k: "mean",    grp: "Statistics", lbl: "Mean", numeric: true,
    tip: "[INFO] Average daily return baseline." },
  { k: "std",     grp: "Statistics", lbl: "Std Dev", numeric: true,
    tip: "[INFO] Standard deviation of daily moves." },
  { k: "d1sd",    grp: "Statistics", lbl: "Daily ±1σ", numeric: true,
    tip: "[INFO] Typical daily trading range, the one-standard-deviation envelope." },
  // ── Technicals ─────────────────────────────────────────────────────────
  { k: "sma200",  grp: "Technicals", lbl: "SMA200", numeric: true, drv: true,
    tip: "[SCORING INPUT] 200-day average — the long-term trend. Above adds to longs; below applies a penalty." },
  { k: "rsi",     grp: "Technicals", lbl: "RSI", numeric: true, drv: true,
    tip: "[SCORING INPUT] Relative Strength Index. Above 65 applies a penalty to longs." },
  { k: "ema9",    grp: "Technicals", lbl: "EMA9", numeric: true,
    tip: "[INFO] 9-period exponential moving average." },
  { k: "ema21",   grp: "Technicals", lbl: "EMA21", numeric: true,
    tip: "[INFO] 21-period exponential moving average." },
  { k: "sma50",   grp: "Technicals", lbl: "SMA50", numeric: true,
    tip: "[INFO] 50-period simple moving average." },
  // ── Info ───────────────────────────────────────────────────────────────
  { k: "name",    grp: "Info", lbl: "Name", numeric: false,
    tip: "[INFO] The company's legal corporate name." },
  { k: "sector",  grp: "Info", lbl: "Sector", numeric: false,
    tip: "[INFO] The market sector the company belongs to." },
  { k: "earn",    grp: "Info", lbl: "Earnings", numeric: false,
    tip: "[INFO] The next upcoming earnings date." },
];

export const GROUPS = ["Stock", "Options", "Statistics", "Technicals", "Info"];
export const COL_KEYS = COLS.map((c) => c.k);
export const COL_BY_KEY = Object.fromEntries(COLS.map((c) => [c.k, c]));

// ─────────────────────────────────────────────────────────────────────────
// Bug #1149 — Asset Tilt → Trading Opportunities deep-link.
//
// The Asset Tilt page links here with a #portopps?ig=<id> hash. We read that
// id, resolve it to (a) a display name for the dismissible chip and (b) the
// screener `sector` value to filter rows by.
//
// The screener (trading_opps_signals) has no per-stock industry-group tag —
// the only per-stock classification on a row is the broad vendor `sector`.
// So only the industry groups that are the SOLE Asset Tilt industry group in
// their GICS sector can be honestly filtered (sector ⇒ exactly that group).
// Asset Tilt gates the "View in Trading Opportunities" button to that same
// allowlist, so IG_DEEPLINK only ever needs entries for those groups. Any
// other / unknown ?ig= value is ignored and the full screener shows.
//
//   ig id     display name (for the chip)   screener `sector` to filter by
const IG_DEEPLINK = {
  reits:    { name: "REITs",                    sector: "Real Estate" },
  electric: { name: "Electric & Multi-Utility", sector: "Utilities" },
};

// Read the ?ig=<id> segment from the current location hash. Returns the
// matching IG_DEEPLINK entry (with the id attached) or null.
function readIgDeeplink() {
  if (typeof window === "undefined") return null;
  const hash = window.location.hash || "";
  const qs = hash.replace(/^#/, "").split("?")[1] || "";
  let id = null;
  try {
    id = new URLSearchParams(qs).get("ig");
  } catch (e) { /* malformed hash — ignore */ }
  if (!id) return null;
  const entry = IG_DEEPLINK[id];
  return entry ? { id, ...entry } : null;
}

// localStorage key — internal, carries a private version tag (no version
// string ever reaches user-facing copy).
const STORAGE_KEY = "mt-tradingopps-cols-v1";

// ─────────────────────────────────────────────────────────────────────────
// Column state — order + visibility, persisted to localStorage.
// `order` is the full ordered key list; `hidden` is the set of hidden keys.
// Order is only ever rearranged WITHIN a group (the customizer enforces it).
// ─────────────────────────────────────────────────────────────────────────

export function loadColState(storageKey = STORAGE_KEY) {
  let saved = null;
  try {
    const raw = localStorage.getItem(storageKey);
    if (raw) saved = JSON.parse(raw);
  } catch (e) { /* ignore — private mode / corrupt value */ }

  if (!saved || !Array.isArray(saved.order)) {
    return { order: [...COL_KEYS], hidden: [] };
  }
  // Keep only known keys; append any new keys that shipped after the save.
  let order = saved.order.filter((k) => COL_BY_KEY[k]);
  COL_KEYS.forEach((k) => { if (!order.includes(k)) order.push(k); });
  // Repair: every key must sit inside its own group's contiguous block, in
  // the canonical group order. Rebuild group-by-group preserving intra-group
  // order from the saved list.
  const repaired = [];
  GROUPS.forEach((g) => {
    const inGroup = order.filter((k) => COL_BY_KEY[k].grp === g);
    repaired.push(...inGroup);
  });
  const hidden = Array.isArray(saved.hidden)
    ? saved.hidden.filter((k) => COL_BY_KEY[k])
    : [];
  return { order: repaired, hidden };
}

export function saveColState(state, storageKey = STORAGE_KEY) {
  try { localStorage.setItem(storageKey, JSON.stringify(state)); }
  catch (e) { /* ignore */ }
}

// ─────────────────────────────────────────────────────────────────────────
// Formatters — every one is null-safe and returns "—" for missing values.
// ─────────────────────────────────────────────────────────────────────────

const DASH = "—";

function num(v) {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function fmtMcap(v) {
  const n = num(v);
  if (n == null) return DASH;
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9)  return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6)  return `$${(n / 1e6).toFixed(0)}M`;
  if (n >= 1e3)  return `$${(n / 1e3).toFixed(0)}K`;
  return `$${Math.round(n)}`;
}

function fmtVolM(v) {
  // Session volume is stored in raw shares OR already in millions depending
  // on the producer. Heuristic: values above 100k are treated as raw shares
  // and converted to millions; small values are assumed already-in-millions.
  const n = num(v);
  if (n == null) return null;
  return n >= 1e5 ? n / 1e6 : n;
}

function fmtTime(ts) {
  if (!ts) return DASH;
  const d = new Date(ts);
  if (isNaN(d.getTime())) return String(ts);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  let h = d.getHours();
  const min = String(d.getMinutes()).padStart(2, "0");
  const ampm = h >= 12 ? "p" : "a";
  h = h % 12; if (h === 0) h = 12;
  return `${mm}/${dd} ${h}:${min}${ampm}`;
}

function fmtDate(d) {
  if (!d) return DASH;
  const dt = new Date(`${d}T00:00:00`);
  if (isNaN(dt.getTime())) return String(d);
  return dt.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function fmtScanDate(d) {
  if (!d) return "Pending";
  const dt = new Date(`${d}T00:00:00`);
  if (isNaN(dt.getTime())) return String(d);
  return `EOD ${dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
}

// Staleness of the loaded scan against the trading calendar (bug #1200).
//
// The nightly screener (SCREENER_TRADING_OPPS_DAILY) can fail and leave the
// page showing days-old results under a "Today's Scan Results" heading with
// no warning. This compares the loaded scan_date to the most recent COMPLETE
// NYSE trading session and counts how many trading days behind it is — so a
// scan that is current "as of last close" reads as fresh on a weekend, and
// only a genuinely-missed nightly run flags. Reuses freshnessClock's
// trading-calendar helpers; it does not invent new date math.
//
// Returns { state: "fresh" | "stale" | "very-stale", daysBehind, label }.
//   stale  (amber) — 1 trading day behind: last night's run has not landed.
//   very-stale (red) — 2+ trading days behind: the nightly run has failed.
function scanFreshness(scanDateIso, nowMs) {
  if (!scanDateIso) return { state: "fresh", daysBehind: 0, label: null };
  const scan = new Date(`${scanDateIso}T00:00:00Z`);
  if (Number.isNaN(scan.getTime())) {
    return { state: "fresh", daysBehind: 0, label: null };
  }
  // Most recent COMPLETE trading session, anchored to ET midnight UTC.
  const latest = latestTradingSessionDate(nowMs);
  const latestUTC = new Date(Date.UTC(
    latest.getFullYear(), latest.getMonth(), latest.getDate(),
  ));
  // Count NYSE trading days strictly after the scan date, up to and
  // including the latest complete session. 0 ⇒ the scan IS the latest close.
  let daysBehind = 0;
  const probe = new Date(scan.getTime());
  for (let i = 0; i < 30 && probe.getTime() < latestUTC.getTime(); i++) {
    probe.setUTCDate(probe.getUTCDate() + 1);
    if (probe.getTime() > latestUTC.getTime()) break;
    if (isNYSETradingDay(probe)) daysBehind += 1;
  }
  if (daysBehind <= 0) return { state: "fresh", daysBehind: 0, label: null };
  const plural = daysBehind === 1 ? "day" : "days";
  if (daysBehind === 1) {
    return {
      state: "stale",
      daysBehind,
      label: `1 trading ${plural} behind — last night's scan has not landed yet`,
    };
  }
  return {
    state: "very-stale",
    daysBehind,
    label: `${daysBehind} trading ${plural} behind — the nightly scan has failed; treat these results as stale`,
  };
}

// Score band on the 0–10 scale: tier 5 = score >= 7, tier 4 = 5–6.99,
// tier 3 = below 5 (a launched name's score is always >= 3).
function scoreBand(s) {
  const n = num(s);
  if (n == null) return 3;
  if (n >= 7) return 5;
  if (n >= 5) return 4;
  return 3;
}

// ─────────────────────────────────────────────────────────────────────────
// Data hydration — pull the most recent scan from trading_opps_signals.
// One query for the latest scan_date, then all rows for it ordered by score.
// ─────────────────────────────────────────────────────────────────────────

function useScanData() {
  const [state, setState] = useState({
    rows: [], scanDate: null, loading: true, error: null,
    universeScanned: null, gateCleared: null,
  });

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        // 1. Most recent scan_date.
        const latestRes = await supabase
          .from("trading_opps_signals")
          .select("scan_date")
          .order("scan_date", { ascending: false })
          .limit(1);
        if (latestRes.error) throw latestRes.error;
        const latest = latestRes.data && latestRes.data[0]
          ? latestRes.data[0].scan_date
          : null;
        if (!latest) {
          if (alive) setState({
            rows: [], scanDate: null, loading: false, error: null,
            universeScanned: null, gateCleared: null,
          });
          return;
        }

        // 2. All rows for that scan_date, highest score first.
        const rowsRes = await supabase
          .from("trading_opps_signals")
          .select("*")
          .eq("scan_date", latest)
          .order("score", { ascending: false, nullsFirst: false });
        if (rowsRes.error) throw rowsRes.error;

        const data = rowsRes.data || [];
        // Funnel counts are denormalized — identical on every row of a scan.
        const first = data[0] || {};
        if (alive) setState({
          rows: data,
          scanDate: latest,
          loading: false,
          error: null,
          universeScanned: first.universe_scanned ?? null,
          gateCleared: first.gate_cleared ?? null,
        });
      } catch (err) {
        if (alive) setState({
          rows: [], scanDate: null, loading: false,
          error: (err && err.message) ? err.message : String(err),
          universeScanned: null, gateCleared: null,
        });
      }
    })();
    return () => { alive = false; };
  }, []);

  return state;
}

// ─────────────────────────────────────────────────────────────────────────
// Sparkline — inline SVG built from the `spark` array of recent closes.
// ─────────────────────────────────────────────────────────────────────────

function Sparkline({ data }) {
  const arr = Array.isArray(data)
    ? data.map((v) => Number(v)).filter((v) => Number.isFinite(v))
    : [];
  if (arr.length < 2) return <span style={{ color: "var(--text-dim)" }}>{DASH}</span>;
  const w = 58, h = 20;
  const mn = Math.min(...arr);
  const mx = Math.max(...arr);
  const r = (mx - mn) || 1;
  const pts = arr.map((v, i) => {
    const x = (i / (arr.length - 1)) * w;
    const y = h - ((v - mn) / r) * h;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  const up = arr[arr.length - 1] >= arr[0];
  const stroke = up ? "var(--green-text)" : "var(--red-text)";
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: "block" }}>
      <polyline points={pts} fill="none" stroke={stroke} strokeWidth="1.4"
        strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Header tooltip — portal-rendered, viewport-clamped, hover-gated. Mirrors
// the current page's portal Tooltip so headers never overflow the table.
// ─────────────────────────────────────────────────────────────────────────

function HeaderTip({ tip, children }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const anchorRef = useRef(null);
  const TT_W = 240;

  useLayoutEffect(() => {
    if (!open || !anchorRef.current) return;
    const r = anchorRef.current.getBoundingClientRect();
    const margin = 8;
    const wantX = r.left;
    const clampedX = Math.max(
      margin,
      Math.min(wantX, window.innerWidth - TT_W - margin)
    );
    setPos({ x: clampedX, y: r.bottom + 4 });
  }, [open]);

  // The tip text carries an "[SCORING INPUT]" / "[INFO]" prefix; render the
  // SCORING INPUT prefix in the accent color, INFO inline plain.
  let prefix = null;
  let body = tip;
  if (tip.startsWith("[SCORING INPUT]")) {
    prefix = "SCORING INPUT";
    body = tip.slice("[SCORING INPUT]".length).trim();
  } else if (tip.startsWith("[INFO]")) {
    prefix = "INFO";
    body = tip.slice("[INFO]".length).trim();
  }

  return (
    <>
      <span
        ref={anchorRef}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        style={{ display: "inline-flex", alignItems: "center" }}
      >
        {children}
      </span>
      {open && typeof document !== "undefined" && createPortal(
        <div
          role="tooltip"
          style={{
            position: "fixed",
            left: pos.x,
            top: pos.y,
            width: TT_W,
            padding: "8px 10px",
            background: "var(--surface-solid)",
            color: "var(--text-2)",
            border: "1px solid var(--border-strong)",
            borderRadius: "var(--radius-sm, 10px)",
            fontSize: 10.5,
            lineHeight: 1.45,
            fontFamily: "var(--font-ui)",
            fontWeight: 400,
            letterSpacing: 0,
            textTransform: "none",
            textAlign: "left",
            whiteSpace: "normal",
            boxShadow: "var(--shadow-lg)",
            zIndex: 9999,
            pointerEvents: "none",
          }}
        >
          {prefix && (
            <span style={{
              color: prefix === "SCORING INPUT" ? "var(--accent)" : "var(--text-dim)",
              fontWeight: 700,
            }}>
              [{prefix}]{" "}
            </span>
          )}
          {body}
        </div>,
        document.body
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Hero right slot — "Today's Scan Results" tile.
// ─────────────────────────────────────────────────────────────────────────

function ScanTile({ scanDate, universeScanned, gateCleared, activeAlerts, band5, band4, band3 }) {
  const fmtCount = (v) => (v == null ? DASH : Number(v).toLocaleString());
  // Bug #1200 — flag stale scan output instead of presenting it as "Today's".
  const fresh = scanFreshness(scanDate);
  const isStale = fresh.state !== "fresh";
  // When the scan is behind the trading calendar, drop the "Today's" claim.
  const heading = isStale ? "Latest Scan Results" : "Today’s Scan Results";
  return (
    <div className="to-scan-tile">
      <div className="to-scan-tile-head">
        <h3>{heading}</h3>
        <span>{fmtScanDate(scanDate)}</span>
      </div>
      {isStale && (
        <div
          className={`to-stale-flag ${fresh.state}`}
          role="status"
          title={fresh.label}
        >
          <span className="to-stale-dot" aria-hidden="true" />
          <span className="to-stale-text">
            {fresh.state === "very-stale" ? "STALE" : "MAY BE STALE"}
            {" · "}
            {fresh.label}
          </span>
        </div>
      )}
      <div className="to-funnel-row">
        <span className="lbl">Universe scanned<InfoTip def="The full set of U.S.-listed stocks the screener looked at in last night's run, before any filtering." size={10} /></span>
        <span className="val">{fmtCount(universeScanned)}</span>
      </div>
      <div className="to-funnel-row">
        <span className="lbl">Cleared the $1.5M liquidity gate<InfoTip def="How many of those stocks trade enough each day to be tradable — at least 1.5 million dollars of value changing hands." size={10} /></span>
        <span className="val">{fmtCount(gateCleared)}</span>
      </div>
      <div className="to-funnel-row">
        <span className="lbl">Active long alerts (score &ge; 3)<InfoTip def="How many stocks scored high enough to make the buy list — a score of 3 or more on the screener's ten-point scale." size={10} /></span>
        <span className="val" style={{ color: "var(--green-text)" }}>
          {Number(activeAlerts).toLocaleString()}
        </span>
      </div>
      <div className="to-scan-bands">
        <div className="to-band to-band-5">
          <div className="bn">{band5}</div>
          <div className="bl">Score 7+<InfoTip def="The strongest band — stocks scoring 7 or higher out of 10, where the screener has the most conviction." size={9} /></div>
        </div>
        <div className="to-band to-band-4">
          <div className="bn">{band4}</div>
          <div className="bl">Score 5–6<InfoTip def="The middle band — solid setups scoring 5 to 6 out of 10." size={9} /></div>
        </div>
        <div className="to-band to-band-3">
          <div className="bn">{band3}</div>
          <div className="bl">Score 3–4<InfoTip def="The entry band — stocks that just cleared the screener's threshold, scoring 3 to 4 out of 10." size={9} /></div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Column customizer panel — show/hide grouped by section; drag-reorder
// WITHIN each group. Persisted to localStorage by the parent.
// ─────────────────────────────────────────────────────────────────────────

export function ColumnCustomizer({ order, hidden, onChange, onClose }) {
  const panelRef = useRef(null);
  const [dragKey, setDragKey] = useState(null);

  // Close on outside click / Escape.
  useEffect(() => {
    function onDocClick(e) {
      if (panelRef.current && !panelRef.current.contains(e.target)) onClose();
    }
    function onKey(e) { if (e.key === "Escape") onClose(); }
    document.addEventListener("mousedown", onDocClick);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const hiddenSet = new Set(hidden);

  const toggle = (key) => {
    const next = new Set(hidden);
    if (next.has(key)) next.delete(key); else next.add(key);
    onChange({ order, hidden: Array.from(next) });
  };

  // Drop `dragKey` immediately before `targetKey` — only allowed when both
  // sit in the same group (the canonical group order is preserved).
  const handleDrop = (targetKey) => {
    if (!dragKey || dragKey === targetKey) { setDragKey(null); return; }
    if (COL_BY_KEY[dragKey].grp !== COL_BY_KEY[targetKey].grp) {
      setDragKey(null);
      return;
    }
    const next = order.filter((k) => k !== dragKey);
    const idx = next.indexOf(targetKey);
    next.splice(idx, 0, dragKey);
    onChange({ order: next, hidden });
    setDragKey(null);
  };

  return (
    <div ref={panelRef} className="to-cust-panel" role="dialog" aria-label="Customize columns">
      <div className="to-cust-head">
        <span>Show, hide and reorder columns</span>
        <button className="to-cust-close" onClick={onClose} aria-label="Close">&times;</button>
      </div>
      <div className="to-cust-hint">
        Drag a column to reorder it within its group.
      </div>
      <div className="to-cust-body">
        {GROUPS.map((g) => {
          const keys = order.filter((k) => COL_BY_KEY[k].grp === g);
          return (
            <div key={g} className="to-cust-group">
              <div className="to-cust-group-label">{g}</div>
              {keys.map((k) => {
                const col = COL_BY_KEY[k];
                const isHidden = hiddenSet.has(k);
                return (
                  <div
                    key={k}
                    className={"to-cust-item" + (dragKey === k ? " dragging" : "")}
                    draggable
                    onDragStart={() => setDragKey(k)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => handleDrop(k)}
                    onDragEnd={() => setDragKey(null)}
                  >
                    <span className="to-cust-grip" aria-hidden="true">&#8942;&#8942;</span>
                    <label className="to-cust-check">
                      <input
                        type="checkbox"
                        checked={!isHidden}
                        onChange={() => toggle(k)}
                      />
                      <span>{col.lbl}</span>
                    </label>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Cell renderer — one function, switch on column key. Every branch is
// null-safe and falls back to an em-dash.
// ─────────────────────────────────────────────────────────────────────────

function dashSpan() {
  return <span style={{ color: "var(--text-dim)" }}>{DASH}</span>;
}

function renderCell(c, r) {
  switch (c.k) {
    case "last":
      return <span className="to-sub">{r.last_trade_ts ? fmtTime(r.last_trade_ts) : DASH}</span>;

    case "ticker":
      return (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
          <span className="to-tk">{r.ticker}</span>
        </span>
      );

    case "sig": {
      // No fallback — a row with no signal (e.g. a watchlist name the
      // screener has not launched) shows a dash, never a default Buy.
      const s = r.signal;
      return s ? <span className="to-sig">{s}</span> : dashSpan();
    }

    case "score": {
      const n = num(r.score);
      if (n == null) return dashSpan();
      const b = scoreBand(n);
      return (
        <span className={`to-score to-score-${b}`}>
          <span className="sv">{n.toFixed(1)}</span>
          <span className="sm">/ 10</span>
        </span>
      );
    }

    case "w1": {
      const n = num(r.score_1w);
      if (n == null) return <span className="to-muted">{DASH}</span>;
      if (r.score_1w_like_for_like === false) return (
        <span className="to-muted" title="Not directly comparable — this earlier score was computed under the previous scoring method, before the score ceiling rose to 10.">
          {n.toFixed(1)}<span className="to-lfl-mark">*</span>
        </span>
      );
      return <span className="to-muted">{n.toFixed(1)}</span>;
    }

    case "m1": {
      const n = num(r.score_1m);
      if (n == null) return <span className="to-muted">{DASH}</span>;
      if (r.score_1m_like_for_like === false) return (
        <span className="to-muted" title="Not directly comparable — this earlier score was computed under the previous scoring method, before the score ceiling rose to 10.">
          {n.toFixed(1)}<span className="to-lfl-mark">*</span>
        </span>
      );
      return <span className="to-muted">{n.toFixed(1)}</span>;
    }

    case "insider": {
      const rules = Array.isArray(r.insider_rules) ? r.insider_rules : [];
      if (rules.length === 0 && r.insider_age_days == null) return dashSpan();
      return (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
          {rules.map((tag, i) => (
            <span key={i} className="to-rule-tag">{String(tag)}</span>
          ))}
          {r.insider_age_days != null && (
            <span className="to-sub">{Number(r.insider_age_days)}d</span>
          )}
        </span>
      );
    }

    case "dp": {
      // Dark Pool Anchor — a genuine screener output. A watchlist name the
      // screener never launched (_unscored) has no dark-pool evaluation at
      // all, so it dashes.
      if (r._unscored) return dashSpan();
      // Live since 2026-05-21: show the institutional anchor price. A
      // launched name with no dark-pool clustering data — and any legacy
      // pre-2026-05-21 row — has a null anchor and dashes.
      if (r.dark_pool_anchor == null) return dashSpan();
      return <span>${num(r.dark_pool_anchor).toFixed(2)}</span>;
    }

    case "chart":
      return <Sparkline data={r.spark} />;

    case "price": {
      const n = num(r.price);
      if (n == null || n <= 0) return dashSpan();
      return <span>${n.toFixed(2)}</span>;
    }

    case "chg": {
      const p = num(r.change_pct);
      const d = num(r.change_usd);
      if (p == null && d == null) return dashSpan();
      const pos = (p ?? 0) >= 0;
      return (
        <span className={"to-chg " + (pos ? "pos" : "neg")}>
          {p == null ? DASH : `${pos ? "+" : ""}${p.toFixed(2)}%`}
          <span className="c2">
            {d == null ? DASH : `${d >= 0 ? "+" : ""}${d.toFixed(2)}`}
          </span>
        </span>
      );
    }

    case "vol": {
      const v = fmtVolM(r.volume);
      const rv = num(r.rel_volume);
      if (v == null) return dashSpan();
      return (
        <span>
          {v.toFixed(v >= 10 ? 0 : 1)}M
          {rv != null && <span className="to-sub"> {rv.toFixed(2)}x</span>}
        </span>
      );
    }

    case "r52": {
      const lo = num(r.week_52_low);
      const hi = num(r.week_52_high);
      const cur = num(r.price);
      if (lo == null || hi == null || hi <= lo) return dashSpan();
      let pct = cur == null ? 50 : ((cur - lo) / (hi - lo)) * 100;
      pct = Math.max(0, Math.min(100, pct));
      return (
        <span className="to-rng">
          <span className="rv">{lo.toFixed(lo >= 100 ? 0 : 1)}</span>
          <span className="bar">
            <span className="dot" style={{ left: `${pct}%` }} />
          </span>
          <span className="rv">{hi.toFixed(hi >= 100 ? 0 : 1)}</span>
        </span>
      );
    }

    case "mcap":
      return <span>{fmtMcap(r.market_cap)}</span>;

    case "opts": {
      // Options Vol Shock — a genuine screener output; same treatment as
      // Dark Pool. An unscored watchlist name dashes (never evaluated).
      if (r._unscored) return dashSpan();
      // Live since 2026-05-21: show the volume-to-open-interest multiple. A
      // launched name with no options shock — and any legacy row — dashes.
      if (r.options_vol_shock == null) return dashSpan();
      return <span>{num(r.options_vol_shock).toFixed(1)}x</span>;
    }

    case "pc": {
      const n = num(r.pc_ratio);
      return n == null ? dashSpan() : <span>{n.toFixed(2)}</span>;
    }

    case "netprem": {
      const n = num(r.net_premium);
      if (n == null) return dashSpan();
      const pos = n >= 0;
      return (
        <span className={pos ? "to-up" : "to-down"}>
          {pos ? "" : "-"}${Math.abs(n).toFixed(1)}M
        </span>
      );
    }

    case "ivr": {
      const n = num(r.iv_rank);
      if (n == null) return dashSpan();
      const pct = Math.max(0, Math.min(100, n));
      // Fill color uses real theme tokens: low = muted, mid = accent, high = red.
      const fill = n <= 33 ? "var(--text-dim)"
                 : n >= 67 ? "var(--red-text)"
                 : "var(--accent)";
      return (
        <span className="to-ivr">
          <span className="ivv">{n.toFixed(0)}</span>
          <span className="bar">
            <span className="fill" style={{ width: `${pct}%`, background: fill }} />
          </span>
        </span>
      );
    }

    case "iv": {
      const n = num(r.iv);
      return n == null ? dashSpan() : <span>{n.toFixed(0)}%</span>;
    }

    case "imp7": {
      const p = num(r.implied_7d_pct);
      const d = num(r.implied_7d_usd);
      if (p == null && d == null) return dashSpan();
      return (
        <span className="to-two">
          {p == null ? DASH : `±${p.toFixed(1)}%`}
          <span className="t2">{d == null ? DASH : `±$${d.toFixed(2)}`}</span>
        </span>
      );
    }

    case "imp30": {
      const p = num(r.implied_30d_pct);
      const d = num(r.implied_30d_usd);
      if (p == null && d == null) return dashSpan();
      return (
        <span className="to-two">
          {p == null ? DASH : `±${p.toFixed(1)}%`}
          <span className="t2">{d == null ? DASH : `±$${d.toFixed(2)}`}</span>
        </span>
      );
    }

    case "rv": {
      const n = num(r.realized_vol);
      return n == null ? dashSpan() : <span>{n.toFixed(0)}%</span>;
    }

    case "mean": {
      const n = num(r.mean_return);
      if (n == null) return dashSpan();
      return (
        <span className={n >= 0 ? "to-up" : "to-down"}>{n.toFixed(2)}%</span>
      );
    }

    case "std": {
      const n = num(r.std_dev);
      return n == null ? dashSpan() : <span>&plusmn;{n.toFixed(2)}%</span>;
    }

    case "d1sd": {
      const n = num(r.daily_sigma_pct);
      return n == null ? dashSpan() : <span>&plusmn;{n.toFixed(1)}%</span>;
    }

    case "sma200": {
      const n = num(r.sma200_pct);
      if (n == null) return dashSpan();
      const up = n >= 0;
      return (
        <span className={up ? "to-up" : "to-down"}>
          {up ? `▲ +${n.toFixed(1)}%` : `▼ ${n.toFixed(1)}%`}
        </span>
      );
    }

    case "rsi": {
      const n = num(r.rsi);
      if (n == null) return dashSpan();
      return <span className={n > 65 ? "to-down" : ""}>{n.toFixed(0)}</span>;
    }

    case "ema9": {
      const n = num(r.ema9);
      return n == null ? dashSpan() : <span>${n.toFixed(2)}</span>;
    }

    case "ema21": {
      const n = num(r.ema21);
      return n == null ? dashSpan() : <span>${n.toFixed(2)}</span>;
    }

    case "sma50": {
      const n = num(r.sma50);
      return n == null ? dashSpan() : <span>${n.toFixed(2)}</span>;
    }

    case "name":
      return (
        <span
          title={r.company_name || ""}
          style={{
            display: "inline-block", maxWidth: 200, overflow: "hidden",
            textOverflow: "ellipsis", whiteSpace: "nowrap", verticalAlign: "bottom",
          }}
        >
          {r.company_name || DASH}
        </span>
      );

    case "sector":
      return <span>{r.sector || DASH}</span>;

    case "earn":
      return <span className="to-sub">{r.earnings_date ? fmtDate(r.earnings_date) : DASH}</span>;

    default:
      return dashSpan();
  }
}

// Sort value extractor — numeric columns sort by their numeric field; a few
// columns need a derived value (Change → %, Insider → rule count, 52w → price,
// Volume → shares). Chart is not sortable.
function sortValue(c, r) {
  switch (c.k) {
    case "last":    return r.last_trade_ts ? new Date(r.last_trade_ts).getTime() : null;
    case "ticker":  return r.ticker;
    case "sig":     return r.signal;
    case "score":   return num(r.score);
    case "w1":      return num(r.score_1w);
    case "m1":      return num(r.score_1m);
    case "insider": return Array.isArray(r.insider_rules) ? r.insider_rules.length : null;
    case "dp":      return num(r.dark_pool_anchor);
    case "price":   return num(r.price);
    case "chg":     return num(r.change_pct);
    case "vol":     return num(r.volume);
    case "r52":     return num(r.price);
    case "mcap":    return num(r.market_cap);
    case "opts":    return num(r.options_vol_shock);
    case "pc":      return num(r.pc_ratio);
    case "netprem": return num(r.net_premium);
    case "ivr":     return num(r.iv_rank);
    case "iv":      return num(r.iv);
    case "imp7":    return num(r.implied_7d_pct);
    case "imp30":   return num(r.implied_30d_pct);
    case "rv":      return num(r.realized_vol);
    case "mean":    return num(r.mean_return);
    case "std":     return num(r.std_dev);
    case "d1sd":    return num(r.daily_sigma_pct);
    case "sma200":  return num(r.sma200_pct);
    case "rsi":     return num(r.rsi);
    case "ema9":    return num(r.ema9);
    case "ema21":   return num(r.ema21);
    case "sma50":   return num(r.sma50);
    case "name":    return r.company_name;
    case "sector":  return r.sector;
    case "earn":    return r.earnings_date ? new Date(`${r.earnings_date}T00:00:00`).getTime() : null;
    default:        return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Results table — its own component so the useSortableTable hook is called
// at component scope (never inside an IIFE).
// ─────────────────────────────────────────────────────────────────────────

export function ResultsTable({ rows, order, hidden, onRowClick, extraCol }) {
  // Visible columns, in saved order.
  const hiddenSet = useMemo(() => new Set(hidden), [hidden]);
  const visibleCols = useMemo(
    () => order.map((k) => COL_BY_KEY[k]).filter((c) => c && !hiddenSet.has(c.k)),
    [order, hiddenSet]
  );

  // useSortableTable wants a column registry with id/align/sortValue.
  const hookColumns = useMemo(
    () => COLS.map((c) => ({
      id: c.k,
      align: c.numeric ? "right" : "left",
      sortable: c.sortable !== false,
      sortValue: (r) => sortValue(c, r),
    })),
    []
  );

  const { sorted, sortCol, sortDir, toggleSort } = useSortableTable({
    rows,
    columns: hookColumns,
    defaultColId: "score",
    defaultDir: "desc",
  });

  // Group spans across the currently-visible columns.
  const groupSpans = useMemo(() => {
    const spans = [];
    GROUPS.forEach((g) => {
      const count = visibleCols.filter((c) => c.grp === g).length;
      if (count > 0) spans.push({ group: g, count });
    });
    return spans;
  }, [visibleCols]);

  return (
    <div className="to-table-wrap">
      <table className="to-table">
        <thead>
          <tr className="to-grp-row">
            {groupSpans.map((s) => (
              <th key={s.group} colSpan={s.count}>{s.group}</th>
            ))}
            {extraCol && <th key="_x" aria-hidden="true" />}
          </tr>
          <tr className="to-col-row">
            {visibleCols.map((c) => {
              const active = sortCol === c.k;
              return (
                <th
                  key={c.k}
                  className={c.drv ? "drv" : undefined}
                  onClick={() => { if (c.sortable !== false) toggleSort(c.k); }}
                  style={{ cursor: c.sortable === false ? "default" : "pointer" }}
                  aria-sort={active ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
                >
                  <HeaderTip tip={c.tip}>
                    <span>{c.lbl}</span>
                    {c.sortable !== false && (
                      <span className="to-ar">
                        <SortArrow dir={active ? sortDir : null} />
                      </span>
                    )}
                  </HeaderTip>
                </th>
              );
            })}
            {extraCol && <th key="_x" aria-hidden="true" />}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr
              key={r.ticker}
              className="to-row"
              onClick={() => onRowClick(r.ticker)}
            >
              {visibleCols.map((c) => (
                <td key={c.k} className={c.drv ? "drv" : undefined}>
                  {renderCell(c, r)}
                </td>
              ))}
              {extraCol && (
                <td key="_x" onClick={(e) => e.stopPropagation()}>
                  {extraCol.render(r)}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Scoped stylesheet — translated from the locked mockup. Mockup-only tokens
// (--drv shade, --track) are mapped to real theme tokens that exist in both
// the light :root and the dark blocks of theme.css.
// ─────────────────────────────────────────────────────────────────────────

export const PAGE_CSS = `
.to-shell { max-width: 1500px; margin: 0 auto; padding: 0 32px; }

/* ── Today's Scan Results tile (hero right slot) ── */
.to-scan-tile {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-md, 16px);
  padding: 16px 20px;
  box-shadow: var(--shadow-sm);
}
.to-scan-tile-head {
  display: flex; justify-content: space-between; align-items: baseline;
  border-bottom: 1px solid var(--border-faint);
  padding-bottom: 8px; margin-bottom: 12px;
}
.to-scan-tile-head h3 {
  font-family: var(--font-display); font-weight: 500; font-size: 15px;
  margin: 0; color: var(--text);
}
.to-scan-tile-head span { font-size: 11px; color: var(--text-dim); }
/* Bug #1200 — staleness flag: amber when 1 trading day behind, red when 2+. */
.to-stale-flag {
  display: flex; align-items: center; gap: 7px;
  margin: -4px 0 12px; padding: 6px 9px;
  border-radius: 6px; font-size: 10.5px; line-height: 1.35;
}
.to-stale-flag.stale {
  background: rgba(255, 159, 10, 0.10);
  border: 1px solid var(--orange-text);
  color: var(--orange-text);
}
.to-stale-flag.very-stale {
  background: rgba(200, 70, 88, 0.10);
  border: 1px solid var(--red);
  color: var(--red-text);
}
.to-stale-dot {
  flex: none; width: 7px; height: 7px; border-radius: 50%;
  background: currentColor;
}
.to-stale-text { font-weight: 600; }
.to-funnel-row {
  display: flex; justify-content: space-between;
  font-size: 12.5px; padding: 5px 0;
}
.to-funnel-row .lbl { color: var(--text-muted); }
.to-funnel-row .val { font-weight: 600; color: var(--text); }
.to-scan-bands { display: flex; gap: 8px; margin-top: 12px; }
.to-band { flex: 1; text-align: center; border-radius: var(--radius-sm, 10px); padding: 8px 0; }
.to-band .bn { font-size: 18px; font-weight: 700; line-height: 1; }
.to-band .bl {
  font-size: 9.5px; letter-spacing: .04em; text-transform: uppercase; margin-top: 2px;
}
.to-band-5 { background: var(--green); color: #fff; }
.to-band-4 { background: var(--accent); color: #fff; }
.to-band-3 {
  background: var(--surface-2); color: var(--text-2);
  border: 1px solid var(--border-strong);
}

/* ── Controls row ── */
.to-controls {
  display: flex; align-items: center; justify-content: space-between;
  gap: 16px; margin-bottom: 8px; flex-wrap: wrap;
}
.to-chipset { display: flex; align-items: center; gap: 8px; }
.to-chip-group {
  display: flex; gap: 4px;
  background: var(--surface-2); border: 1px solid var(--border);
  border-radius: var(--radius-sm, 10px); padding: 3px;
}
.to-chip {
  font-size: 12px; font-weight: 500; color: var(--text-muted);
  background: transparent; border: none; border-radius: 7px;
  padding: 5px 11px; cursor: pointer; white-space: nowrap;
  font-family: var(--font-ui);
}
.to-chip.on { background: var(--surface-solid); color: var(--text); box-shadow: var(--shadow-sm); }
.to-chip.dim { color: var(--text-dim); cursor: not-allowed; }
.to-chip-sep { width: 1px; height: 18px; background: var(--border); margin: 0 4px; }
.to-cust-btn {
  font-size: 12px; font-weight: 500; color: var(--text-2);
  background: var(--surface-2); border: 1px solid var(--border);
  border-radius: var(--radius-sm, 10px); padding: 7px 12px; cursor: pointer;
  font-family: var(--font-ui);
}
.to-cust-btn:hover { background: var(--hover); }
.to-legend {
  font-size: 11px; color: var(--text-dim); margin: 0 0 12px;
  display: flex; align-items: center; gap: 6px;
}
.to-legend .sw {
  width: 13px; height: 13px; border-radius: 3px;
  background: var(--accent-soft); border: 1px solid var(--border-strong);
  display: inline-block;
}

/* ── Bug #1149 — Asset Tilt deep-link chip ── */
.to-iglink-chip {
  display: inline-flex; align-items: center; gap: 8px;
  margin: 4px 0 10px; padding: 6px 8px 6px 12px;
  background: var(--accent-soft); border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm, 10px);
  font-size: 12px; color: var(--text-2);
}
.to-iglink-text strong { color: var(--text); font-weight: 600; }
.to-iglink-x {
  display: inline-flex; align-items: center; justify-content: center;
  width: 18px; height: 18px; border-radius: 50%;
  background: var(--surface-2); border: 1px solid var(--border);
  color: var(--text-muted); font-size: 13px; line-height: 1;
  cursor: pointer; padding: 0; font-family: var(--font-ui);
}
.to-iglink-x:hover { background: var(--hover); color: var(--text); }

/* ── Table ── */
.to-table-wrap {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-md, 16px);
  overflow-x: auto;
  box-shadow: var(--shadow-sm);
}
.to-table {
  border-collapse: collapse; font-size: 12px; white-space: nowrap;
  width: 100%; font-family: var(--font-ui);
}
.to-grp-row th {
  font-size: 9.5px; font-weight: 700; letter-spacing: .13em; text-transform: uppercase;
  padding: 7px 12px; text-align: center;
  background: var(--surface-2); color: var(--text-dim);
  border-bottom: 1px solid var(--border); border-left: 1px solid var(--border);
}
.to-grp-row th:first-child { border-left: none; }
.to-col-row th {
  font-size: 10px; font-weight: 600; letter-spacing: .02em; text-transform: uppercase;
  color: var(--text-dim); padding: 7px 12px; text-align: left;
  background: var(--surface-2); border-bottom: 1px solid var(--border);
  user-select: none;
}
.to-col-row th:hover { color: var(--text-2); }
.to-col-row th.drv, .to-table td.drv { background: var(--accent-soft); }
.to-ar { font-size: 8px; }
.to-table td {
  padding: 7px 12px; vertical-align: middle;
  border-bottom: 1px solid var(--border-faint); color: var(--text-2);
}
.to-table tr.to-row:last-child td { border-bottom: none; }
.to-table tr.to-row { cursor: pointer; }
.to-table tr.to-row:hover td { background: var(--hover); }
.to-table tr.to-row:hover td.drv { filter: brightness(1.07); }

.to-sub { font-size: 9.5px; color: var(--text-dim); }
.to-tk { font-weight: 700; font-size: 13px; color: var(--text); }
.to-muted { color: var(--text-dim); }
.to-up { color: var(--green-text); }
.to-down { color: var(--red-text); }

.to-sig {
  font-size: 9px; font-weight: 700; letter-spacing: .04em;
  color: var(--green-text); background: var(--accent-soft);
  border-radius: 4px; padding: 2px 5px;
}
.to-score {
  display: inline-flex; align-items: baseline; gap: 2px;
  padding: 3px 7px; border-radius: var(--radius-sm, 10px); font-weight: 700;
}
.to-score .sv { font-size: 13px; }
.to-score .sm { font-size: 8px; font-weight: 600; opacity: .7; }
.to-score-5 { background: var(--green); color: #fff; }
.to-score-4 { background: var(--accent); color: #fff; }
.to-score-3 {
  background: var(--surface-2); color: var(--text-2);
  border: 1px solid var(--border-strong);
}
.to-chg {
  display: inline-block; border-radius: var(--radius-xs, 6px);
  padding: 3px 7px; font-weight: 600; font-size: 11px; text-align: right;
}
.to-chg.pos { background: var(--accent-soft); color: var(--green-text); }
.to-chg.neg { background: var(--accent-soft); color: var(--red-text); }
.to-chg .c2 { display: block; font-size: 9px; font-weight: 500; opacity: .85; }
.to-rng { display: flex; align-items: center; gap: 6px; font-size: 9.5px; color: var(--text-dim); }
.to-rng .rv { font-variant-numeric: tabular-nums; }
.to-rng .bar {
  position: relative; width: 78px; height: 3px;
  background: var(--surface-3); border-radius: 2px;
}
.to-rng .dot {
  position: absolute; top: 50%; width: 8px; height: 8px; border-radius: 50%;
  background: var(--accent); transform: translate(-50%, -50%);
}
.to-ivr { display: flex; align-items: center; gap: 6px; }
.to-ivr .ivv { font-weight: 700; }
.to-ivr .bar {
  width: 50px; height: 4px; background: var(--surface-3);
  border-radius: 2px; overflow: hidden;
}
.to-ivr .fill { height: 100%; border-radius: 2px; }
.to-two { line-height: 1.25; }
.to-two .t2 { display: block; font-size: 9.5px; color: var(--text-dim); }
.to-rule-tag {
  display: inline-block; font-size: 9px; font-weight: 700;
  color: var(--accent); background: var(--accent-soft);
  border-radius: 4px; padding: 1px 4px;
}

/* ── Column customizer panel ── */
.to-cust-wrap { position: relative; }
.to-cust-panel {
  position: absolute; right: 0; top: calc(100% + 6px); z-index: 60;
  width: 300px; max-height: 460px; overflow-y: auto;
  background: var(--surface-solid); border: 1px solid var(--border-strong);
  border-radius: var(--radius-md, 16px); box-shadow: var(--shadow-lg);
  font-family: var(--font-ui);
}
.to-cust-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 14px 8px; font-size: 12px; font-weight: 600; color: var(--text);
}
.to-cust-close {
  background: var(--surface-2); border: 1px solid var(--border);
  border-radius: 50%; width: 22px; height: 22px; cursor: pointer;
  color: var(--text-muted); font-size: 13px; line-height: 1;
}
.to-cust-hint {
  padding: 0 14px 8px; font-size: 10.5px; color: var(--text-dim);
  border-bottom: 1px solid var(--border-faint);
}
.to-cust-body { padding: 8px 10px 12px; }
.to-cust-group { margin-bottom: 6px; }
.to-cust-group-label {
  font-size: 9.5px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase;
  color: var(--text-dim); padding: 8px 4px 4px;
}
.to-cust-item {
  display: flex; align-items: center; gap: 6px;
  padding: 4px 6px; border-radius: var(--radius-xs, 6px);
}
.to-cust-item:hover { background: var(--hover); }
.to-cust-item.dragging { opacity: .5; }
.to-cust-grip {
  cursor: grab; color: var(--text-dim); font-size: 10px;
  letter-spacing: -3px; user-select: none;
}
.to-cust-check {
  display: flex; align-items: center; gap: 7px;
  font-size: 12px; color: var(--text-2); cursor: pointer; flex: 1;
}
.to-cust-check input { accent-color: var(--accent); cursor: pointer; }

/* ── States ── */
.to-state {
  padding: 32px; font-size: 13px; text-align: center;
  border: 1px solid var(--border); border-radius: var(--radius-md, 16px);
  background: var(--surface); margin-top: 24px;
}
.to-foot {
  margin: 24px 0; padding-top: 16px; border-top: 1px solid var(--border-faint);
  font-size: 11px; color: var(--text-dim);
}
.to-disclaimer {
  margin: 12px 0 4px; padding: 12px 14px;
  background: var(--surface); border: 1px solid var(--border);
  border-left: 3px solid var(--accent);
  border-radius: var(--radius-md, 10px);
  font-size: 12px; line-height: 1.55; color: var(--text-2, var(--text-dim));
}
.to-disclaimer strong { color: var(--text); font-weight: 600; }
.to-lfl-mark { color: var(--accent); font-weight: 700; margin-left: 1px; }
`;

// ─────────────────────────────────────────────────────────────────────────
// Page.
// ─────────────────────────────────────────────────────────────────────────

const HERO_TITLE = (
  <>
    Cutting through the noise with <em>proprietary signal intelligence</em> to
    identify trading opportunities &ndash; 5 signals rolled into an overall{" "}
    <em>MacroTilt Score</em>.
  </>
);

const HERO_BULLETS = [
  "Full universe scan of U.S. equities",
  "Filter out stocks trading under $1.5M of value per day",
  "Apply indicator logic (e.g., C-suite insider buying, 200-day trend, RSI momentum)",
  "Compute a single MacroTilt Score",
];

const BAND_CHIPS = [
  { value: "all", label: "All" },
  { value: 5,     label: "Score 7+" },
  { value: 4,     label: "Score 5–6" },
  { value: 3,     label: "Score 3–4" },
];

export default function TradingOppsPage({ onOpenTicker }) {
  const { rows, scanDate, loading, error, universeScanned, gateCleared } = useScanData();

  const [bandFilter, setBandFilter] = useState("all");
  const [colState, setColState] = useState(() => loadColState());
  const [custOpen, setCustOpen] = useState(false);

  // Bug #1149 — industry-group deep-link from Asset Tilt (#portopps?ig=<id>).
  // Initialised from the hash on mount, kept in sync on hashchange so a
  // back/forward or a fresh deep-link re-applies the filter. Dismissing the
  // chip clears both the state and the ?ig= segment from the URL.
  const [igDeeplink, setIgDeeplink] = useState(() => readIgDeeplink());
  useEffect(() => {
    const onHashChange = () => setIgDeeplink(readIgDeeplink());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);
  const clearIgDeeplink = () => {
    setIgDeeplink(null);
    // Drop the ?ig= segment but stay on the Trading Opportunities tab.
    if (typeof window !== "undefined") window.location.hash = "#portopps";
  };

  const updateColState = (next) => {
    setColState(next);
    saveColState(next);
  };

  // Band counts off the loaded rows (one row per launched stock).
  const counts = useMemo(() => {
    let b5 = 0, b4 = 0, b3 = 0;
    for (const r of rows) {
      const b = scoreBand(r.score);
      if (b === 5) b5++; else if (b === 4) b4++; else b3++;
    }
    return { b5, b4, b3, active: rows.length };
  }, [rows]);

  // Rows filtered by the active band chip and, if a deep-link is active, the
  // industry group's screener sector (bug #1149). Both filters compose.
  const filteredRows = useMemo(() => {
    let out = rows;
    if (igDeeplink) {
      out = out.filter((r) => r.sector === igDeeplink.sector);
    }
    if (bandFilter !== "all") {
      out = out.filter((r) => scoreBand(r.score) === bandFilter);
    }
    return out;
  }, [rows, bandFilter, igDeeplink]);

  const openTicker = (ticker) => {
    if (typeof onOpenTicker === "function") onOpenTicker(ticker);
  };

  return (
    <div style={{ minHeight: "100vh" }}>
      <style>{PAGE_CSS}</style>

      <PageHero
        eyebrow="Trading Opportunities"
        title={HERO_TITLE}
        bullets={HERO_BULLETS}
        right={
          <ScanTile
            scanDate={scanDate}
            universeScanned={universeScanned}
            gateCleared={gateCleared}
            activeAlerts={counts.active}
            band5={counts.b5}
            band4={counts.b4}
            band3={counts.b3}
          />
        }
      />

      <div className="to-shell">
        {/* Controls row — direction chips + band chips, then Columns button */}
        <div className="to-controls">
          <div className="to-chipset">
            <div className="to-chip-group">
              <button className="to-chip on" type="button">Long</button>
              <button
                className="to-chip dim"
                type="button"
                disabled
                title="Short signals — auto-activates when validated"
              >
                Short &middot; inactive
              </button>
            </div>
            <div className="to-chip-sep" />
            <div className="to-chip-group">
              {BAND_CHIPS.map((chip) => (
                <button
                  key={String(chip.value)}
                  type="button"
                  className={"to-chip" + (bandFilter === chip.value ? " on" : "")}
                  onClick={() => setBandFilter(chip.value)}
                >
                  {chip.label}
                </button>
              ))}
            </div>
          </div>
          <div className="to-cust-wrap">
            <button
              className="to-cust-btn"
              type="button"
              onClick={() => setCustOpen((v) => !v)}
            >
              &#9783; Columns &mdash; show / hide / reorder
            </button>
            {custOpen && (
              <ColumnCustomizer
                order={colState.order}
                hidden={colState.hidden}
                onChange={updateColState}
                onClose={() => setCustOpen(false)}
              />
            )}
          </div>
        </div>

        {/* Bug #1149 — dismissible deep-link chip. Present only when the
            page was opened from an Asset Tilt industry-group hand-off. */}
        {igDeeplink && (
          <div className="to-iglink-chip" role="status">
            <span className="to-iglink-text">
              From Asset Tilt: <strong>{igDeeplink.name}</strong>
            </span>
            <button
              type="button"
              className="to-iglink-x"
              onClick={clearIgDeeplink}
              aria-label="Clear the Asset Tilt filter"
            >
              &times;
            </button>
          </div>
        )}

        <div className="to-legend">
          <span className="sw" />
          Shaded columns feed the score &mdash; Insider Activity, Dark Pool
          Anchor, Options Vol Shock, SMA200, RSI.
        </div>

        <div className="to-disclaimer">
          <strong>Scoring updated 21 May 2026.</strong> The dark-pool and
          options layers are now live, raising the score ceiling from 5 to 10.
          These two layers are <strong>not yet backtested</strong> &mdash; they
          do not have enough of their own history yet. Their point values
          follow the screener specification and have been sanity-checked by the
          Senior Quant; treat them as developing signals. Because the ceiling
          changed, any Score&nbsp;1W or Score&nbsp;1M figure from before this
          date is marked with an asterisk (*) &mdash; it was scored on the old
          5-point scale and is not directly comparable.
        </div>

        {/* States */}
        {loading && (
          <div className="to-state" style={{ color: "var(--text-muted)" }}>
            Loading scan&hellip;
          </div>
        )}
        {!loading && error && (
          <div
            className="to-state"
            style={{ color: "var(--red-text)", borderColor: "var(--red)" }}
          >
            Could not load the scan results. Please try again shortly.
          </div>
        )}
        {!loading && !error && rows.length === 0 && (
          <div className="to-state" style={{ color: "var(--text-muted)" }}>
            No scan results yet &mdash; the daily scan runs after market close.
            Once it completes, the opportunities will populate here automatically.
          </div>
        )}

        {/* Table */}
        {!loading && !error && rows.length > 0 && (
          <div style={{ marginTop: 4 }}>
            {filteredRows.length === 0 ? (
              <div className="to-state" style={{ color: "var(--text-muted)" }}>
                {igDeeplink
                  ? `No ${igDeeplink.name} stocks in today's scan.`
                  : "No stocks in this score band today."}
              </div>
            ) : (
              <ResultsTable
                rows={filteredRows}
                order={colState.order}
                hidden={colState.hidden}
                onRowClick={openTicker}
              />
            )}
          </div>
        )}

        <div className="to-foot">
          33 columns across five groups &mdash; scroll right for Statistics,
          Technicals and Info. Click any row to open the full stock view.
        </div>
      </div>
    </div>
  );
}
