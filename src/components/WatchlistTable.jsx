// WatchlistTable — composite-score watchlist grid, user-customizable columns.
//
// Migrated to MTTable (Tier A) 2026-05-12 as part of the unified-table sweep
// (PR feature/dev-mttable-unified-sweep-pt2). MTTable owns sort, filter,
// resize, reorder, visibility, and toolbar; column persistence is via
// localStorage keyed by `storageKey={tableKey}`. The earlier
// useTablePreferences hook (server-side prefs in user_preferences) and
// TableColumnPicker are retired alongside this migration.
//
// Props
// -----
//   rows          : Array<{ ticker, name, theme }>  from caller
//   signals       : scanData.signals (public + merged private)
//   screener      : { TICKER: { close, prev_close, marketcap, ... } }
//   info          : { TICKER: { dividend_yield, has_dividend, tags, ... } }
//   onOpenTicker  : fn(ticker)
//   heldTickers   : Set<string>
//   emptyMessage  : string
//   tableKey      : "watchlist_buy" | "watchlist_near" | "watchlist_other"
//                   used as MTTable storageKey
//   userWatchlistTickers   : Set<string> of tickers already on watchlist
//   onAddToWatchlist       : (ticker) => Promise<void>
//   onRemoveFromWatchlist  : (ticker) => Promise<void>
//   portfolioAuthed        : bool

import { useMemo, useState } from "react";
import useRiskMetricsBatch from "../hooks/useRiskMetricsBatch";
import useV5ScanBatch from "../hooks/useV5ScanBatch";
import { Tip } from "../InfoTip";
import {
  computeSectionComposites,
  colorForDirection,
  SECTION_ORDER,
} from "../ticker/sectionComposites";
import { normalizeTickerName } from "../lib/nameFormat";
import MTTable from "./MTTable";

const SIGNAL_COLS = [
  { key: "technicals", short: "Technical",             long: "Technicals (25%)" },
  { key: "insider",    short: "Insider Transactions",  long: "Insiders (25%)" },
  { key: "options",    short: "Options Flow",          long: "Option Flow (20%)" },
  { key: "congress",   short: "Congressional Trades",  long: "Congress (15%)" },
  { key: "analyst",    short: "Analyst Ratings",       long: "Analyst (10%)" },
  { key: "darkpool",   short: "Dark Pool",             long: "Dark Pool (5%)" },
];

if (SIGNAL_COLS.length !== SECTION_ORDER.length) {
  // eslint-disable-next-line no-console
  console.warn("WatchlistTable: SIGNAL_COLS out of sync with SECTION_ORDER");
}

// ─── Dual-class share registry ───────────────────────────────────────────────
const DUAL_CLASS_GROUPS = [
  ["BATRA", "BATRK"],         // Liberty Atlanta Braves
  ["BF.A",  "BF.B"],          // Brown-Forman
  ["BRK.A", "BRK.B"],         // Berkshire Hathaway
  ["CRD.A", "CRD.B"],         // Crawford & Co
  ["CWEN",  "CWEN.A"],        // Clearway Energy
  ["FOX",   "FOXA"],          // Fox Corp
  ["FWONA", "FWONK"],         // Liberty Formula One
  ["GEF",   "GEF.B"],         // Greif
  ["GOOG",  "GOOGL"],         // Alphabet
  ["HEI",   "HEI.A"],         // HEICO
  ["LBRDA", "LBRDK"],         // Liberty Broadband
  ["LEN",   "LEN.B"],         // Lennar
  ["LGF.A", "LGF.B"],         // Lions Gate
  ["LSXMA", "LSXMK"],         // Liberty SiriusXM
  ["MOG.A", "MOG.B"],         // Moog
  ["NWS",   "NWSA"],          // News Corp
  ["PBR",   "PBR.A"],         // Petrobras
  ["RUSHA", "RUSHB"],         // Rush Enterprises
  ["TAP",   "TAP.A"],         // Molson Coors
  ["UA",    "UAA"],           // Under Armour
  ["UHAL",  "UHAL.B"],        // U-Haul (AMERCO)
];
const _normTicker = (t) => String(t || "").toUpperCase().replace(/[.\-]/g, "");
const _DUAL_CLASS_INDEX = (() => {
  const idx = {};
  for (const group of DUAL_CLASS_GROUPS) {
    for (const t of group) {
      const key = _normTicker(t);
      if (!key) continue;
      idx[key] = group.filter((x) => _normTicker(x) !== key);
    }
  }
  return idx;
})();
function dualClassPeersOf(ticker) {
  const peers = _DUAL_CLASS_INDEX[_normTicker(ticker)];
  return Array.isArray(peers) && peers.length ? peers : null;
}

// ─── formatters ─────────────────────────────────────────────────────────────
const fmt$ = (v) =>
  v == null || !isFinite(v) ? "—" :
  `$${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fmtPctSigned = (v) =>
  v == null || !isFinite(v) ? "—" : `${v >= 0 ? "+" : ""}${Number(v).toFixed(1)}%`;

const fmtMcap = (v) => {
  if (v == null) return "—";
  const n = Number(v);
  if (!isFinite(n) || n <= 0) return "—";
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9)  return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6)  return `$${(n / 1e6).toFixed(1)}M`;
  return `$${(n / 1e3).toFixed(0)}K`;
};

const fmtDate = (v) => {
  if (!v) return "—";
  try {
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  } catch { return "—"; }
};

// Section composite score cell — unchanged from pre-migration.
function ScoreCell({ score, direction, emptyHint }) {
  if (score == null && emptyHint) {
    return (
      <Tip def={emptyHint}>
        <span style={{ color: "var(--text-dim)", fontFamily: "var(--font-ui)", fontVariantNumeric: "tabular-nums", fontSize: 12, fontWeight: 500 }}>—</span>
      </Tip>
    );
  }
  const col = score == null ? "var(--text-dim)" : colorForDirection(direction);
  const display = score == null ? "—" : (score >= 0 ? "+" : "") + score;
  return (
    <span style={{ color: col, fontFamily: "var(--font-ui)", fontVariantNumeric: "tabular-nums", fontWeight: 600, fontSize: 12 }}>
      {display}
    </span>
  );
}

// Watch button (per-row action) — unchanged from pre-migration.
function WatchActionCell({ ticker, onWatchlist, onAdd, onRemove, busy, portfolioAuthed }) {
  const handle = (e) => {
    e.stopPropagation();
    if (!portfolioAuthed) { onAdd?.(ticker); return; }
    if (onWatchlist) onRemove?.(ticker);
    else             onAdd?.(ticker);
  };
  const label = onWatchlist ? "✓ Watching" : "+ Watch";
  const color = onWatchlist ? "var(--text-muted)" : "var(--accent)";
  return (
    <button
      type="button"
      onClick={handle}
      disabled={busy}
      style={{
        background: "transparent",
        border: "1px solid " + (onWatchlist ? "var(--border)" : "var(--accent)"),
        color: color,
        borderRadius: 4,
        padding: "2px 8px",
        fontFamily: "var(--font-ui)",
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: "0.04em",
        cursor: busy ? "wait" : "pointer",
        whiteSpace: "nowrap",
        opacity: busy ? 0.5 : 1,
        transition: "all 120ms",
      }}
      title={portfolioAuthed ? (onWatchlist ? "Remove from watchlist" : "Add to watchlist") : "Sign in to track tickers"}
    >
      {label}
    </button>
  );
}

// ─── MTTable column registry ─────────────────────────────────────────────────
// Schema per MTTable: { key, label, numeric?, defaultVisible?, defaultWidth?,
// tooltip?, render?(row), sortValue?(row) }
// numeric:true triggers right-aligned monospace tabular-nums per MTTable CSS.
function buildColumns() {
  const baseCols = [
    {
      key: "ticker", label: "TICKER", defaultWidth: 110,
      tooltip: "Ticker symbol (OWNED if held; DUAL-CLASS if multiple share classes of the same company exist)",
      sortValue: (r) => r.ticker,
      render: (r) => {
        const peers = dualClassPeersOf(r.ticker);
        return (
          <>
            <span style={{ fontFamily: "var(--font-mono)", fontWeight: 700, color: "var(--text)" }}>
              {r.ticker}
            </span>
            {r.held && (
              <span style={{
                marginLeft: 6, fontSize: 9, color: "var(--accent)",
                border: "1px solid var(--accent)", borderRadius: 3,
                padding: "1px 4px", fontFamily: "var(--font-mono)", fontWeight: 700,
              }}>OWNED</span>
            )}
            {peers && (
              <Tip
                label="DUAL-CLASS"
                def={`${r.ticker} and ${peers.join(", ")} are different share classes of the same underlying company. Both can appear in scanner output — the score difference is usually small and reflects liquidity or vote weight, not a different business. Pick whichever class you prefer.`}
              >
                <span style={{
                  marginLeft: 6, fontSize: 9, color: "var(--text-muted)",
                  border: "1px solid var(--border-strong)", borderRadius: 3,
                  padding: "1px 4px", fontFamily: "var(--font-mono)", fontWeight: 700,
                  cursor: "help",
                }}>DUAL-CLASS</span>
              </Tip>
            )}
          </>
        );
      },
    },
    {
      key: "name", label: "NAME", defaultWidth: 240,
      tooltip: "Company name",
      sortValue: (r) => (r.name || "").toLowerCase(),
      render: (r) => (
        <span style={{
          color: "var(--text-muted)", maxWidth: 240, display: "inline-block",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          verticalAlign: "bottom",
        }} title={r.name}>{r.name || "—"}</span>
      ),
    },
    {
      key: "sector", label: "SECTOR", defaultWidth: 140, categorical: true,
      tooltip: "Sector (industry not always available)",
      sortValue: (r) => (r.sector || "").toLowerCase(),
      render: (r) => (
        <span style={{ color: "var(--text-dim)", fontFamily: "var(--font-mono)", fontSize: 11, whiteSpace: "nowrap" }}>
          {r.sector || "—"}
        </span>
      ),
    },
    {
      key: "price", label: "PRICE", numeric: true, defaultWidth: 100,
      tooltip: "Current price per share (from scanner's screener feed)",
      sortValue: (r) => r.price,
      render: (r) => (
        <span style={{ fontFamily: "var(--font-mono)", color: "var(--text)" }}>{fmt$(r.price)}</span>
      ),
    },
    {
      key: "dayChangePct", label: "DAY %", numeric: true, defaultWidth: 90,
      tooltip: "Today's percent change",
      sortValue: (r) => r.dayChangePct,
      render: (r) => {
        const c = r.dayChangePct == null ? "var(--text-muted)" : r.dayChangePct >= 0 ? "var(--green)" : "var(--red)";
        return (
          <span style={{ fontFamily: "var(--font-mono)", color: c, fontWeight: 600 }}>
            {fmtPctSigned(r.dayChangePct)}
          </span>
        );
      },
    },
    {
      key: "marketcap", label: "MARKET CAP", numeric: true, defaultWidth: 110,
      tooltip: "Company market capitalization",
      sortValue: (r) => r.marketcap,
      render: (r) => (
        <span style={{ fontFamily: "var(--font-mono)", color: "var(--text-muted)" }}>{fmtMcap(r.marketcap)}</span>
      ),
    },
    {
      key: "ivRank", label: "IV RANK", numeric: true, defaultWidth: 90,
      tooltip: "Implied volatility rank (0–100, higher = more option premium)",
      sortValue: (r) => r.ivRank,
      render: (r) => (
        <span style={{ fontFamily: "var(--font-mono)", color: "var(--text-muted)" }}>
          {r.ivRank == null ? "—" : Number(r.ivRank).toFixed(1)}
        </span>
      ),
    },
    {
      key: "divYield", label: "DIV YIELD", numeric: true, defaultWidth: 100,
      tooltip: "Dividend yield where available; 'Y'/'N' if only has-dividend flag is known.",
      sortValue: (r) => r.divYield != null ? r.divYield : (r.hasDividend ? 0.001 : null),
      render: (r) => {
        if (r.divYield != null && isFinite(r.divYield)) {
          const pct = r.divYield * (r.divYield < 1 ? 100 : 1);
          return <span style={{ fontFamily: "var(--font-mono)", color: "var(--text-muted)" }}>{pct.toFixed(2)}%</span>;
        }
        if (r.hasDividend === true)  return <span style={{ color: "var(--text-dim)", fontFamily: "var(--font-mono)" }}>Y</span>;
        if (r.hasDividend === false) return <span style={{ color: "var(--text-dim)", fontFamily: "var(--font-mono)" }}>N</span>;
        return <span style={{ color: "var(--text-dim)", fontFamily: "var(--font-mono)" }}>—</span>;
      },
    },
    {
      key: "nextEarnings", label: "NEXT EARNINGS", numeric: true, defaultWidth: 130,
      tooltip: "Next expected earnings date",
      sortValue: (r) => r.nextEarnings ? new Date(r.nextEarnings).getTime() : null,
      render: (r) => (
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-dim)" }}>
          {fmtDate(r.nextEarnings)}
        </span>
      ),
    },
    {
      key: "week52", label: "52W RANGE", numeric: true, defaultWidth: 160,
      tooltip: "52-week low / high",
      sortValue: (r) => r.weekHigh,
      render: (r) => (
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-dim)" }}>
          {r.weekLow != null && r.weekHigh != null ? `${fmt$(r.weekLow)} – ${fmt$(r.weekHigh)}` : "—"}
        </span>
      ),
    },
    {
      key: "theme", label: "THEME", defaultWidth: 220,
      tooltip: "Your watchlist note for this ticker",
      sortValue: (r) => (r.theme || "").toLowerCase(),
      render: (r) => (
        <span style={{
          color: "var(--text-dim)", fontSize: 11, maxWidth: 220, display: "inline-block",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", verticalAlign: "bottom",
        }} title={r.theme}>{r.theme || "—"}</span>
      ),
    },
  ];

  // v5 Trading Opps columns (Joe directive 2026-05-11) — numbers here match
  // the Trading Opps page exactly for the same ticker on the same scan_date.
  const v5Cols = [
    {
      key: "mt_score", label: "MT SCORE", numeric: true, defaultWidth: 100,
      tooltip: "MacroTilt Score — weighted blend of six v5 signals (−100 bearish → +100 bullish). Live engine that powers Trading Opps.",
      sortValue: (r) => r._v5?.mt_score ?? null,
      render: (r) => {
        const v = r._v5?.mt_score;
        if (v == null) return <span style={{color:"var(--text-dim)"}}>—</span>;
        const col = v >= 50 ? "var(--green-text, var(--green))" : v >= 20 ? "var(--green)" : v <= -50 ? "var(--red-text, var(--red))" : v <= -20 ? "var(--red)" : "var(--text)";
        return <span style={{ fontFamily: "var(--font-ui)", fontVariantNumeric: "tabular-nums", fontWeight: 700, color: col, fontSize: 13 }}>{v >= 0 ? "+" : ""}{Number(v).toFixed(1)}</span>;
      },
    },
    {
      key: "band", label: "BAND", categorical: true, defaultWidth: 110,
      tooltip: "Strong Sell / Sell Watch / Neutral / Buy Watch / Strong Buy. Cutoffs at MT Score −50, −20, +20, +50.",
      // filterValue is the string label used by the + Filter picker;
      // sortValue is the numeric rank used by column-header sort.
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
      tooltip: "GICS Industry Group (25 mid-level buckets). Derived from SIC code via the same SIC→GICS mapping Trading Opps uses.",
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
      tooltip: "Short Interest sub-score (−100 to +100). Rising SI + rising borrow cost above 50-day SMA = bearish; high SI + cheap borrow into earnings = bullish squeeze setup.",
      sortValue: (r) => r._v5?.sub_short_interest ?? null,
      render: (r) => {
        const v = r._v5?.sub_short_interest;
        if (v == null) return <span style={{color:"var(--text-dim)"}}>—</span>;
        const col = v >= 20 ? "var(--green-text)" : v <= -20 ? "var(--red-text)" : "var(--text)";
        return <span style={{ fontFamily: "var(--font-ui)", fontVariantNumeric: "tabular-nums", fontWeight: 600, color: col, fontSize: 12 }}>{v >= 0 ? "+" : ""}{Number(v).toFixed(0)}</span>;
      },
    },
    {
      key: "rsi_14", label: "RSI(14)", numeric: true, defaultWidth: 85,
      tooltip: "14-day Relative Strength Index. >70 conventionally overbought; <30 oversold.",
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
      tooltip: "Bollinger band-width as percent of 20-day MA. <5% = compression / squeeze (amber). >15% = expansion / trend in motion.",
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
      tooltip: "Today's volume / 20-day average. ≥1.5× = unusual activity (green); <0.7× = quiet (amber); 1.0× = average.",
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
      tooltip: "Today's close as percent distance from the 50-day SMA. >+5% uptrend; <−5% downtrend.",
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
      tooltip: "Today's close as percent distance from the 200-day SMA. >+10% strong uptrend; <−10% downtrend.",
      sortValue: (r) => r._v5?.pct_200ma ?? null,
      render: (r) => {
        const v = r._v5?.pct_200ma;
        if (v == null) return <span style={{color:"var(--text-dim)"}}>—</span>;
        const col = v > 10 ? "var(--green-text)" : v < -10 ? "var(--red-text)" : "var(--text)";
        return <span style={{ fontFamily: "var(--font-mono)", color: col }}>{v >= 0 ? "+" : ""}{v.toFixed(1)}%</span>;
      },
    },
    {
      key: "ins_buys", label: "INSIDER BUYS (#)", numeric: true, defaultWidth: 115,
      tooltip: "Number of Form 4 open-market buy events by officers / directors in the recent window.",
      sortValue: (r) => r._v5?.ins_buys ?? null,
      render: (r) => {
        const v = r._v5?.ins_buys;
        if (v == null) return <span style={{color:"var(--text-dim)"}}>—</span>;
        return <span style={{ fontFamily: "var(--font-mono)", color: v > 0 ? "var(--green-text)" : "var(--text-dim)" }}>{v}</span>;
      },
    },
    {
      key: "ins_buy_$", label: "INSIDER BUYS ($)", numeric: true, defaultWidth: 130,
      tooltip: "Total $ value of recent Form 4 open-market buy events.",
      sortValue: (r) => r._v5?.["ins_buy_$"] ?? null,
      render: (r) => {
        const v = r._v5?.["ins_buy_$"];
        if (v == null) return <span style={{color:"var(--text-dim)"}}>—</span>;
        const m = v >= 1e9 ? `$${(v/1e9).toFixed(2)}B` : v >= 1e6 ? `$${(v/1e6).toFixed(1)}M` : v >= 1e3 ? `$${(v/1e3).toFixed(0)}K` : `$${v.toFixed(0)}`;
        return <span style={{ fontFamily: "var(--font-mono)", color: v > 0 ? "var(--green-text)" : "var(--text-dim)" }}>{m}</span>;
      },
    },
  ];

  const riskCols = [
    {
      key: "beta_2y", label: "BETA · 2Y", numeric: true, defaultWidth: 90,
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
      key: "annVol_2y", label: "ANN VOL", numeric: true, defaultWidth: 90,
      tooltip: "Annualized volatility — 2Y daily standard deviation × √252. ~15-25% normal for diversified equities; 25-40% elevated; >40% high-beta single-name.",
      sortValue: (r) => r._risk?.annVol ?? null,
      render: (r) => {
        const v = r._risk?.annVol;
        if (v == null) return <span style={{color:"var(--text-dim)"}}>—</span>;
        const col = v > 0.40 ? "var(--red-text)" : v > 0.25 ? "var(--orange-text)" : "var(--text)";
        return <span style={{ fontFamily: "var(--font-mono)", color: col }}>{(v*100).toFixed(1)}%</span>;
      },
    },
    {
      key: "maxDD_2y", label: "MAX DD", numeric: true, defaultWidth: 90,
      tooltip: "Max peak-to-trough decline over 2 years. Worst-case drawdown without selling.",
      sortValue: (r) => r._risk?.maxDD ?? null,
      render: (r) => {
        const v = r._risk?.maxDD;
        if (v == null) return <span style={{color:"var(--text-dim)"}}>—</span>;
        const col = v > 0.40 ? "var(--red-text)" : v > 0.25 ? "var(--orange-text)" : "var(--text)";
        return <span style={{ fontFamily: "var(--font-mono)", color: col }}>{(v*100).toFixed(1)}%</span>;
      },
    },
    {
      key: "var10d99", label: "10D 99% VaR", numeric: true, defaultWidth: 110,
      tooltip: "10-day 99% historical VaR. 2Y daily, rolling 10-day windows, 1st percentile worst outcome.",
      sortValue: (r) => r._risk?.var10d99 ?? null,
      render: (r) => {
        const v = r._risk?.var10d99;
        if (v == null) return <span style={{color:"var(--text-dim)"}}>—</span>;
        const col = v > 0.20 ? "var(--red-text)" : v > 0.10 ? "var(--orange-text)" : "var(--text)";
        return <span style={{ fontFamily: "var(--font-mono)", color: col }}>{(v*100).toFixed(1)}%</span>;
      },
    },
  ];

  const watchCol = {
    key: "_watch", label: "", defaultWidth: 100,
    tooltip: "Add or remove this ticker from your watchlist.",
    sortValue: () => null,
    render: (r) => r._watch || null,
  };

  // Final column order — base (ticker/name/sector) → v5 cluster (MT Score is
  // the primary scan output) → portfolio cols (price/mcap/yield/earnings) →
  // risk cluster → watch action.
  return [
    baseCols[0], baseCols[1], baseCols[2],            // ticker, name, sector
    ...v5Cols,                                         // mt_score, band, ig, ...
    baseCols[3], baseCols[4], baseCols[5],            // price, day%, mcap
    baseCols[6], baseCols[7], baseCols[8], baseCols[9], // ivRank, divYield, nextEarnings, week52
    baseCols[10],                                      // theme
    ...riskCols,                                       // beta, annVol, maxDD, VaR
    watchCol,
  ];
}

const COLUMNS = buildColumns();

export default function WatchlistTable({
  rows, signals, screener, info,
  onOpenTicker, heldTickers, emptyMessage,
  tableKey = "watchlist_other",
  userWatchlistTickers,
  onAddToWatchlist,
  onRemoveFromWatchlist,
  portfolioAuthed = false,
}) {
  const [watchBusy, setWatchBusy] = useState(null);
  const onAdd = async (t) => {
    if (!onAddToWatchlist) return;
    setWatchBusy(t);
    try { await onAddToWatchlist(t); } finally { setWatchBusy(null); }
  };
  const onRemove = async (t) => {
    if (!onRemoveFromWatchlist) return;
    setWatchBusy(t);
    try { await onRemoveFromWatchlist(t); } finally { setWatchBusy(null); }
  };
  const screenerMap = screener || {};
  const infoMap     = info     || {};

  // Risk metrics + v5 batch — same hooks as pre-migration.
  const _tickers = useMemo(() => (rows || []).map(r => String(r.ticker || "").toUpperCase()).filter(Boolean), [rows]);
  const { metrics: _riskByTicker } = useRiskMetricsBatch(_tickers);
  const { byTicker: _v5ByTicker } = useV5ScanBatch(_tickers);

  const enriched = useMemo(() => {
    return (rows || []).map((w) => {
      const t = (w.ticker || "").toUpperCase();
      const sc = screenerMap[t] || {};
      const inf = infoMap[t] || {};

      const composite = computeSectionComposites(t, { signals }) || {
        sections: {}, overall: { score: null, direction: null },
      };
      const sectionScores = {};
      SIGNAL_COLS.forEach(c => {
        const s = composite.sections?.[c.key];
        sectionScores[c.key] = {
          score:     s?.score ?? null,
          direction: s?.direction ?? null,
          note:      s?.note ?? null,
        };
      });

      const hasRealName = w.name && w.name.trim().toUpperCase() !== t;
      const rawName = hasRealName ? w.name : (sc.full_name || inf.full_name || "");

      const price    = sc.close != null ? Number(sc.close) : (sc.prev_close != null ? Number(sc.prev_close) : null);
      const prev     = sc.prev_close != null ? Number(sc.prev_close) : null;
      const dayChangePct = (price != null && prev) ? (price / prev - 1) * 100 : null;

      const onWatchlist = userWatchlistTickers ? userWatchlistTickers.has(t) : false;
      return {
        ticker: t,
        _watch: (
          <WatchActionCell
            ticker={t}
            onWatchlist={onWatchlist}
            onAdd={onAdd}
            onRemove={onRemove}
            busy={watchBusy === t}
            portfolioAuthed={portfolioAuthed}
          />
        ),
        name: normalizeTickerName(rawName),
        sector: sc.sector || inf.sector || "",
        theme: w.theme || "",
        held: heldTickers?.has?.(t) || false,
        sections: sectionScores,
        overall: {
          score: composite.overall?.score ?? null,
          direction: composite.overall?.direction ?? null,
        },
        price,
        dayChangePct,
        marketcap: sc.marketcap != null ? Number(sc.marketcap) : (inf.marketcap != null ? Number(inf.marketcap) : null),
        ivRank: sc.iv_rank != null ? Number(sc.iv_rank) : null,
        divYield: inf.dividend_yield != null ? Number(inf.dividend_yield) : null,
        hasDividend: inf.has_dividend != null ? Boolean(inf.has_dividend) : null,
        nextEarnings: inf.next_earnings_date || sc.next_earnings_date || null,
        weekLow:  sc.week_52_low  != null ? Number(sc.week_52_low)  : null,
        weekHigh: sc.week_52_high != null ? Number(sc.week_52_high) : null,
        _risk:    _riskByTicker[t] || null,
        _v5:      _v5ByTicker[t] || null,
      };
    });
  }, [rows, signals, screenerMap, infoMap, heldTickers, _riskByTicker, _v5ByTicker, userWatchlistTickers, watchBusy, portfolioAuthed]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <MTTable
      columns={COLUMNS}
      rows={enriched}
      rowKey="ticker"
      onRowClick={(row) => onOpenTicker?.(row.ticker)}
      storageKey={tableKey}
      features="full"
      emptyMessage={emptyMessage || "No tickers on your watchlist. Add one below."}
    />
  );
}
