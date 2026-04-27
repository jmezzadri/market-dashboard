// PositionsTable — sortable, user-customizable positions grid.
//
// Item 36 rewrite: columns are now a registry, users can drag-reorder headers
// and show/hide columns via the "Edit columns" picker. Layout preferences
// persist per user to public.user_preferences (see useTablePreferences).
//
// Props
// -----
//   rows          : Array<raw position> (from App.jsx heldPositions).
//                   Shape: { id, accountId, ticker, name, sector, price,
//                            avgCost, shares, value, beta, acctLabel,
//                            purchaseDate }
//   grandTotal    : total wealth for % of wealth column
//   screener      : { TICKER: { close, prev_close, marketcap, next_earnings_date,... } }
//                   Used for PNL DAY, Market Cap, Next Earnings lookups.
//   info          : { TICKER: { next_earnings_date, marketcap, dividend_yield, has_dividend,... } }
//                   Used as a fallback when screener row isn't present.
//   onOpenTicker  : fn(ticker) — open detail modal
//   onAdd, onBulkImport, onEdit, onClose, onDelete — action bar / row buttons.
//                   onClose ships proceeds to a cash row via the
//                   close_position RPC; onDelete is data-cleanup only.
//   emptyMessage  : string shown when rows is empty
//
// Column registry
// ---------------
// Every column is { id, label, description, align, type, pinned?, getValue,
// renderCell }. `getValue` is used for sort comparisons; `renderCell` turns
// the value into a JSX node. Pinned columns (actions) can't be hidden or
// reordered.
//
// Data sources per column (see useTablePreferences for how user preferences
// merge with these defaults):
//   ticker, name, sector, shares, price, avgCost, pnl$, pnlPct, wealthPct,
//   account, beta, purchaseDate  →  the row itself
//   totalCost, currentValue       →  derived (shares × avgCost / price)
//   pnlDay$, pnlDayPct            →  screener[T].close / prev_close
//   holdingDays, annualizedPnl    →  derived from purchaseDate
//   marketcap, nextEarnings       →  screener[T] or info[T]
//   divYield                      →  info[T].dividend_yield (may be null
//                                    until a follow-up scan-ticker pass
//                                    populates it)

import { useMemo, useState } from "react";
import useRiskMetricsBatch from "../hooks/useRiskMetricsBatch";
import { Tip } from "../InfoTip";
import TableColumnPicker from "./TableColumnPicker";
import TableFootnote from "./TableFootnote";
import { useTablePreferences } from "../hooks/useTablePreferences";

// ─── formatters ──────────────────────────────────────────────────────────────
const fmt$Full = (v) =>
  v == null || !isFinite(v) ? "—" :
  `$${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fmt$Signed = (v) =>
  v == null || !isFinite(v) ? "—" :
  (v >= 0 ? "+" : "−") +
  `$${Math.abs(Number(v)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fmtPctSigned = (v, digits = 1) =>
  v == null || !isFinite(v) ? "—" :
  `${v >= 0 ? "+" : ""}${Number(v).toFixed(digits)}%`;

const fmtPct = (v, digits = 1) =>
  v == null || !isFinite(v) ? "—" :
  `${Number(v).toFixed(digits)}%`;

const fmtShares = (v) =>
  v == null || !isFinite(v) ? "—" :
  Number(v).toLocaleString(undefined, {
    minimumFractionDigits: Number.isInteger(v) ? 0 : 2,
    maximumFractionDigits: 4,
  });

// Compact market-cap: 1.47T, 180.6M, 42B, etc.
const fmtMarketCap = (v) => {
  if (v == null) return "—";
  const n = Number(v);
  if (!isFinite(n) || n <= 0) return "—";
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9)  return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6)  return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3)  return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
};

const fmtDate = (v) => {
  // Item #16: standardize to MM/DD/YYYY across all date columns (purchaseDate,
  // nextEarnings). Using a locale-independent pad so server TZ / user locale
  // never flips "Apr 6, 2026" vs "04/06/2026" spelling.
  if (!v) return "—";
  try {
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return "—";
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const yyyy = d.getFullYear();
    return `${mm}/${dd}/${yyyy}`;
  } catch {
    return "—";
  }
};

function daysBetween(from, to) {
  if (!from) return null;
  const a = new Date(from);
  const b = to ? new Date(to) : new Date();
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
  const ms = b.getTime() - a.getTime();
  return Math.max(0, Math.floor(ms / 86400000));
}

function annualizedPct(currentValue, totalCost, holdingDays) {
  if (!totalCost || !currentValue || !holdingDays || holdingDays <= 0) return null;
  const ratio = currentValue / totalCost;
  if (ratio <= 0) return null;
  const years = holdingDays / 365;
  if (years <= 0) return null;
  return (Math.pow(ratio, 1 / years) - 1) * 100;
}

const pnlColor = (v) =>
  v == null ? "var(--text-muted)" : v >= 0 ? "#30d158" : "#ff453a";
const betaColor = (v) =>
  v == null ? "var(--text-dim)"
  : v > 1.5 ? "#ff453a"
  : v > 1.0 ? "#ff9f0a"
  : v > 0.5 ? "#B8860B" : "#30d158";

function SortArrow({ dir }) {
  if (!dir) return <span style={{ opacity: 0.3, marginLeft: 4 }}>↕</span>;
  return <span style={{ marginLeft: 4, color: "var(--text)" }}>{dir === "asc" ? "▲" : "▼"}</span>;
}

// Item 41: format an option row's ticker cell into a compact spec so the
// PositionsTable row reads "AAPL 04/17/26 $250 C LONG" instead of just "AAPL".
// Non-option rows fall through to the bare ticker.
function displayTicker(r) {
  if (r.assetClass !== "option") return r.ticker;
  const parts = [r.ticker];
  if (r.expiration) {
    // YYYY-MM-DD → MM/DD/YY
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(r.expiration);
    if (m) parts.push(`${m[2]}/${m[3]}/${m[1].slice(2)}`);
  }
  if (r.strike != null) parts.push(`$${Number(r.strike)}`);
  if (r.contractType) parts.push(String(r.contractType).toUpperCase().slice(0, 1));
  if (r.direction)    parts.push(String(r.direction).toUpperCase());
  return parts.join(" ");
}

// ─── column registry ─────────────────────────────────────────────────────────
// Values are computed up-front in the `enrich` step below and then read by
// both the sort comparator (via `sortValue`) and `renderCell`.
const COLUMNS = [
  {
    id: "ticker",
    label: "TICKER",
    description: "Ticker symbol",
    align: "left",
    sortValue: (r) => r.ticker,
    renderCell: (r) => (
      <span style={{ fontFamily: "var(--font-mono)", fontWeight: 700, color: "var(--text)" }}>
        {displayTicker(r)}
      </span>
    ),
  },
  {
    id: "name",
    label: "NAME",
    description: "Company or fund name",
    align: "left",
    sortValue: (r) => (r.name || "").toLowerCase(),
    renderCell: (r) => (
      <span style={{
        color: "var(--text-muted)", maxWidth: 220, display: "inline-block",
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        verticalAlign: "bottom",
      }} title={r.name}>{r.name || "—"}</span>
    ),
  },
  {
    id: "sector",
    label: "SECTOR",
    description: "Sector / asset class",
    align: "left",
    sortValue: (r) => (r.sector || "").toLowerCase(),
    renderCell: (r) => (
      <span style={{ color: "var(--text-dim)", fontFamily: "var(--font-mono)", fontSize: 11, whiteSpace: "nowrap" }}>
        {r.sector || "—"}
      </span>
    ),
  },
  {
    id: "quantity",
    label: "QTY",
    description: "Total quantity held (shares for equities; units for crypto; dollars for cash)",
    align: "right",
    sortValue: (r) => r.quantity,
    renderCell: (r) => (
      <span style={{ fontFamily: "var(--font-mono)", color: "var(--text)" }}>
        {fmtShares(r.quantity)}
      </span>
    ),
  },
  {
    id: "price",
    label: "PRICE/SHARE",
    description: "Current market price per share",
    align: "right",
    sortValue: (r) => r.price,
    renderCell: (r) => (
      <span style={{ fontFamily: "var(--font-mono)", color: "var(--text)" }}>
        {fmt$Full(r.price)}
      </span>
    ),
  },
  {
    id: "avgCost",
    label: "COST/SHARE",
    description: "Average cost paid per share",
    align: "right",
    sortValue: (r) => r.avgCost,
    renderCell: (r) => (
      <span style={{ fontFamily: "var(--font-mono)", color: "var(--text-muted)" }}>
        {fmt$Full(r.avgCost)}
      </span>
    ),
  },
  {
    id: "totalCost",
    label: "TOTAL COST",
    description: "shares × avg cost — what you paid in aggregate",
    align: "right",
    sortValue: (r) => r.totalCost,
    renderCell: (r) => (
      <span style={{ fontFamily: "var(--font-mono)", color: "var(--text-muted)" }}>
        {fmt$Full(r.totalCost)}
      </span>
    ),
  },
  {
    id: "currentValue",
    label: "CURRENT VALUE",
    description: "shares × current price — what it's worth now",
    align: "right",
    sortValue: (r) => r.currentValue,
    renderCell: (r) => (
      <span style={{ fontFamily: "var(--font-mono)", color: "var(--text)" }}>
        {fmt$Full(r.currentValue)}
      </span>
    ),
  },
  {
    id: "pnlDay$",
    label: "PNL DAY $",
    description: "Today's dollar change on this position",
    align: "right",
    sortValue: (r) => r.pnlDay$,
    renderCell: (r) => (
      <span style={{ fontFamily: "var(--font-mono)", color: pnlColor(r.pnlDay$), fontWeight: 600 }}>
        {fmt$Signed(r.pnlDay$)}
      </span>
    ),
  },
  {
    id: "pnlDayPct",
    label: "PNL DAY %",
    description: "Today's percent change on this position",
    align: "right",
    sortValue: (r) => r.pnlDayPct,
    renderCell: (r) => (
      <span style={{ fontFamily: "var(--font-mono)", color: pnlColor(r.pnlDayPct), fontWeight: 600 }}>
        {fmtPctSigned(r.pnlDayPct)}
      </span>
    ),
  },
  {
    id: "pnl$",
    label: "TOTAL PNL $",
    description: "Unrealized gain/loss in dollars (current value − total cost)",
    align: "right",
    sortValue: (r) => r.pnl$,
    renderCell: (r) => (
      <span style={{ fontFamily: "var(--font-mono)", color: pnlColor(r.pnl$), fontWeight: 600 }}>
        {fmt$Signed(r.pnl$)}
      </span>
    ),
  },
  {
    id: "pnlPct",
    label: "PNL %",
    description: "Unrealized gain/loss percent (price / cost − 1)",
    align: "right",
    sortValue: (r) => r.pnlPct,
    renderCell: (r) => (
      <span style={{ fontFamily: "var(--font-mono)", color: pnlColor(r.pnlPct), fontWeight: 600 }}>
        {fmtPctSigned(r.pnlPct)}
      </span>
    ),
  },
  {
    id: "beta",
    label: "BETA",
    description: "Position beta vs. SPY (where available)",
    align: "right",
    sortValue: (r) => r.beta,
    renderCell: (r) => (
      <span style={{ fontFamily: "var(--font-mono)", color: betaColor(r.beta) }}>
        {r.beta == null ? "—" : Number(r.beta).toFixed(2)}
      </span>
    ),
  },
  {
    id: "purchaseDate",
    label: "PURCHASE DATE",
    description: "Date position was acquired. Optional — enables Holding Period and Annualized PnL columns.",
    align: "right",
    sortValue: (r) => r.purchaseDate ? new Date(r.purchaseDate).getTime() : null,
    renderCell: (r) => (
      <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-dim)" }}>
        {fmtDate(r.purchaseDate)}
      </span>
    ),
  },
  {
    id: "holdingDays",
    label: "HOLDING PERIOD (DAYS)",
    description: "Days since purchase date. Empty if no purchase date set.",
    align: "right",
    sortValue: (r) => r.holdingDays,
    renderCell: (r) => (
      <span style={{ fontFamily: "var(--font-mono)", color: "var(--text-muted)" }}>
        {r.holdingDays == null ? "—" : r.holdingDays.toLocaleString()}
      </span>
    ),
  },
  {
    id: "annualizedPnl",
    label: "ANNUALIZED PNL %",
    description: "((current value / total cost) ^ (365 / holding days)) − 1. Needs purchase date.",
    align: "right",
    sortValue: (r) => r.annualizedPnl,
    renderCell: (r) => (
      <span style={{ fontFamily: "var(--font-mono)", color: pnlColor(r.annualizedPnl), fontWeight: 600 }}>
        {fmtPctSigned(r.annualizedPnl)}
      </span>
    ),
  },
  {
    id: "wealthPct",
    label: "% OF TOTAL WEALTH",
    description: "Current value as % of total portfolio value",
    align: "right",
    sortValue: (r) => r.wealthPct,
    renderCell: (r) => (
      <span style={{ fontFamily: "var(--font-mono)", color: "var(--text)" }}>
        {fmtPct(r.wealthPct)}
      </span>
    ),
  },
  {
    id: "account",
    label: "ACCOUNT",
    description: "Account holding this position",
    align: "left",
    sortValue: (r) => (r.acctLabel || "").toLowerCase(),
    renderCell: (r) => (
      <span style={{ color: "var(--text-dim)", fontFamily: "var(--font-mono)", fontSize: 11, whiteSpace: "nowrap" }}>
        {r.acctLabel || "—"}
      </span>
    ),
  },
  {
    id: "marketcap",
    label: "MARKET CAP",
    description: "Company market capitalization (from latest scan)",
    align: "right",
    sortValue: (r) => r.marketcap,
    renderCell: (r) => (
      <span style={{ fontFamily: "var(--font-mono)", color: "var(--text-muted)" }}>
        {fmtMarketCap(r.marketcap)}
      </span>
    ),
  },
  {
    id: "divYield",
    label: "DIV YIELD",
    description: "Dividend yield, when available. 'Y' / 'N' shown if only has-dividend flag is known.",
    align: "right",
    sortValue: (r) => r.divYield != null ? r.divYield : (r.hasDividend ? 0.001 : null),
    renderCell: (r) => {
      if (r.divYield != null && isFinite(r.divYield)) {
        return (
          <span style={{ fontFamily: "var(--font-mono)", color: "var(--text-muted)" }}>
            {fmtPct(r.divYield * (r.divYield < 1 ? 100 : 1), 2)}
          </span>
        );
      }
      if (r.hasDividend === true) {
        return <span style={{ fontFamily: "var(--font-mono)", color: "var(--text-dim)" }}>Y</span>;
      }
      if (r.hasDividend === false) {
        return <span style={{ fontFamily: "var(--font-mono)", color: "var(--text-dim)" }}>N</span>;
      }
      return <span style={{ fontFamily: "var(--font-mono)", color: "var(--text-dim)" }}>—</span>;
    },
  },
  {
    id: "nextEarnings",
    label: "NEXT EARNINGS",
    description: "Next expected earnings report date",
    align: "right",
    sortValue: (r) => r.nextEarnings ? new Date(r.nextEarnings).getTime() : null,
    renderCell: (r) => (
      <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-dim)" }}>
        {fmtDate(r.nextEarnings)}
      </span>
    ),
  },
  {
    id: "beta_2y",
    label: "BETA · 2Y",
    description: "Beta vs S&P 500 (SPY), 2-year weekly OLS regression. 1.0 = moves with market; >1.0 amplifies; <1.0 dampens.",
    align: "right",
    sortValue: (r) => r._risk?.beta ?? null,
    renderCell: (r) => {
      const v = r._risk?.beta;
      if (v == null) return <span style={{color:"var(--text-dim)"}}>—</span>;
      const col = v > 1.3 ? "var(--orange-text)" : v < 0.6 ? "var(--yellow-text)" : "var(--text)";
      return <span style={{ fontFamily: "var(--font-mono)", color: col }}>{v.toFixed(2)}</span>;
    },
  },
  {
    id: "annVol_2y",
    label: "ANN VOL",
    description: "Annualized volatility — 2Y daily standard deviation × √252. Roughly: 15-25% normal for diversified equities; 25-40% elevated; >40% high-beta single-name territory.",
    align: "right",
    sortValue: (r) => r._risk?.annVol ?? null,
    renderCell: (r) => {
      const v = r._risk?.annVol;
      if (v == null) return <span style={{color:"var(--text-dim)"}}>—</span>;
      const col = v > 0.40 ? "var(--red-text)" : v > 0.25 ? "var(--orange-text)" : "var(--text)";
      return <span style={{ fontFamily: "var(--font-mono)", color: col }}>{(v*100).toFixed(1)}%</span>;
    },
  },
  {
    id: "maxDD_2y",
    label: "MAX DD",
    description: "Largest peak-to-trough decline over the last 2 years. Captures worst-case capital impairment without selling.",
    align: "right",
    sortValue: (r) => r._risk?.maxDD ?? null,
    renderCell: (r) => {
      const v = r._risk?.maxDD;
      if (v == null) return <span style={{color:"var(--text-dim)"}}>—</span>;
      const col = v > 0.40 ? "var(--red-text)" : v > 0.25 ? "var(--orange-text)" : "var(--text)";
      return <span style={{ fontFamily: "var(--font-mono)", color: col }}>{(v*100).toFixed(1)}%</span>;
    },
  },
  {
    id: "var10d99",
    label: "10D 99% VaR",
    description: "10-day 99% historical Value-at-Risk from 2Y daily rolling 10-day returns, 1st percentile.",
    align: "right",
    sortValue: (r) => r._risk?.var10d99 ?? null,
    renderCell: (r) => {
      const v = r._risk?.var10d99;
      if (v == null) return <span style={{color:"var(--text-dim)"}}>—</span>;
      const col = v > 0.20 ? "var(--red-text)" : v > 0.10 ? "var(--orange-text)" : "var(--text)";
      const $var = r.currentValue != null ? r.currentValue * v : null;
      return (
        <span style={{ fontFamily: "var(--font-mono)", color: col }}>
          {(v*100).toFixed(1)}%
          {$var != null && <span style={{color:"var(--text-muted)", marginLeft:6}}>(${Math.round($var).toLocaleString()})</span>}
        </span>
      );
    },
  },
  {
    // Pinned rightmost, always visible, never draggable.
    id: "actions",
    label: "ACTIONS",
    description: "Edit / delete this position",
    align: "right",
    pinned: true,
    sortable: false,
    sortValue: () => null,
    renderCell: () => null, // rendered specially in row loop
  },
];

// Default column order (Joe, 2026-04-21 -> updated 2026-04-21 ship 2):
// Ticker, Name, Current Price/Share, Cost/Share, PNL DAY $, PNL DAY %,
// Total Cost, Current Value, Total PNL $, PNL %, Purchase Date,
// Holding Period, Beta, % of Total Wealth, Account, Market Cap,
// Div Yield, Next Earnings, Actions.
//
// P&L cluster (Total Cost -> Current Value -> Total PNL $ -> PNL %) is
// adjacent on purpose - those four columns tell the cost-basis story.
const DEFAULT_ORDER = [
  "ticker", "name", "quantity", "price", "avgCost", "pnlDay$", "pnlDayPct",
  "totalCost", "currentValue", "pnl$", "pnlPct",
  "purchaseDate", "holdingDays", "beta",
  "beta_2y", "annVol_2y", "maxDD_2y", "var10d99",
  "wealthPct", "account", "marketcap", "divYield", "nextEarnings",
  "actions",
];

// Defaults-visible matches DEFAULT_ORDER. The rest (sector, annualizedPnl)
// are still available via the picker.
const DEFAULT_VISIBLE = [...DEFAULT_ORDER];

// Default column widths (px) - used when user has not dragged a custom
// width. New columns added later should append here; existing users
// get the default automatically via the forward-compat merge in
// useTablePreferences.
const DEFAULT_WIDTHS = {
  ticker:        90,
  name:          220,
  sector:        120,
  quantity:      90,
  price:         120,
  avgCost:       110,
  totalCost:     115,
  currentValue:  120,
  "pnlDay$":     105,
  pnlDayPct:     95,
  "pnl$":        115,
  pnlPct:        90,
  beta:          70,
  beta_2y:       95,
  annVol_2y:     95,
  maxDD_2y:      95,
  var10d99:      170,
  purchaseDate:  115,
  holdingDays:   130,
  annualizedPnl: 110,
  wealthPct:     110,
  account:       130,
  marketcap:     100,
  divYield:      95,
  nextEarnings:  125,
  actions:       90,
};

export default function PositionsTable({
  rows, grandTotal, screener, info,
  onOpenTicker, emptyMessage,
  onAdd, onBulkImport, onRescan, onEdit, onClose, onDelete,
  rescanBusy, rescanProgress,
  tableKey = "positions",
  // Task #25: optional TableFootnote props. When either timestamp or source is
  // supplied, a compact caption renders under the table so the freshness +
  // provenance stays attached to the data even when the user scrolls past
  // the section header.
  pricesTs, eventsTs, footnoteSource,
}) {
  const showActionsCol = Boolean(onEdit || onClose || onDelete);
  const showActionBar  = Boolean(onAdd || onBulkImport || onRescan);

  // Load/save column prefs (order + visibility) per user.
  const { prefs, setOrder, setVisible, setWidths, resetToDefaults } = useTablePreferences(tableKey, {
    defaultOrder:   DEFAULT_ORDER,
    defaultVisible: DEFAULT_VISIBLE,
    defaultWidths:  DEFAULT_WIDTHS,
  });

  const screenerMap = screener || {};
  const infoMap     = info     || {};

  // P5 #35 — fetch 2Y risk metrics for visible tickers and stitch onto each
  // row. Hook is module-cached + dedup, so N positions = N+1 fetches max
  // (SPY shared); subsequent renders are instant.
  const _tickers = useMemo(() => (rows || []).map(r => String(r.ticker || "").toUpperCase()).filter(Boolean), [rows]);
  const { metrics: _riskByTicker } = useRiskMetricsBatch(_tickers);

  // Enrich each raw row once so sort + render read from the same shape.
  const enriched = useMemo(() => {
    return (rows || []).map((p) => {
      const T = String(p.ticker || "").toUpperCase();
      const sc = screenerMap[T] || {};
      const inf = infoMap[T] || {};

      const quantity = p.quantity != null ? Number(p.quantity) : null;
      const price    = p.price   != null ? Number(p.price)   : null;
      const avgCost  = p.avgCost != null ? Number(p.avgCost) : null;
      const valueDb  = p.value   != null ? Number(p.value)   : null;

      const currentValue = valueDb != null ? valueDb
                         : (quantity != null && price != null ? quantity * price : null);
      const totalCost    = (quantity != null && avgCost != null) ? quantity * avgCost : null;

      const pnl$   = (currentValue != null && totalCost != null) ? currentValue - totalCost : null;
      const pnlPct = (price != null && avgCost)                  ? (price / avgCost - 1) * 100 : null;

      // Daily change — screener gives us close + prev_close (strings). If
      // scan hasn't populated, render "—" (null flows through everywhere).
      const scClose = sc.close     != null ? Number(sc.close)     : null;
      const scPrev  = sc.prev_close != null ? Number(sc.prev_close) : null;
      const perShareDay = (scClose != null && scPrev != null) ? scClose - scPrev : null;
      const pnlDay$   = (perShareDay != null && quantity != null) ? perShareDay * quantity : null;
      const pnlDayPct = (scClose != null && scPrev)             ? (scClose / scPrev - 1) * 100 : null;

      const wealthPct = grandTotal && currentValue != null ? (currentValue / grandTotal) * 100 : null;

      const holdingDays = daysBetween(p.purchaseDate);
      const annualizedPnl = annualizedPct(currentValue, totalCost, holdingDays);

      // Prefer screener marketcap (refreshed per run) over info (cached);
      // both are strings on UW's wire, hence Number().
      const marketcap =
        sc.marketcap != null ? Number(sc.marketcap)
      : inf.marketcap != null ? Number(inf.marketcap)
      : null;

      // Divvy yield: UW's info payload carries `dividend_yield` for some
      // issuers (decimal, e.g. 0.0142 = 1.42%). When absent we fall back to
      // the has_dividend boolean so the column still communicates something.
      const divYield =
        inf.dividend_yield != null ? Number(inf.dividend_yield)
      : null;
      const hasDividend = inf.has_dividend != null ? Boolean(inf.has_dividend) : null;

      const nextEarnings = inf.next_earnings_date || sc.next_earnings_date || null;

      return {
        ticker: T,
        name: p.name || "",
        sector: p.sector || inf.sector || sc.sector || "",
        quantity,
        price,
        avgCost,
        totalCost,
        currentValue,
        pnl$,
        pnlPct,
        pnlDay$,
        pnlDayPct,
        beta: p.beta != null ? Number(p.beta) : null,
        purchaseDate: p.purchaseDate || null,
        holdingDays,
        annualizedPnl,
        wealthPct,
        acctLabel: p.acctLabel || "",
        marketcap,
        divYield,
        hasDividend,
        nextEarnings,
        // Item 41: asset-class carry-through for displayTicker + downstream filters.
        assetClass:   p.assetClass   || "stock",
        contractType: p.contractType || null,
        direction:    p.direction    || null,
        strike:       p.strike     != null ? Number(p.strike)     : null,
        expiration:   p.expiration   || null,
        multiplier:   p.multiplier != null ? Number(p.multiplier) : null,
        manualPrice:  p.manualPrice != null ? Number(p.manualPrice) : null,
        _risk:        _riskByTicker[T] || null,
        _raw: p,
      };
    });
  }, [rows, grandTotal, screenerMap, infoMap, _riskByTicker]);

  // ─── Sort state ────────────────────────────────────────────────────────────
  const [sortCol, setSortCol] = useState("wealthPct");
  const [sortDir, setSortDir] = useState("desc");

  const toggleSort = (colId) => {
    const col = COLUMNS.find((c) => c.id === colId);
    if (!col || col.sortable === false) return;
    if (colId === sortCol) {
      setSortDir((d) => d === "asc" ? "desc" : "asc");
    } else {
      setSortCol(colId);
      // Numeric cols → desc (most / biggest first); text → asc.
      setSortDir(col.align === "right" ? "desc" : "asc");
    }
  };

  const sorted = useMemo(() => {
    const col = COLUMNS.find((c) => c.id === sortCol);
    if (!col) return enriched;
    const arr = [...enriched];
    arr.sort((a, b) => {
      const av = col.sortValue(a);
      const bv = col.sortValue(b);
      const aNull = av == null;
      const bNull = bv == null;
      if (aNull && bNull) return 0;
      if (aNull) return 1;          // nulls always at the bottom
      if (bNull) return -1;
      let cmp;
      if (typeof av === "number" && typeof bv === "number") cmp = av - bv;
      else cmp = String(av).localeCompare(String(bv), undefined, { numeric: true });
      return sortDir === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [enriched, sortCol, sortDir]);

  // ─── Action-bar + buttons ──────────────────────────────────────────────────
  const actionBtn = {
    padding: "4px 8px", fontSize: 11, fontFamily: "var(--font-mono)",
    letterSpacing: "0.04em", color: "var(--text-muted)",
    background: "transparent", border: "1px solid var(--border)",
    borderRadius: 4, cursor: "pointer", userSelect: "none", whiteSpace: "nowrap",
  };
  const topBarBtn = { ...actionBtn, padding: "6px 12px", fontSize: 12, fontWeight: 600, color: "var(--text)" };
  const topBarPrimary = { ...topBarBtn, color: "#fff", background: "var(--accent)", border: "1px solid var(--accent)" };

  const ActionBar = () => (
    <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginBottom: 8, flexWrap: "wrap" }}>
      <TableColumnPicker
        columns={COLUMNS.map(({ id, label, description, pinned }) => ({ id, label, description, pinned }))}
        order={prefs.order}
        visible={prefs.visible}
        defaultOrder={DEFAULT_ORDER}
        defaultVisible={DEFAULT_VISIBLE}
        onOrderChange={setOrder}
        onVisibleChange={setVisible}
        onResetAll={resetToDefaults}
      />
      {showActionBar && onRescan && (
        <Tip def="Refresh company names, sectors, beta values, and current prices for all your stock and fund positions. Useful if a row looks stale or is missing data. CASH rows are left alone."><button type="button"
          style={{ ...topBarBtn, opacity: rescanBusy ? 0.6 : 1, cursor: rescanBusy ? "progress" : "pointer" }}
          onClick={onRescan}
          disabled={rescanBusy}>
          {rescanBusy
            ? `Rescanning ${rescanProgress?.done ?? 0}/${rescanProgress?.total ?? 0}…`
            : "Rescan metadata"}
        </button></Tip>
      )}
      {showActionBar && onBulkImport && (
        <button type="button" style={topBarBtn} onClick={onBulkImport}>
          Bulk import (CSV/XLSX)
        </button>
      )}
      {showActionBar && onAdd && (
        <button type="button" style={topBarPrimary} onClick={onAdd}>
          + Add position
        </button>
      )}
    </div>
  );

  // Drag state MUST be declared before any conditional return — React hook-order invariant (Item 36 hotfix).
  const [dragId, setDragId] = useState(null);
  const [dragOverId, setDragOverId] = useState(null);
  // liveWidths (column resize) MUST also be declared before the early return -- same React hook-order invariant.
  const [liveWidths, setLiveWidths] = useState(null);

  if (!enriched.length) {
    return (
      <>
        <ActionBar />
        <div style={{
          padding: "10px 12px", fontSize: 12, color: "var(--text-muted)",
          fontFamily: "var(--font-mono)",
          border: "1px solid var(--border)", borderRadius: 6,
          background: "var(--surface-2)",
        }}>
          {emptyMessage || "No positions."}
        </div>
      </>
    );
  }

  // ─── Visible column list for this render ───────────────────────────────────
  // Keep only ids the user has checked, then *always* append "actions" at the
  // end if the actions column is in use (pinned rightmost).
  const byId = new Map(COLUMNS.map((c) => [c.id, c]));
  const visibleIds = prefs.order
    .filter((id) => prefs.visible.includes(id) && byId.has(id))
    .filter((id) => id !== "actions"); // actions handled separately
  const visibleColumns = visibleIds.map((id) => byId.get(id)).filter(Boolean);
  const actionsCol = showActionsCol ? byId.get("actions") : null;

  // ─── Draggable headers ─────────────────────────────────────────────────────

  const onHdrDragStart = (e, id) => {
    setDragId(id);
    try {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", id);
    } catch {}
  };
  const onHdrDragOver = (e, id) => {
    if (!dragId || id === "actions") return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (id !== dragOverId) setDragOverId(id);
  };
  const onHdrDrop = (e, targetId) => {
    e.preventDefault();
    const source = dragId;
    setDragId(null);
    setDragOverId(null);
    if (!source || source === targetId || targetId === "actions") return;
    const next = [...prefs.order];
    const from = next.indexOf(source);
    const to   = next.indexOf(targetId);
    if (from < 0 || to < 0) return;
    next.splice(from, 1);
    next.splice(to, 0, source);
    setOrder(next);
  };
  const onHdrDragEnd = () => { setDragId(null); setDragOverId(null); };

  const headerStyle = {
    fontSize: 10, fontWeight: 700, color: "var(--text-muted)",
    fontFamily: "var(--font-mono)", letterSpacing: "0.08em",
    padding: "6px 6px",
    borderBottom: "1px solid var(--border)",
    background: "var(--surface-3)", position: "sticky", top: 0,
    userSelect: "none", whiteSpace: "nowrap",
    overflow: "hidden", textOverflow: "ellipsis",
  };

  // --- Resizable columns ----------------------------------------------------
  // Live widths during a drag - null when not resizing. We keep an in-memory
  // copy instead of writing to prefs on every mousemove so the debounced
  // save does not log dozens of intermediate widths. Final value is committed
  // to setWidths() on mouseup.
  const widthOf = (id) => (liveWidths && liveWidths[id] != null)
    ? liveWidths[id]
    : (prefs.widths[id] != null ? prefs.widths[id] : (DEFAULT_WIDTHS[id] || 100));

  const onResizeStart = (e, id) => {
    e.preventDefault();   // blocks parent <th>'s native drag from firing
    e.stopPropagation();  // blocks sort-toggle click
    const startX = e.clientX;
    const startW = widthOf(id);
    let next = startW;
    const onMove = (ev) => {
      next = Math.max(48, Math.min(2000, Math.round(startW + ev.clientX - startX)));
      setLiveWidths((prev) => ({ ...(prev || {}), [id]: next }));
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      const merged = { ...prefs.widths, [id]: next };
      setLiveWidths(null);
      setWidths(merged);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const resizeHandleStyle = {
    position: "absolute",
    top: 0, right: 0, bottom: 0,
    width: 6,
    cursor: "col-resize",
    userSelect: "none",
    zIndex: 2,
  };

  return (
    <>
      <ActionBar />
      <div style={{ overflowX: "auto", border: "1px solid var(--border)", borderRadius: 6 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, tableLayout: "fixed" }}>
          <colgroup>
            {visibleColumns.map((col) => (
              <col key={col.id} style={{ width: widthOf(col.id) }} />
            ))}
            {actionsCol && <col style={{ width: DEFAULT_WIDTHS.actions }} />}
          </colgroup>
          <thead>
            <tr>
              {visibleColumns.map((col) => {
                const isDragOver = dragOverId === col.id && dragId && dragId !== col.id;
                const isDragging = dragId === col.id;
                return (
                  <th
                    key={col.id}
                    draggable
                    onDragStart={(e) => onHdrDragStart(e, col.id)}
                    onDragOver={(e) => onHdrDragOver(e, col.id)}
                    onDrop={(e) => onHdrDrop(e, col.id)}
                    onDragEnd={onHdrDragEnd}
                    onClick={() => toggleSort(col.id)}
                    style={{
                      ...headerStyle,
                      textAlign: col.align === "right" ? "right" : "left",
                      cursor: "grab",
                      opacity: isDragging ? 0.5 : 1,
                      borderLeft: isDragOver ? "2px solid var(--accent)" : "2px solid transparent",
                    }}
                  >
                    {/* LESSONS rule #3: zero-latency tooltip via Tip
                        primitive. Replaces the slow browser-default
                        title= attribute that had ~750ms hover delay. */}
                    <Tip def={col.description}>
                      <span style={{ display: "inline-block" }}>
                        {col.label}
                        <SortArrow dir={sortCol === col.id ? sortDir : null} />
                      </span>
                    </Tip>
                    <Tip def="Drag to resize column"><div draggable={false}
                      onMouseDown={(e) => onResizeStart(e, col.id)}
                      onClick={(e) => e.stopPropagation()}
                      style={resizeHandleStyle}/></Tip>
                  </th>
                );
              })}
              {actionsCol && (
                <th
                  style={{
                    ...headerStyle, cursor: "default", textAlign: "right",
                    borderLeft: "1px solid var(--border-faint)",
                  }}
                >
                  <Tip def={actionsCol.description}>
                    <span style={{ display: "inline-block" }}>{actionsCol.label}</span>
                  </Tip>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => (
              <tr
                key={`${row.acctLabel}-${row.ticker}-${row._raw?.id || ""}`}
                onClick={() => onOpenTicker?.(row.ticker)}
                style={{
                  cursor: "pointer",
                  borderBottom: "1px solid var(--border-faint)",
                  background: "var(--surface-2)",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-3)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "var(--surface-2)")}
              >
                {visibleColumns.map((col) => (
                  <td
                    key={col.id}
                    style={{
                      padding: "7px 6px",
                      textAlign: col.align === "right" ? "right" : "left",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {col.renderCell(row)}
                  </td>
                ))}
                {actionsCol && (
                  <td
                    style={{ padding: "5px 6px", textAlign: "right", whiteSpace: "nowrap" }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {onEdit && (
                      <Tip def="Edit position"><button type="button"
                        style={{ ...actionBtn, marginRight: 4 }}
                        onClick={(e) => { e.stopPropagation(); onEdit(row._raw); }}>
                        Edit
                      </button></Tip>
                    )}
                    {onClose && (
                      <Tip def="Close position — proceeds to a cash row, position soft-archived for history">
                        <button type="button"
                          style={{ ...actionBtn, marginRight: 4, color: "#30d158", borderColor: "rgba(48,209,88,0.4)" }}
                          onClick={(e) => { e.stopPropagation(); onClose(row._raw); }}>
                          Close
                        </button>
                      </Tip>
                    )}
                    {onDelete && (
                      <Tip def="Delete entry — no cash impact. Use only for fixing wrong entries; for closing a real trade use Close instead.">
                        <button type="button"
                          style={{ ...actionBtn, color: "#ff453a", borderColor: "rgba(255,69,58,0.35)" }}
                          onClick={(e) => { e.stopPropagation(); onDelete(row._raw); }}>
                          Delete
                        </button>
                      </Tip>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* Task #25: footnote keeps freshness + source attached to the table
          body — useful on long portfolios where the section header scrolls
          off-screen. Renders null if no ts / source is provided. */}
      <TableFootnote pricesTs={pricesTs} eventsTs={eventsTs} source={footnoteSource} />
    </>
  );
}
