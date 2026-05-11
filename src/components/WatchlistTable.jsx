// WatchlistTable — composite-score watchlist grid, user-customizable columns.
//
// Item 36 retrofit: adds "Edit columns" picker + drag-reorder. Default
// visible columns stay the same as before (ticker, name, sector, TECH, INS,
// OPT, CON, ANL, DP, OVR) so existing users' views don't change on upgrade.
// Additional columns (PRICE, MARKET CAP, NEXT EARNINGS, PNL DAY %, IV RANK,
// DIV YIELD, TAGS, COMPOSITE SIZE, etc.) are available via the picker.
//
// Props
// -----
//   rows          : Array<{ ticker, name, theme }>  from caller
//   signals       : scanData.signals (public + merged private)
//   screener      : { TICKER: { close, prev_close, marketcap, ... } }
//   info          : { TICKER: { dividend_yield, has_dividend, tags, ... } }
//   onOpenTicker  : fn(ticker)
//   heldTickers   : Set<string>  — for the OWNED pill on ticker cell
//   emptyMessage  : string
//   tableKey      : "watchlist_buy" | "watchlist_near" | "watchlist_other"
//                   keyed independently in user_preferences so each instance
//                   can have its own layout (buy-alerts users will often want
//                   a different view than the full watchlist)

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
import TableColumnPicker from "./TableColumnPicker";
import { useTablePreferences } from "../hooks/useTablePreferences";

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
// Some companies trade under two share classes (different vote weights /
// economic rights). The scanner treats each ticker independently, so the
// same underlying business can appear twice in Buy Alerts / Near Trigger.
// We tag each row with a small "DUAL-CLASS" badge so the user knows at a
// glance — hovering it lists the sister ticker(s) in the same group.
//
// Lookup is normalized: "BRK.A" / "BRK-A" / "BRKA" all match. Maintain
// alphabetical order; add a comment explaining the company on every entry.
const DUAL_CLASS_GROUPS = [
  ["BATRA", "BATRK"],         // Liberty Atlanta Braves — A / K
  ["BF.A",  "BF.B"],          // Brown-Forman — voting / non-voting
  ["BRK.A", "BRK.B"],         // Berkshire Hathaway — original / lower vote
  ["CRD.A", "CRD.B"],         // Crawford & Co
  ["CWEN",  "CWEN.A"],        // Clearway Energy — Class C / Class A
  ["FOX",   "FOXA"],          // Fox Corp — non-voting / voting
  ["FWONA", "FWONK"],         // Liberty Formula One — A / K
  ["GEF",   "GEF.B"],         // Greif — A / B
  ["GOOG",  "GOOGL"],         // Alphabet — Class C non-voting / Class A
  ["HEI",   "HEI.A"],         // HEICO — common / Class A
  ["LBRDA", "LBRDK"],         // Liberty Broadband — A / K
  ["LEN",   "LEN.B"],         // Lennar — Class A / Class B
  ["LGF.A", "LGF.B"],         // Lions Gate — voting / non-voting
  ["LSXMA", "LSXMK"],         // Liberty SiriusXM — A / K
  ["MOG.A", "MOG.B"],         // Moog
  ["NWS",   "NWSA"],          // News Corp — non-voting / voting
  ["PBR",   "PBR.A"],         // Petrobras — common ADR / preferred ADR
  ["RUSHA", "RUSHB"],         // Rush Enterprises — A / B
  ["TAP",   "TAP.A"],         // Molson Coors — Class B / Class A
  ["UA",    "UAA"],           // Under Armour — Class C / Class A
  ["UHAL",  "UHAL.B"],        // U-Haul (AMERCO) — voting / non-voting
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


// ─── formatters (abbreviated — full set lives in PositionsTable) ─────────────
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

function SortArrow({ dir }) {
  if (!dir) return <span style={{ opacity: 0.3, marginLeft: 4 }}>↕</span>;
  return <span style={{ marginLeft: 4, color: "var(--text)" }}>{dir === "asc" ? "▲" : "▼"}</span>;
}

// Section composite score cell.
// Bug #1076 — when score is null AND the section composite explicitly
// reports "no qualifying activity" (vs. a generic missing-data null), we
// render a faint dashed-border "no activity" pill with a hover tooltip
// instead of the bare em-dash. The score itself stays null so the section
// is still excluded from the weighted OVR composite (sectionComposites.js
// guards on r.score != null) — this is a pure visual change. No math.
function ScoreCell({ score, direction, emptyHint }) {
  // Empty-state: clean em-dash (Bloomberg-grade neutrality), reason on hover.
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


// ─── Watch button (per-row action) ──────────────────────────────────────────
// Renders inline in the trailing column. If the user is signed in:
//   - Already on watchlist: shows muted "✓ Watching" with click-to-remove.
//   - Not on watchlist:     shows accent "+ Watch" with click-to-add.
// Signed-out: shows "+ Watch" but click prompts sign-in (handled upstream).
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

// ─── Column registry ─────────────────────────────────────────────────────────
const baseCols = [
  {
    id: "ticker", label: "TICKER", description: "Ticker symbol (OWNED if held; DUAL-CLASS if multiple share classes of the same company exist)",
    align: "left",
    sortValue: (r) => r.ticker,
    renderCell: (r) => {
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
    id: "name", label: "NAME", description: "Company name", align: "left",
    sortValue: (r) => (r.name || "").toLowerCase(),
    renderCell: (r) => (
      <span style={{
        color: "var(--text-muted)", maxWidth: 240, display: "inline-block",
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        verticalAlign: "bottom",
      }} title={r.name}>{r.name || "—"}</span>
    ),
  },
  {
    id: "sector", label: "SECTOR", description: "Sector (industry not always available)",
    align: "left",
    sortValue: (r) => (r.sector || "").toLowerCase(),
    renderCell: (r) => (
      <span style={{ color: "var(--text-dim)", fontFamily: "var(--font-mono)", fontSize: 11, whiteSpace: "nowrap" }}>
        {r.sector || "—"}
      </span>
    ),
  },
  {
    id: "price", label: "PRICE", description: "Current price per share (from scanner's screener feed)",
    align: "right",
    sortValue: (r) => r.price,
    renderCell: (r) => (
      <span style={{ fontFamily: "var(--font-mono)", color: "var(--text)" }}>{fmt$(r.price)}</span>
    ),
  },
  {
    id: "dayChangePct", label: "DAY %", description: "Today's percent change",
    align: "right",
    sortValue: (r) => r.dayChangePct,
    renderCell: (r) => {
      const c = r.dayChangePct == null ? "var(--text-muted)" : r.dayChangePct >= 0 ? "var(--green)" : "var(--red)";
      return (
        <span style={{ fontFamily: "var(--font-mono)", color: c, fontWeight: 600 }}>
          {fmtPctSigned(r.dayChangePct)}
        </span>
      );
    },
  },
  {
    id: "marketcap", label: "MARKET CAP", description: "Company market capitalization",
    align: "right",
    sortValue: (r) => r.marketcap,
    renderCell: (r) => (
      <span style={{ fontFamily: "var(--font-mono)", color: "var(--text-muted)" }}>{fmtMcap(r.marketcap)}</span>
    ),
  },
  {
    id: "ivRank", label: "IV RANK", description: "Implied volatility rank (0–100, higher = more option premium)",
    align: "right",
    sortValue: (r) => r.ivRank,
    renderCell: (r) => (
      <span style={{ fontFamily: "var(--font-mono)", color: "var(--text-muted)" }}>
        {r.ivRank == null ? "—" : Number(r.ivRank).toFixed(1)}
      </span>
    ),
  },
  {
    id: "divYield", label: "DIV YIELD",
    description: "Dividend yield where available; 'Y'/'N' if only has-dividend flag is known.",
    align: "right",
    sortValue: (r) => r.divYield != null ? r.divYield : (r.hasDividend ? 0.001 : null),
    renderCell: (r) => {
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
    id: "nextEarnings", label: "NEXT EARNINGS", description: "Next expected earnings date",
    align: "right",
    sortValue: (r) => r.nextEarnings ? new Date(r.nextEarnings).getTime() : null,
    renderCell: (r) => (
      <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-dim)" }}>
        {fmtDate(r.nextEarnings)}
      </span>
    ),
  },
  {
    id: "week52", label: "52W RANGE", description: "52-week low / high",
    align: "right",
    sortValue: (r) => r.weekHigh,
    renderCell: (r) => (
      <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-dim)" }}>
        {r.weekLow != null && r.weekHigh != null ? `${fmt$(r.weekLow)} – ${fmt$(r.weekHigh)}` : "—"}
      </span>
    ),
  },
  {
    id: "theme", label: "THEME", description: "Your watchlist note for this ticker",
    align: "left",
    sortValue: (r) => (r.theme || "").toLowerCase(),
    renderCell: (r) => (
      <span style={{
        color: "var(--text-dim)", fontSize: 11, maxWidth: 220, display: "inline-block",
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", verticalAlign: "bottom",
      }} title={r.theme}>{r.theme || "—"}</span>
    ),
  },
];

const signalCols = SIGNAL_COLS.map((c) => ({
  id: c.key,
  label: c.short,
  description: c.long,
  align: "center",
  sortValue: (r) => r.sections[c.key]?.score,
  renderCell: (r) => {
    const s = r.sections[c.key] || {};
    // Bug #1076 — explicit "no qualifying activity" for the INS column
    // renders as a styled pill with a hover explainer, instead of "—".
    // OVR math is unchanged: s.score stays null and is still dropped
    // from the weighted overall composite.
    const emptyHint =
      c.key === "insider" && s.score == null && s.note === "no data"
        ? "No qualifying insider Form-4 buys or sells in the last 30 days. Insider activity is genuinely sparse — most US equities don't have any in any given month. The OVR composite re-weights across the sections that do have data."
        : null;
    return <ScoreCell score={s.score} direction={s.direction} emptyHint={emptyHint} />;
  },
}));

const overallCol = {
  id: "overall",
  label: "Overall",
  description: "Overall weighted composite (−100 bearish → +100 bullish)",
  align: "center",
  sortValue: (r) => r.overall.score,
  renderCell: (r) => <ScoreCell score={r.overall.score} direction={r.overall.direction} />,
};

const riskCols = [
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
    description: "Annualized volatility — 2Y daily standard deviation × √252. ~15-25% normal for diversified equities; 25-40% elevated; >40% high-beta single-name.",
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
    description: "Max peak-to-trough decline over 2 years. Worst-case drawdown without selling.",
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
    description: "10-day 99% historical VaR. 2Y daily, rolling 10-day windows, 1st percentile worst outcome.",
    align: "right",
    sortValue: (r) => r._risk?.var10d99 ?? null,
    renderCell: (r) => {
      const v = r._risk?.var10d99;
      if (v == null) return <span style={{color:"var(--text-dim)"}}>—</span>;
      const col = v > 0.20 ? "var(--red-text)" : v > 0.10 ? "var(--orange-text)" : "var(--text)";
      return <span style={{ fontFamily: "var(--font-mono)", color: col }}>{(v*100).toFixed(1)}%</span>;
    },
  },
];

const watchCol = {
  id: "_watch",
  label: "",
  description: "Add or remove this ticker from your watchlist.",
  align: "center",
  // The cell renderer reads watchProps from the row object, which the
  // table injects when it receives onAdd / onRemove / userWatchlistTickers.
  renderCell: (r) => r._watch || null,
};
// ── v5 Trading Opps columns merged 2026-05-11 (Joe directive). Numbers
// here match the Trading Opps page exactly for the same ticker on the
// same scan_date. ───────────────────────────────────────────────────────
const v5Cols = [
  {
    id: "mt_score", label: "MT SCORE", description: "MacroTilt Score — weighted blend of six v5 signals (−100 bearish → +100 bullish). Live engine that powers Trading Opps.",
    align: "center",
    sortValue: (r) => r._v5?.mt_score ?? null,
    renderCell: (r) => {
      const v = r._v5?.mt_score;
      if (v == null) return <span style={{color:"var(--text-dim)"}}>—</span>;
      const col = v >= 50 ? "var(--green-text, var(--green))" : v >= 20 ? "var(--green)" : v <= -50 ? "var(--red-text, var(--red))" : v <= -20 ? "var(--red)" : "var(--text)";
      return <span style={{ fontFamily: "var(--font-ui)", fontVariantNumeric: "tabular-nums", fontWeight: 700, color: col, fontSize: 13 }}>{v >= 0 ? "+" : ""}{Number(v).toFixed(1)}</span>;
    },
  },
  {
    id: "band", label: "BAND", description: "Strong Sell / Sell Watch / Neutral / Buy Watch / Strong Buy. Cutoffs at MT Score −50, −20, +20, +50.",
    align: "center",
    sortValue: (r) => {
      const order = { "Strong Sell": -2, "Sell Watch": -1, "Neutral": 0, "Buy Watch": 1, "Strong Buy": 2 };
      return order[r._v5?.band] ?? null;
    },
    renderCell: (r) => {
      const b = r._v5?.band;
      if (!b) return <span style={{color:"var(--text-dim)"}}>—</span>;
      const col = b === "Strong Buy" ? "var(--green-text, var(--green))" : b === "Buy Watch" ? "var(--green)" : b === "Sell Watch" ? "var(--red)" : b === "Strong Sell" ? "var(--red-text, var(--red))" : "var(--text-muted)";
      return <span style={{ fontFamily: "var(--font-ui)", fontSize: 11, fontWeight: 600, color: col }}>{b}</span>;
    },
  },
  {
    id: "ig", label: "INDUSTRY GROUP", description: "GICS Industry Group (25 mid-level buckets). Derived from SIC code via the same SIC→GICS mapping Trading Opps uses.",
    align: "left",
    sortValue: (r) => (r._v5?.ig || "").toLowerCase(),
    renderCell: (r) => (
      <span style={{ color: "var(--text-dim)", fontFamily: "var(--font-mono)", fontSize: 11, whiteSpace: "nowrap" }} title={r._v5?.ig}>
        {r._v5?.ig || "—"}
      </span>
    ),
  },
  {
    id: "sub_short_interest", label: "SHORT INT", description: "Short Interest sub-score (−100 to +100). Rising SI + rising borrow cost above 50-day SMA = bearish; high SI + cheap borrow into earnings = bullish squeeze setup.",
    align: "center",
    sortValue: (r) => r._v5?.sub_short_interest ?? null,
    renderCell: (r) => {
      const v = r._v5?.sub_short_interest;
      if (v == null) return <span style={{color:"var(--text-dim)"}}>—</span>;
      const col = v >= 20 ? "var(--green-text)" : v <= -20 ? "var(--red-text)" : "var(--text)";
      return <span style={{ fontFamily: "var(--font-ui)", fontVariantNumeric: "tabular-nums", fontWeight: 600, color: col, fontSize: 12 }}>{v >= 0 ? "+" : ""}{Number(v).toFixed(0)}</span>;
    },
  },
  {
    id: "rsi_14", label: "RSI(14)", description: "14-day Relative Strength Index. >70 conventionally overbought; <30 oversold.",
    align: "right",
    sortValue: (r) => r._v5?.rsi_14 ?? null,
    renderCell: (r) => {
      const v = r._v5?.rsi_14;
      if (v == null) return <span style={{color:"var(--text-dim)"}}>—</span>;
      const col = v > 70 ? "var(--red-text)" : v < 30 ? "var(--orange-text)" : "var(--text)";
      return <span style={{ fontFamily: "var(--font-mono)", color: col }}>{v.toFixed(1)}</span>;
    },
  },
  {
    id: "bb_bw", label: "BB BAND-WIDTH", description: "Bollinger band-width as percent of 20-day MA. <5% = compression / squeeze (amber). >15% = expansion / trend in motion.",
    align: "right",
    sortValue: (r) => r._v5?.bb_bw ?? null,
    renderCell: (r) => {
      const v = r._v5?.bb_bw;
      if (v == null) return <span style={{color:"var(--text-dim)"}}>—</span>;
      const col = v < 0.05 ? "var(--orange-text)" : "var(--text)";
      return <span style={{ fontFamily: "var(--font-mono)", color: col }}>{(v*100).toFixed(2)}%</span>;
    },
  },
  {
    id: "rvol_20d", label: "RVOL (20d)", description: "Today's volume / 20-day average. ≥1.5× = unusual activity (green); <0.7× = quiet (amber); 1.0× = average.",
    align: "right",
    sortValue: (r) => r._v5?.rvol_20d ?? null,
    renderCell: (r) => {
      const v = r._v5?.rvol_20d;
      if (v == null) return <span style={{color:"var(--text-dim)"}}>—</span>;
      const col = v >= 1.5 ? "var(--green-text)" : v < 0.7 ? "var(--orange-text)" : "var(--text)";
      return <span style={{ fontFamily: "var(--font-mono)", color: col }}>{v.toFixed(2)}×</span>;
    },
  },
  {
    id: "pct_50ma", label: "% VS 50D MA", description: "Today's close as percent distance from the 50-day SMA. >+5% uptrend; <−5% downtrend.",
    align: "right",
    sortValue: (r) => r._v5?.pct_50ma ?? null,
    renderCell: (r) => {
      const v = r._v5?.pct_50ma;
      if (v == null) return <span style={{color:"var(--text-dim)"}}>—</span>;
      const col = v > 5 ? "var(--green-text)" : v < -5 ? "var(--red-text)" : "var(--text)";
      return <span style={{ fontFamily: "var(--font-mono)", color: col }}>{v >= 0 ? "+" : ""}{v.toFixed(1)}%</span>;
    },
  },
  {
    id: "pct_200ma", label: "% VS 200D MA", description: "Today's close as percent distance from the 200-day SMA. >+10% strong uptrend; <−10% downtrend.",
    align: "right",
    sortValue: (r) => r._v5?.pct_200ma ?? null,
    renderCell: (r) => {
      const v = r._v5?.pct_200ma;
      if (v == null) return <span style={{color:"var(--text-dim)"}}>—</span>;
      const col = v > 10 ? "var(--green-text)" : v < -10 ? "var(--red-text)" : "var(--text)";
      return <span style={{ fontFamily: "var(--font-mono)", color: col }}>{v >= 0 ? "+" : ""}{v.toFixed(1)}%</span>;
    },
  },
  {
    id: "ins_buys", label: "INSIDER BUYS (#)", description: "Number of Form 4 open-market buy events by officers / directors in the recent window.",
    align: "right",
    sortValue: (r) => r._v5?.ins_buys ?? null,
    renderCell: (r) => {
      const v = r._v5?.ins_buys;
      if (v == null) return <span style={{color:"var(--text-dim)"}}>—</span>;
      return <span style={{ fontFamily: "var(--font-mono)", color: v > 0 ? "var(--green-text)" : "var(--text-dim)" }}>{v}</span>;
    },
  },
  {
    id: "ins_buy_$", label: "INSIDER BUYS ($)", description: "Total $ value of recent Form 4 open-market buy events.",
    align: "right",
    sortValue: (r) => r._v5?.["ins_buy_$"] ?? null,
    renderCell: (r) => {
      const v = r._v5?.["ins_buy_$"];
      if (v == null) return <span style={{color:"var(--text-dim)"}}>—</span>;
      const m = v >= 1e9 ? `$${(v/1e9).toFixed(2)}B` : v >= 1e6 ? `$${(v/1e6).toFixed(1)}M` : v >= 1e3 ? `$${(v/1e3).toFixed(0)}K` : `$${v.toFixed(0)}`;
      return <span style={{ fontFamily: "var(--font-mono)", color: v > 0 ? "var(--green-text)" : "var(--text-dim)" }}>{m}</span>;
    },
  },
];

// v4 signal cluster (signalCols + overallCol) removed 2026-05-11 per Joe
// directive — replaced by v5Cols (MT Score / Band / sub_short_interest /
// etc.) which read from public.signal_intel_v5_daily, the live engine
// that powers Trading Opps. signalCols + overallCol definitions left in
// place above in case a follow-up needs them again.
const COLUMNS = [...baseCols, ...v5Cols, ...riskCols, watchCol];

// Joe directive 2026-05-11: show every column by default (was: only
// ticker/name/sector/6 signals/OVR visible, everything else hidden behind
// the picker). The picker still works for opt-out. Column order keeps the
// signal-and-OVR block adjacent on the left since that's the primary scan
// surface; portfolio-style cols (price/marketcap/yield/earnings) follow;
// risk metrics tail-end the table.
const DEFAULT_ORDER = [
  "ticker", "name", "sector",
  // v4 signal sub-scores + OVR removed 2026-05-11 (Joe directive) —
  // replaced by v5 cluster below.
  "mt_score", "band", "ig",
  "sub_short_interest",
  "rsi_14", "bb_bw", "rvol_20d", "pct_50ma", "pct_200ma",
  "ins_buys", "ins_buy_$",
  "price", "dayChangePct", "marketcap", "ivRank", "divYield",
  "nextEarnings", "week52", "theme",
  "beta_2y", "annVol_2y", "maxDD_2y", "var10d99",
  "_watch",
];
const DEFAULT_VISIBLE = [...DEFAULT_ORDER];

// Default column widths (px).
const DEFAULT_WIDTHS = {
  ticker:        90,
  name:          220,
  sector:        120,
  price:         100,
  dayChangePct:  90,
  marketcap:     100,
  ivRank:        85,
  divYield:      95,
  nextEarnings:  125,
  week52:        150,
  theme:         220,
  // v4 signal width entries (technicals/insider/options/congress/analyst/
  // darkpool/overall) retired 2026-05-11 with the columns themselves.
  beta_2y:       90,
  annVol_2y:     90,
  maxDD_2y:      90,
  var10d99:      110,
  // v5 columns 2026-05-11
  mt_score:           100,
  band:               110,
  ig:                 210,
  sub_short_interest: 100,
  rsi_14:             85,
  bb_bw:              115,
  rvol_20d:           100,
  pct_50ma:           105,
  pct_200ma:          110,
  ins_buys:           115,
  "ins_buy_$":        130,
  _watch: 90,
};

export default function WatchlistTable({
  rows, signals, screener, info,
  onOpenTicker, heldTickers, emptyMessage,
  tableKey = "watchlist_other",
  userWatchlistTickers,    // Set<string> of tickers already on the user's watchlist
  onAddToWatchlist,        // (ticker: string) => Promise<void>
  onRemoveFromWatchlist,   // (ticker: string) => Promise<void>
  portfolioAuthed = false, // bool — is the user signed in
  tintByScore = false,
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

  const { prefs, setOrder, setVisible, setWidths, resetToDefaults } = useTablePreferences(tableKey, {
    defaultOrder:   DEFAULT_ORDER,
    defaultVisible: DEFAULT_VISIBLE,
    defaultWidths:  DEFAULT_WIDTHS,
  });

  // P5 #35 — risk metrics for visible tickers, opt-in columns
  const _tickers = useMemo(() => (rows || []).map(r => String(r.ticker || "").toUpperCase()).filter(Boolean), [rows]);
  const { metrics: _riskByTicker } = useRiskMetricsBatch(_tickers);
  // 2026-05-11 — v5 Trading Opps engine. Joe wants the same MT Score /
  // Band / Industry Group / sub_short_interest / RSI / BB BW / RVOL /
  // % vs SMA / insider buy stats here as on Trading Opps.
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
        // Bug #1076 fix-fix: carry `note` through enrichment so the
        // renderer can see when the section composite explicitly
        // reports "no qualifying activity" (vs. a generic missing-data
        // null). Without this, the no-activity pill never lit up.
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

  const [sortCol, setSortCol] = useState("overall");
  const [sortDir, setSortDir] = useState("desc");

  const toggleSort = (id) => {
    const col = COLUMNS.find((c) => c.id === id);
    if (!col) return;
    if (id === sortCol) {
      setSortDir((d) => d === "asc" ? "desc" : "asc");
    } else {
      setSortCol(id);
      setSortDir(col.align === "left" ? "asc" : "desc");
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
      if (aNull) return 1;
      if (bNull) return -1;
      let cmp;
      if (typeof av === "number" && typeof bv === "number") cmp = av - bv;
      else cmp = String(av).localeCompare(String(bv), undefined, { numeric: true });
      return sortDir === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [enriched, sortCol, sortDir]);

  // Drag state MUST be declared before any conditional return — React hook-order invariant (Item 36 hotfix).
  const [dragId, setDragId] = useState(null);
  const [dragOverId, setDragOverId] = useState(null);
  // liveWidths (column resize) MUST also be declared before the early return -- same React hook-order invariant.
  const [liveWidths, setLiveWidths] = useState(null);

  if (!enriched.length) {
    return (
      <>
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 6 }}>
          <TableColumnPicker
            columns={COLUMNS.map(({ id, label, description }) => ({ id, label, description }))}
            order={prefs.order}
            visible={prefs.visible}
            defaultOrder={DEFAULT_ORDER}
            defaultVisible={DEFAULT_VISIBLE}
            onOrderChange={setOrder}
            onVisibleChange={setVisible}
            onResetAll={resetToDefaults}
          />
        </div>
        <div style={{
          padding: "10px 12px", fontSize: 12, color: "var(--text-muted)",
          fontFamily: "var(--font-mono)",
        }}>
          {emptyMessage || "No tickers on your watchlist. Add one below."}
        </div>
      </>
    );
  }

  const byId = new Map(COLUMNS.map((c) => [c.id, c]));
  const visibleIds = prefs.order.filter((id) => prefs.visible.includes(id) && byId.has(id));
  const visibleColumns = visibleIds.map((id) => byId.get(id)).filter(Boolean);

  // ─── Draggable headers ─────────────────────────────────────────────────────
  const onHdrDragStart = (e, id) => {
    setDragId(id);
    try { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", id); } catch {}
  };
  const onHdrDragOver = (e, id) => {
    if (!dragId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (id !== dragOverId) setDragOverId(id);
  };
  const onHdrDrop = (e, targetId) => {
    e.preventDefault();
    const source = dragId;
    setDragId(null); setDragOverId(null);
    if (!source || source === targetId) return;
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
    fontFamily: "var(--font-mono)", letterSpacing: "0.06em",
    padding: "6px 6px",
    borderBottom: "1px solid var(--border)",
    background: "var(--surface-3)", position: "sticky", top: 0,
    userSelect: "none", whiteSpace: "normal", lineHeight: 1.25,
    verticalAlign: "bottom",
  };

  // --- Resizable columns ----------------------------------------------------
  const widthOf = (id) => (liveWidths && liveWidths[id] != null)
    ? liveWidths[id]
    : (prefs.widths[id] != null ? prefs.widths[id] : (DEFAULT_WIDTHS[id] || 100));

  const onResizeStart = (e, id) => {
    e.preventDefault();
    e.stopPropagation();
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
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 6 }}>
        <TableColumnPicker
          columns={COLUMNS.map(({ id, label, description }) => ({ id, label, description }))}
          order={prefs.order}
          visible={prefs.visible}
          defaultOrder={DEFAULT_ORDER}
          defaultVisible={DEFAULT_VISIBLE}
          onOrderChange={setOrder}
          onVisibleChange={setVisible}
          onResetAll={resetToDefaults}
        />
      </div>
      <div style={{ overflowX: "auto", border: "1px solid var(--border)", borderRadius: 6 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, tableLayout: "fixed" }}>
          <colgroup>
            {visibleColumns.map((col) => (
              <col key={col.id} style={{ width: widthOf(col.id) }} />
            ))}
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
                      textAlign: col.align,
                      cursor: "grab",
                      opacity: isDragging ? 0.5 : 1,
                      borderLeft: isDragOver ? "2px solid var(--accent)" : "2px solid transparent",
                    }}
                  >
                    {/* Bug #1076 fix-fix: the column-description tooltip used
                        to be the browser-default `title=` attribute, which
                        has the ~750ms hover delay LESSONS rule #3 forbids.
                        Routed through the shared Tip primitive (the same
                        zero-latency tooltip the "Rescan metadata" button
                        uses) so the hint appears the instant the cursor
                        lands on the header. */}
                    <Tip def={col.description}>
                      <span style={{ display: "inline-block" }}>
                        {col.label}
                        <SortArrow dir={sortCol === col.id ? sortDir : null} />
                      </span>
                    </Tip>
                    <Tip def="Drag to resize column"><div
                      draggable={false}
                      onMouseDown={(e) => onResizeStart(e, col.id)}
                      onClick={(e) => e.stopPropagation()}
                      style={resizeHandleStyle}
                    /></Tip>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => {
              const _score = row?.overall?.score;
              const _bg = tintByScore && typeof _score === "number"
                ? (_score >= 75 ? "rgba(46,125,79,0.10)"
                   : _score >= 50 ? "rgba(46,125,79,0.04)"
                   : "var(--surface-2)")
                : "var(--surface-2)";
              const _bgHover = tintByScore && typeof _score === "number"
                ? (_score >= 75 ? "rgba(46,125,79,0.16)"
                   : _score >= 50 ? "rgba(46,125,79,0.08)"
                   : "var(--surface-3)")
                : "var(--surface-3)";
              return (
              <tr
                key={row.ticker}
                onClick={() => onOpenTicker?.(row.ticker)}
                style={{
                  cursor: "pointer",
                  borderBottom: "1px solid var(--border-faint)",
                  background: _bg,
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = _bgHover}
                onMouseLeave={(e) => e.currentTarget.style.background = _bg}
              >
                {visibleColumns.map((col) => (
                  <td
                    key={col.id}
                    style={{
                      padding: "5px 8px",
                      textAlign: col.align,
                      fontVariantNumeric: "tabular-nums",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {col.renderCell(row)}
                  </td>
                ))}
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
