// PositionsTable — sortable, user-customizable positions grid.
//
// Migrated to MTTable (Tier A) 2026-05-12 as part of the unified-table sweep
// (PR feature/dev-mttable-unified-sweep-pt2). MTTable owns sort, filter,
// resize, reorder, visibility, search, and toolbar; the Actions column is
// rendered via MTTable's new `pinned: "right"` mechanism so Edit / Close /
// Delete buttons always sit on the rightmost edge and never participate in
// reorder. Per-table column prefs persist via localStorage keyed by tableKey.
//
// Props
// -----
//   rows          : Array<raw position> (from App.jsx heldPositions).
//   grandTotal    : total wealth for % of wealth column
//   screener      : { TICKER: { close, prev_close, marketcap, ... } }
//   info          : { TICKER: { next_earnings_date, marketcap, dividend_yield, ... } }
//   signals       : scanData.signals (used by Trading Opps cluster renderers)
//   onOpenTicker  : fn(ticker) — open detail modal
//   onAdd, onBulkImport, onRescan      — action-bar buttons (top)
//   onEdit, onClose, onDelete          — per-row actions (pinned-right column)
//   emptyMessage  : string shown when rows is empty
//   priceCaption / eventsCaption / footnoteSource — TableFootnote captions
//   tableKey      : MTTable localStorage storageKey (default "positions")

import { useMemo, useState } from "react";
import useRiskMetricsBatch from "../hooks/useRiskMetricsBatch";
import useV5ScanBatch from "../hooks/useV5ScanBatch";
import usePricesEodBatch from "../hooks/usePricesEodBatch";
import { Tip } from "../InfoTip";
import TableFootnote from "./TableFootnote";
import { computeSectionComposites, colorForDirection } from "../ticker/sectionComposites";
import MTTable from "./MTTable";

const SIGNAL_COLS = [
  { key: "technicals", short: "Technical",             long: "Technicals (25% of the overall rank)" },
  { key: "insider",    short: "Insider",               long: "Insider Form-4 buys/sells (25%)" },
  { key: "options",    short: "Options",               long: "Options flow (20%)" },
  { key: "congress",   short: "Congress",              long: "Congressional trade disclosures (15%)" },
  { key: "analyst",    short: "Analyst",               long: "Analyst ratings (10%)" },
  { key: "darkpool",   short: "Dark Pool",             long: "Dark-pool prints (5%)" },
];

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
  if (!v) return "—";
  try {
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return "—";
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const yyyy = d.getFullYear();
    return `${mm}/${dd}/${yyyy}`;
  } catch { return "—"; }
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
  v == null ? "var(--text-muted)" : v >= 0 ? "var(--green)" : "var(--red)";
const betaColor = (v) =>
  v == null ? "var(--text-dim)"
  : v > 1.5 ? "var(--red)"
  : v > 1.0 ? "var(--yellow)"
  : v > 0.5 ? "var(--yellow-text)" : "var(--green)";

function ScoreCell({ score, direction }) {
  const col = score == null ? "var(--text-dim)" : colorForDirection(direction);
  const display = score == null ? "—" : (score >= 0 ? "+" : "") + score;
  return (
    <span style={{ color: col, fontFamily: "var(--font-ui)", fontVariantNumeric: "tabular-nums", fontWeight: 600, fontSize: 12 }}>
      {display}
    </span>
  );
}

// Compact option spec: "AAPL 04/17/26 $250 C LONG"
function displayTicker(r) {
  if (r.assetClass !== "option") return r.ticker;
  const parts = [r.ticker];
  if (r.expiration) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(r.expiration);
    if (m) parts.push(`${m[2]}/${m[3]}/${m[1].slice(2)}`);
  }
  if (r.strike != null) parts.push(`$${Number(r.strike)}`);
  if (r.contractType) parts.push(String(r.contractType).toUpperCase().slice(0, 1));
  if (r.direction)    parts.push(String(r.direction).toUpperCase());
  return parts.join(" ");
}

// ─── MTTable column registry ─────────────────────────────────────────────────
// Schema per MTTable: { key, label, numeric?, categorical?, defaultVisible?,
// defaultWidth?, tooltip?, render?(row), sortValue?(row), pinned? }
function buildColumns({ onEdit, onClose, onDelete }) {
  const baseCols = [
    {
      key: "ticker", label: "TICKER", defaultWidth: 130,
      tooltip: "Ticker symbol (option positions render as TKR EXP STRIKE C/P L/S)",
      sortValue: (r) => r.ticker,
      render: (r) => (
        <span style={{ fontFamily: "var(--font-mono)", fontWeight: 700, color: "var(--text)" }}>
          {displayTicker(r)}
        </span>
      ),
    },
    {
      key: "name", label: "NAME", defaultWidth: 220,
      tooltip: "Company or fund name",
      sortValue: (r) => (r.name || "").toLowerCase(),
      render: (r) => (
        <span style={{
          color: "var(--text-muted)", maxWidth: 220, display: "inline-block",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          verticalAlign: "bottom",
        }} title={r.name}>{r.name || "—"}</span>
      ),
    },
    {
      key: "sector", label: "SECTOR", categorical: true, defaultWidth: 130, defaultVisible: false,
      tooltip: "Sector / asset class",
      sortValue: (r) => (r.sector || "").toLowerCase(),
      render: (r) => (
        <span style={{ color: "var(--text-dim)", fontFamily: "var(--font-mono)", fontSize: 11, whiteSpace: "nowrap" }}>
          {r.sector || "—"}
        </span>
      ),
    },
    {
      key: "quantity", label: "QTY", numeric: true, defaultWidth: 90,
      tooltip: "Total quantity held (shares for equities; units for crypto; dollars for cash)",
      sortValue: (r) => r.quantity,
      render: (r) => (
        <span style={{ fontFamily: "var(--font-mono)", color: "var(--text)" }}>{fmtShares(r.quantity)}</span>
      ),
    },
    {
      key: "price", label: "PRICE/SHARE", numeric: true, defaultWidth: 120,
      tooltip: "Current market price per share",
      sortValue: (r) => r.price,
      render: (r) => (
        <span style={{ fontFamily: "var(--font-mono)", color: "var(--text)" }}>{fmt$Full(r.price)}</span>
      ),
    },
    {
      key: "avgCost", label: "COST/SHARE", numeric: true, defaultWidth: 110,
      tooltip: "Average cost paid per share",
      sortValue: (r) => r.avgCost,
      render: (r) => (
        <span style={{ fontFamily: "var(--font-mono)", color: "var(--text-muted)" }}>{fmt$Full(r.avgCost)}</span>
      ),
    },
    {
      key: "totalCost", label: "TOTAL COST", numeric: true, defaultWidth: 120,
      tooltip: "shares × avg cost — what you paid in aggregate",
      sortValue: (r) => r.totalCost,
      render: (r) => (
        <span style={{ fontFamily: "var(--font-mono)", color: "var(--text-muted)" }}>{fmt$Full(r.totalCost)}</span>
      ),
    },
    {
      key: "currentValue", label: "CURRENT VALUE", numeric: true, defaultWidth: 130,
      tooltip: "shares × current price — what it's worth now",
      sortValue: (r) => r.currentValue,
      render: (r) => {
        if (r.price == null) {
          return (
            <span style={{ fontFamily: "var(--font-mono)", color: "var(--ink-2,#666)", fontStyle: "italic" }}>
              (no price yet)
            </span>
          );
        }
        return (
          <span style={{ fontFamily: "var(--font-mono)", color: "var(--text)" }}>{fmt$Full(r.currentValue)}</span>
        );
      },
    },
    {
      key: "pnlDay$", label: "PNL DAY $", numeric: true, defaultWidth: 105,
      tooltip: "Today's dollar change on this position",
      sortValue: (r) => r.pnlDay$,
      render: (r) => (
        <span style={{ fontFamily: "var(--font-mono)", color: pnlColor(r.pnlDay$), fontWeight: 600 }}>
          {fmt$Signed(r.pnlDay$)}
        </span>
      ),
    },
    {
      key: "pnlDayPct", label: "PNL DAY %", numeric: true, defaultWidth: 95,
      tooltip: "Today's percent change on this position",
      sortValue: (r) => r.pnlDayPct,
      render: (r) => (
        <span style={{ fontFamily: "var(--font-mono)", color: pnlColor(r.pnlDayPct), fontWeight: 600 }}>
          {fmtPctSigned(r.pnlDayPct)}
        </span>
      ),
    },
    {
      key: "pnl$", label: "TOTAL PNL $", numeric: true, defaultWidth: 120,
      tooltip: "Unrealized gain/loss in dollars (current value − total cost)",
      sortValue: (r) => r.pnl$,
      render: (r) => (
        <span style={{ fontFamily: "var(--font-mono)", color: pnlColor(r.pnl$), fontWeight: 600 }}>
          {fmt$Signed(r.pnl$)}
        </span>
      ),
    },
    {
      key: "pnlPct", label: "PNL %", numeric: true, defaultWidth: 90,
      tooltip: "Unrealized gain/loss percent (price / cost − 1)",
      sortValue: (r) => r.pnlPct,
      render: (r) => (
        <span style={{ fontFamily: "var(--font-mono)", color: pnlColor(r.pnlPct), fontWeight: 600 }}>
          {fmtPctSigned(r.pnlPct)}
        </span>
      ),
    },
    {
      key: "purchaseDate", label: "PURCHASE DATE", numeric: true, defaultWidth: 130,
      tooltip: "Date position was acquired. Enables Holding Period and Annualized PnL.",
      sortValue: (r) => r.purchaseDate ? new Date(r.purchaseDate).getTime() : null,
      render: (r) => (
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-dim)" }}>{fmtDate(r.purchaseDate)}</span>
      ),
    },
    {
      key: "holdingDays", label: "HOLDING DAYS", numeric: true, defaultWidth: 120,
      tooltip: "Days since purchase date. Empty if no purchase date set.",
      sortValue: (r) => r.holdingDays,
      render: (r) => (
        <span style={{ fontFamily: "var(--font-mono)", color: "var(--text-muted)" }}>
          {r.holdingDays == null ? "—" : r.holdingDays.toLocaleString()}
        </span>
      ),
    },
    {
      key: "annualizedPnl", label: "ANNUALIZED PNL %", numeric: true, defaultWidth: 130, defaultVisible: false,
      tooltip: "((current value / total cost) ^ (365 / holding days)) − 1. Needs purchase date.",
      sortValue: (r) => r.annualizedPnl,
      render: (r) => (
        <span style={{ fontFamily: "var(--font-mono)", color: pnlColor(r.annualizedPnl), fontWeight: 600 }}>
          {fmtPctSigned(r.annualizedPnl)}
        </span>
      ),
    },
    {
      key: "beta", label: "BETA", numeric: true, defaultWidth: 80,
      tooltip: "Position beta vs. SPY (where available)",
      sortValue: (r) => r.beta,
      render: (r) => (
        <span style={{ fontFamily: "var(--font-mono)", color: betaColor(r.beta) }}>
          {r.beta == null ? "—" : Number(r.beta).toFixed(2)}
        </span>
      ),
    },
    {
      key: "wealthPct", label: "% OF TOTAL WEALTH", numeric: true, defaultWidth: 130,
      tooltip: "Current value as % of total portfolio value",
      sortValue: (r) => r.wealthPct,
      render: (r) => (
        <span style={{ fontFamily: "var(--font-mono)", color: "var(--text)" }}>{fmtPct(r.wealthPct)}</span>
      ),
    },
    {
      key: "account", label: "ACCOUNT", categorical: true, defaultWidth: 130,
      tooltip: "Account holding this position",
      sortValue: (r) => (r.acctLabel || "").toLowerCase(),
      render: (r) => (
        <span style={{ color: "var(--text-dim)", fontFamily: "var(--font-mono)", fontSize: 11, whiteSpace: "nowrap" }}>
          {r.acctLabel || "—"}
        </span>
      ),
    },
    {
      key: "marketcap", label: "MARKET CAP", numeric: true, defaultWidth: 110,
      tooltip: "Company market capitalization (from latest scan)",
      sortValue: (r) => r.marketcap,
      render: (r) => (
        <span style={{ fontFamily: "var(--font-mono)", color: "var(--text-muted)" }}>{fmtMarketCap(r.marketcap)}</span>
      ),
    },
    {
      key: "divYield", label: "DIV YIELD", numeric: true, defaultWidth: 100,
      tooltip: "Dividend yield, when available. 'Y' / 'N' shown if only has-dividend flag is known.",
      sortValue: (r) => r.divYield != null ? r.divYield : (r.hasDividend ? 0.001 : null),
      render: (r) => {
        if (r.divYield != null && isFinite(r.divYield)) {
          return (
            <span style={{ fontFamily: "var(--font-mono)", color: "var(--text-muted)" }}>
              {fmtPct(r.divYield * (r.divYield < 1 ? 100 : 1), 2)}
            </span>
          );
        }
        if (r.hasDividend === true)  return <span style={{ fontFamily: "var(--font-mono)", color: "var(--text-dim)" }}>Y</span>;
        if (r.hasDividend === false) return <span style={{ fontFamily: "var(--font-mono)", color: "var(--text-dim)" }}>N</span>;
        return <span style={{ fontFamily: "var(--font-mono)", color: "var(--text-dim)" }}>—</span>;
      },
    },
    {
      key: "nextEarnings", label: "NEXT EARNINGS", numeric: true, defaultWidth: 125,
      tooltip: "Next expected earnings report date",
      sortValue: (r) => r.nextEarnings ? new Date(r.nextEarnings).getTime() : null,
      render: (r) => (
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-dim)" }}>{fmtDate(r.nextEarnings)}</span>
      ),
    },
    {
      key: "ivRank", label: "IV RANK", numeric: true, defaultWidth: 85,
      tooltip: "Implied volatility rank (0-100). Higher = richer option premium relative to this name's own 1-year range.",
      sortValue: (r) => r.ivRank,
      render: (r) => (
        <span style={{ fontFamily: "var(--font-mono)", color: "var(--text-muted)" }}>
          {r.ivRank == null ? "—" : Number(r.ivRank).toFixed(1)}
        </span>
      ),
    },
    {
      key: "week52", label: "52W RANGE", numeric: true, defaultWidth: 160,
      tooltip: "52-week low / high. Quick gut-check on where the current price sits in its yearly range.",
      sortValue: (r) => r.weekHigh,
      render: (r) => (
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-dim)" }}>
          {r.weekLow != null && r.weekHigh != null ? `$${Number(r.weekLow).toFixed(2)} – $${Number(r.weekHigh).toFixed(2)}` : "—"}
        </span>
      ),
    },
  ];

  const riskCols = [
    {
      key: "beta_2y", label: "BETA · 2Y", numeric: true, defaultWidth: 95,
      tooltip: "Beta vs S&P 500 (SPY), 2-year weekly OLS regression. 1.0 = moves with market; >1.0 amplifies; <1.0 dampens.",
      sortValue: (r) => r._risk?.beta ?? null,
      render: (r) => {
        const v = r._risk?.beta;
        if (v == null) return <span style={{color:"var(--text-dim)"}}>—</span>;
        const col = v > 1.3 ? "var(--orange-text)" : v < 0.6 ? "var(--yellow-text)" : "var(--text)";
        return <span style={{ fontFamily: "var(--font-mono)", color: col }}>{v.toFixed(2)}</span>;
      },
    },
    {
      key: "annVol_2y", label: "ANN VOL", numeric: true, defaultWidth: 95,
      tooltip: "Annualized volatility — 2Y daily standard deviation × √252.",
      sortValue: (r) => r._risk?.annVol ?? null,
      render: (r) => {
        const v = r._risk?.annVol;
        if (v == null) return <span style={{color:"var(--text-dim)"}}>—</span>;
        const col = v > 0.40 ? "var(--red-text)" : v > 0.25 ? "var(--orange-text)" : "var(--text)";
        return <span style={{ fontFamily: "var(--font-mono)", color: col }}>{(v*100).toFixed(1)}%</span>;
      },
    },
    {
      key: "maxDD_2y", label: "MAX DD", numeric: true, defaultWidth: 95,
      tooltip: "Largest peak-to-trough decline over the last 2 years.",
      sortValue: (r) => r._risk?.maxDD ?? null,
      render: (r) => {
        const v = r._risk?.maxDD;
        if (v == null) return <span style={{color:"var(--text-dim)"}}>—</span>;
        const col = v > 0.40 ? "var(--red-text)" : v > 0.25 ? "var(--orange-text)" : "var(--text)";
        return <span style={{ fontFamily: "var(--font-mono)", color: col }}>{(v*100).toFixed(1)}%</span>;
      },
    },
    {
      key: "var10d99", label: "10D 99% VaR", numeric: true, defaultWidth: 170,
      tooltip: "10-day 99% historical Value-at-Risk from 2Y daily rolling 10-day returns, 1st percentile.",
      sortValue: (r) => r._risk?.var10d99 ?? null,
      render: (r) => {
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
  ];

  const v5Cols = [
    {
      key: "mt_score", label: "MT SCORE", numeric: true, defaultWidth: 100,
      tooltip: "MacroTilt Score — weighted blend of six v5 signals (−100 bearish to +100 bullish). The live engine that powers Trading Opps.",
      sortValue: (r) => r._v5?.mt_score ?? null,
      render: (r) => {
        const v = r._v5?.mt_score;
        if (v == null) return <span style={{color:"var(--text-dim)"}}>—</span>;
        const col = v >= 50 ? "var(--green-text, var(--green))" : v >= 20 ? "var(--green)" : v <= -50 ? "var(--red-text, var(--red))" : v <= -20 ? "var(--red)" : "var(--text)";
        return <span style={{ fontFamily: "var(--font-ui)", fontVariantNumeric: "tabular-nums", fontWeight: 700, color: col, fontSize: 13 }}>{v >= 0 ? "+" : ""}{Number(v).toFixed(1)}</span>;
      },
    },
    {
      key: "band", label: "BAND", categorical: true, defaultWidth: 120,
      tooltip: "Strong Sell / Sell Watch / Neutral / Buy Watch / Strong Buy. Cutoffs at MT Score −50, −20, +20, +50.",
      filterValue: (r) => r._v5?.band,
      sortValue: (r) => {
        const order = { "Strong Sell": -2, "Sell Watch": -1, "Neutral": 0, "Buy Watch": 1, "Strong Buy": 2 };
        return order[r._v5?.band] ?? null;
      },
      render: (r) => {
        const b = r._v5?.band;
        if (!b) return <span style={{color:"var(--text-dim)"}}>—</span>;
        const col = b === "Strong Buy" ? "var(--green-text, var(--green))" : b === "Buy Watch" ? "var(--green)" : b === "Sell Watch" ? "var(--red)" : b === "Strong Sell" ? "var(--red-text, var(--red))" : "var(--text-muted)";
        return <span style={{ fontFamily: "var(--font-ui)", fontSize: 11, fontWeight: 600, color: col }}>{b}</span>;
      },
    },
    {
      key: "ig", label: "INDUSTRY GROUP", categorical: true, defaultWidth: 210,
      tooltip: "GICS Industry Group (25 mid-level buckets). Derived from the ticker's SIC code.",
      filterValue: (r) => r._v5?.ig,
      sortValue: (r) => (r._v5?.ig || "").toLowerCase(),
      render: (r) => (
        <span style={{ color: "var(--text-dim)", fontFamily: "var(--font-mono)", fontSize: 11, whiteSpace: "nowrap" }} title={r._v5?.ig}>
          {r._v5?.ig || "—"}
        </span>
      ),
    },
    {
      key: "sub_short_interest", label: "SHORT INT", numeric: true, defaultWidth: 100,
      tooltip: "Short Interest sub-score (−100 to +100).",
      sortValue: (r) => r._v5?.sub_short_interest ?? null,
      render: (r) => <ScoreCell score={r._v5?.sub_short_interest} direction={r._v5?.sub_short_interest > 0 ? "bullish" : r._v5?.sub_short_interest < 0 ? "bearish" : null} />,
    },
    {
      key: "rsi_14", label: "RSI(14)", numeric: true, defaultWidth: 85,
      tooltip: "14-day Relative Strength Index. >70 conventionally overbought (red); <30 oversold (amber); 30–70 normal trend.",
      sortValue: (r) => r._v5?.rsi_14 ?? null,
      render: (r) => {
        const v = r._v5?.rsi_14;
        if (v == null) return <span style={{color:"var(--text-dim)"}}>—</span>;
        const col = v > 70 ? "var(--red-text)" : v < 30 ? "var(--orange-text)" : "var(--text)";
        return <span style={{ fontFamily: "var(--font-mono)", color: col }}>{v.toFixed(1)}</span>;
      },
    },
    {
      key: "bb_bw", label: "BB BAND-WIDTH", numeric: true, defaultWidth: 115,
      tooltip: "Bollinger band-width as percent of the 20-day moving average. <5% = compression / squeeze (amber). >15% = expansion / trend in motion.",
      sortValue: (r) => r._v5?.bb_bw ?? null,
      render: (r) => {
        const v = r._v5?.bb_bw;
        if (v == null) return <span style={{color:"var(--text-dim)"}}>—</span>;
        const col = v < 0.05 ? "var(--orange-text)" : "var(--text)";
        return <span style={{ fontFamily: "var(--font-mono)", color: col }}>{(v*100).toFixed(2)}%</span>;
      },
    },
    {
      key: "rvol_20d", label: "RVOL (20d)", numeric: true, defaultWidth: 100,
      tooltip: "Today's volume divided by the 20-day average. ≥1.5× = unusual activity (green); <0.7× = quiet (amber); 1.0× = average.",
      sortValue: (r) => r._v5?.rvol_20d ?? null,
      render: (r) => {
        const v = r._v5?.rvol_20d;
        if (v == null) return <span style={{color:"var(--text-dim)"}}>—</span>;
        const col = v >= 1.5 ? "var(--green-text)" : v < 0.7 ? "var(--orange-text)" : "var(--text)";
        return <span style={{ fontFamily: "var(--font-mono)", color: col }}>{v.toFixed(2)}×</span>;
      },
    },
    {
      key: "pct_50ma", label: "% VS 50D MA", numeric: true, defaultWidth: 105,
      tooltip: "Today's close as a percent distance from the 50-day SMA. >+5% uptrend; <−5% downtrend; between = ranging.",
      sortValue: (r) => r._v5?.pct_50ma ?? null,
      render: (r) => {
        const v = r._v5?.pct_50ma;
        if (v == null) return <span style={{color:"var(--text-dim)"}}>—</span>;
        const col = v > 5 ? "var(--green-text)" : v < -5 ? "var(--red-text)" : "var(--text)";
        return <span style={{ fontFamily: "var(--font-mono)", color: col }}>{v >= 0 ? "+" : ""}{v.toFixed(1)}%</span>;
      },
    },
    {
      key: "pct_200ma", label: "% VS 200D MA", numeric: true, defaultWidth: 110,
      tooltip: "Today's close as a percent distance from the 200-day SMA. >+10% strong long-term uptrend; <−10% downtrend; between = sideways.",
      sortValue: (r) => r._v5?.pct_200ma ?? null,
      render: (r) => {
        const v = r._v5?.pct_200ma;
        if (v == null) return <span style={{color:"var(--text-dim)"}}>—</span>;
        const col = v > 10 ? "var(--green-text)" : v < -10 ? "var(--red-text)" : "var(--text)";
        return <span style={{ fontFamily: "var(--font-mono)", color: col }}>{v >= 0 ? "+" : ""}{v.toFixed(1)}%</span>;
      },
    },
    {
      key: "ins_buys", label: "INSIDER BUYS (#)", numeric: true, defaultWidth: 120,
      tooltip: "Number of Form 4 open-market buy events by company officers / directors in the recent window.",
      sortValue: (r) => r._v5?.ins_buys ?? null,
      render: (r) => {
        const v = r._v5?.ins_buys;
        if (v == null) return <span style={{color:"var(--text-dim)"}}>—</span>;
        return <span style={{ fontFamily: "var(--font-mono)", color: v > 0 ? "var(--green-text)" : "var(--text-dim)" }}>{v}</span>;
      },
    },
    {
      key: "ins_buy_$", label: "INSIDER BUYS ($)", numeric: true, defaultWidth: 130,
      tooltip: "Total dollar value of recent Form 4 open-market buy events.",
      sortValue: (r) => r._v5?.["ins_buy_$"] ?? null,
      render: (r) => {
        const v = r._v5?.["ins_buy_$"];
        if (v == null) return <span style={{color:"var(--text-dim)"}}>—</span>;
        return <span style={{ fontFamily: "var(--font-mono)", color: v > 0 ? "var(--green-text)" : "var(--text-dim)" }}>{fmtMarketCap(v)}</span>;
      },
    },
  ];

  // Pinned-right Actions column. Always renders rightmost via MTTable's
  // pinned mechanism. Never reorderable, not sortable, always visible.
  const showActions = Boolean(onEdit || onClose || onDelete);
  const actionBtn = {
    padding: "4px 8px", fontSize: 11, fontFamily: "var(--font-mono)",
    letterSpacing: "0.04em", color: "var(--text-muted)",
    background: "transparent", border: "1px solid var(--border)",
    borderRadius: 4, cursor: "pointer", userSelect: "none", whiteSpace: "nowrap",
  };
  const actionsCol = {
    key: "_actions", label: "ACTIONS", defaultWidth: 220,
    pinned: "right",
    sortable: false,
    tooltip: "Edit / close / delete this position",
    render: (r) => (
      <span onClick={(e) => e.stopPropagation()} style={{ whiteSpace: "nowrap" }}>
        {onEdit && (
          <Tip def="Edit position"><button type="button"
            style={{ ...actionBtn, marginRight: 4 }}
            onClick={(e) => { e.stopPropagation(); onEdit(r._raw); }}>Edit</button></Tip>
        )}
        {onClose && (
          <Tip def="Close position — proceeds to a cash row, position soft-archived for history">
            <button type="button"
              style={{ ...actionBtn, marginRight: 4, color: "var(--green)", borderColor: "rgba(48,209,88,0.4)" }}
              onClick={(e) => { e.stopPropagation(); onClose(r._raw); }}>Close</button>
          </Tip>
        )}
        {onDelete && (
          <Tip def="Delete entry — no cash impact. Use only for fixing wrong entries; for closing a real trade use Close instead.">
            <button type="button"
              style={{ ...actionBtn, color: "var(--red)", borderColor: "rgba(255,69,58,0.35)" }}
              onClick={(e) => { e.stopPropagation(); onDelete(r._raw); }}>Delete</button>
          </Tip>
        )}
      </span>
    ),
  };

  // Final column ordering — Joe directive 2026-04-21 + 2026-05-11 v5 cluster:
  // ticker→name→qty→price/cost→day-pnl→cost/value/total-pnl block→hold/date→
  // risk cluster→wealth/account→fundamentals→v5 cluster→pinned actions.
  const ordered = [
    baseCols[0], baseCols[1], baseCols[3], baseCols[4], baseCols[5], // ticker name qty price cost
    baseCols[8], baseCols[9],                                          // pnlDay$, pnlDay%
    baseCols[6], baseCols[7], baseCols[10], baseCols[11],             // totalCost currValue pnl$ pnl%
    baseCols[12], baseCols[13], baseCols[14],                          // purchaseDate holdingDays annualizedPnl
    baseCols[15],                                                       // beta
    ...riskCols,                                                        // beta_2y annVol maxDD var10d99
    baseCols[16], baseCols[17], baseCols[18], baseCols[19], baseCols[20], // wealthPct account marketcap divYield nextEarnings
    baseCols[21], baseCols[22],                                          // ivRank week52
    baseCols[2],                                                         // sector (default off)
    ...v5Cols,                                                          // v5 cluster
  ];
  return showActions ? [...ordered, actionsCol] : ordered;
}

export default function PositionsTable({
  rows, grandTotal, screener, info, signals,
  onOpenTicker, emptyMessage,
  onAdd, onBulkImport, onRescan, onEdit, onClose, onDelete,
  rescanBusy, rescanProgress,
  tableKey = "positions",
  priceCaption, eventsCaption, footnoteSource,
}) {
  const showActionBar = Boolean(onAdd || onBulkImport || onRescan);

  const screenerMap = screener || {};
  // Single source of truth for live price + day-change: prices_eod via
  // the batched hook. positions.price is kept in lockstep with prices_eod
  // by refresh_positions_from_eod (called after every Yahoo same-day
  // write), but UI tables must still read through this hook so that
  // (a) on-page refreshes propagate without a hard reload, and (b) the
  // DAY % calc uses the same source as the PRICE column. The legacy
  // screener overlay is kept only as a fallback for tickers with no
  // prices_eod row at all (brand-new listings before first ingest).
  const _eodTickers = useMemo(() => (rows || []).map(r => String(r.ticker || "").toUpperCase()).filter(Boolean), [rows]);
  const { byTicker: _eodByTicker } = usePricesEodBatch(_eodTickers);
  const infoMap     = info     || {};

  const _tickers = useMemo(() => (rows || []).map(r => String(r.ticker || "").toUpperCase()).filter(Boolean), [rows]);
  const { metrics: _riskByTicker } = useRiskMetricsBatch(_tickers);
  const { byTicker: _v5ByTicker } = useV5ScanBatch(_tickers);

  const enriched = useMemo(() => {
    return (rows || []).map((p) => {
      const T = String(p.ticker || "").toUpperCase();
      const sc = screenerMap[T] || {};
      const inf = infoMap[T] || {};

      const quantity = p.quantity != null ? Number(p.quantity) : null;
      const avgCost  = p.avgCost != null ? Number(p.avgCost) : null;
      const valueDb  = p.value   != null ? Number(p.value)   : null;

      // Resolve the live price + prev-close through usePricesEodBatch so
      // every list-rendering surface (Positions here, Watchlist, drawer
      // headline) reads the same number. Fallback ladder for tickers
      // outside prices_eod coverage: positions.price (Massive-synced),
      // then screener overlay (Unusual Whales), then screener prev_close.
      const eod = _eodByTicker[T] || {};

      // Cash rows are NOT marketable equities. They store dollars held
      // (price=$1, value=dollars). The prices_eod overlay must never
      // multiply a cash quantity by an equity tick — ticker collisions
      // like 'CASH' (Pathward Financial, NYSE) would otherwise mark a
      // $81K cash balance to ~$82/sh × 81K = $6.7M. Detect cash rows up
      // front and route them around the entire mark-to-market pipeline.
      const isCashRow = (p.sector === "Cash")
        || (p.assetClass === "cash")
        || (p.asset_class === "cash");

      const price = isCashRow
        ? (p.price != null ? Number(p.price) : 1)
        : (Number.isFinite(eod.close) ? eod.close
        : (p.price != null ? Number(p.price)
        : (sc.close != null ? Number(sc.close)
        : (sc.prev_close != null ? Number(sc.prev_close) : null))));
      const scPrevFallback = sc.prev_close != null ? Number(sc.prev_close) : null;
      const prev  = isCashRow
        ? price
        : (Number.isFinite(eod.prev_close) ? eod.prev_close : scPrevFallback);

      const currentValue = isCashRow
        ? valueDb
        : (price != null
            ? (quantity != null ? quantity * price : valueDb)
            : null);
      const totalCost = isCashRow
        ? valueDb
        : ((quantity != null && avgCost != null) ? quantity * avgCost : null);
      const pnl$   = isCashRow
        ? null
        : ((currentValue != null && totalCost != null) ? currentValue - totalCost : null);
      const pnlPct = isCashRow
        ? null
        : ((price != null && avgCost) ? (price / avgCost - 1) * 100 : null);

      // PNL DAY $ / % use the same (price, prev) pair the PRICE column
      // displays, so the math is internally consistent. Was previously
      // pulling sc.close/sc.prev_close which could disagree with PRICE.
      // Cash rows have no day P&L (dollars don't move against themselves).
      const perShareDay = isCashRow
        ? null
        : ((price != null && prev != null) ? price - prev : null);
      const pnlDay$   = isCashRow
        ? null
        : ((perShareDay != null && quantity != null) ? perShareDay * quantity : null);
      const pnlDayPct = isCashRow
        ? null
        : ((price != null && prev) ? (price / prev - 1) * 100 : null);

      const wealthPct = grandTotal && currentValue != null ? (currentValue / grandTotal) * 100 : null;

      const holdingDays = daysBetween(p.purchaseDate);
      const annualizedPnl = annualizedPct(currentValue, totalCost, holdingDays);

      const marketcap =
        sc.marketcap != null ? Number(sc.marketcap)
      : inf.marketcap != null ? Number(inf.marketcap)
      : null;

      const divYield = inf.dividend_yield != null ? Number(inf.dividend_yield) : null;
      const hasDividend = inf.has_dividend != null ? Boolean(inf.has_dividend) : null;
      const nextEarnings = inf.next_earnings_date || sc.next_earnings_date || null;

      const composite = (signals
        ? computeSectionComposites(T, { signals })
        : null) || { sections: {}, overall: { score: null, direction: null } };
      const sectionScores = {};
      SIGNAL_COLS.forEach(c => {
        const s = composite.sections?.[c.key];
        sectionScores[c.key] = {
          score:     s?.score ?? null,
          direction: s?.direction ?? null,
          note:      s?.note ?? null,
        };
      });

      const ivRank   = sc.iv_rank != null ? Number(sc.iv_rank) : (inf.iv_rank != null ? Number(inf.iv_rank) : null);
      const weekLow  = sc.week_52_low  != null ? Number(sc.week_52_low)  : (inf.week_52_low  != null ? Number(inf.week_52_low)  : null);
      const weekHigh = sc.week_52_high != null ? Number(sc.week_52_high) : (inf.week_52_high != null ? Number(inf.week_52_high) : null);

      return {
        ticker: T,
        name: p.name || "",
        sector: p.sector || inf.sector || sc.sector || "",
        quantity, price, avgCost, totalCost, currentValue,
        pnl$, pnlPct, pnlDay$, pnlDayPct,
        beta: p.beta != null ? Number(p.beta) : null,
        purchaseDate: p.purchaseDate || null,
        holdingDays, annualizedPnl, wealthPct,
        acctLabel: p.acctLabel || "",
        marketcap, divYield, hasDividend, nextEarnings,
        sections: sectionScores,
        overall: { score: composite.overall?.score ?? null, direction: composite.overall?.direction ?? null },
        ivRank, weekLow, weekHigh,
        _v5: _v5ByTicker[T] || null,
        assetClass:   p.assetClass   || "stock",
        contractType: p.contractType || null,
        direction:    p.direction    || null,
        strike:       p.strike     != null ? Number(p.strike)     : null,
        expiration:   p.expiration   || null,
        multiplier:   p.multiplier != null ? Number(p.multiplier) : null,
        manualPrice:  p.manualPrice != null ? Number(p.manualPrice) : null,
        _risk: _riskByTicker[T] || null,
        _raw: p,
      };
    });
  }, [rows, grandTotal, screenerMap, infoMap, _riskByTicker, signals, _v5ByTicker, _eodByTicker]);

  // Memoize columns so MTTable doesn't churn its persisted layout each render.
  const columns = useMemo(
    () => buildColumns({ onEdit, onClose, onDelete }),
    [onEdit, onClose, onDelete]
  );

  // ─── Action bar (Add / Bulk import / Rescan) — top of section ────────────
  const topBarBtn = {
    padding: "6px 12px", fontSize: 12, fontWeight: 600, color: "var(--text)",
    fontFamily: "var(--font-mono)", letterSpacing: "0.04em",
    background: "transparent", border: "1px solid var(--border)",
    borderRadius: 4, cursor: "pointer", userSelect: "none", whiteSpace: "nowrap",
  };
  const topBarPrimary = { ...topBarBtn, color: "#fff", background: "var(--accent)", border: "1px solid var(--accent)" };

  const ActionBar = () => (
    <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginBottom: 8, flexWrap: "wrap" }}>
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
        <button type="button" style={topBarBtn} onClick={onBulkImport}>Bulk import (CSV/XLSX)</button>
      )}
      {showActionBar && onAdd && (
        <button type="button" style={topBarPrimary} onClick={onAdd}>+ Add position</button>
      )}
    </div>
  );

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

  return (
    <>
      <ActionBar />
      <MTTable
        columns={columns}
        rows={enriched}
        rowKey={(r) => `${r.acctLabel}-${r.ticker}-${r._raw?.id || ""}`}
        onRowClick={(row) => onOpenTicker?.(row.ticker)}
        storageKey={tableKey}
        features="full"
      />
      <TableFootnote priceCaption={priceCaption} eventsCaption={eventsCaption} source={footnoteSource} />
    </>
  );
}
