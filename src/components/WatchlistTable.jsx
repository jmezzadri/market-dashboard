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

import { useEffect, useMemo, useRef, useState } from "react";
import useRiskMetricsBatch from "../hooks/useRiskMetricsBatch";
import useTradingOppsBatch from "../hooks/useTradingOppsBatch";
import usePricesEodBatch from "../hooks/usePricesEodBatch";
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

// ─── Theme cell: click-to-edit inline ──────────────────────────────────────
// Renders the saved theme as muted text by default. Clicking switches to an
// inline <input>. Pressing Enter or blurring saves via onUpdateTheme; Esc
// cancels. Only editable for rows on the user's own watchlist (props guard).
function ThemeCell({ ticker, value, editable, onUpdateTheme }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft]     = useState(value || "");
  const [busy, setBusy]       = useState(false);
  const [err, setErr]         = useState(null);
  const inputRef = useRef(null);

  // Keep draft in sync if the upstream value updates after a save.
  useEffect(() => { if (!editing) setDraft(value || ""); }, [value, editing]);
  useEffect(() => { if (editing && inputRef.current) inputRef.current.focus(); }, [editing]);

  const save = async () => {
    const next = draft.trim();
    if (next === (value || "").trim()) { setEditing(false); return; }
    setBusy(true); setErr(null);
    try {
      await onUpdateTheme(ticker, next);
      setEditing(false);
    } catch (e) {
      setErr(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  if (!editing) {
    return (
      <span
        onClick={editable ? (e) => { e.stopPropagation(); setEditing(true); } : undefined}
        title={editable ? (value ? value + " · click to edit" : "Click to add a theme") : value}
        style={{
          color: value ? "var(--text-dim)" : "var(--text-muted)",
          fontSize: 11,
          fontStyle: value ? "normal" : "italic",
          maxWidth: 220, display: "inline-block",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          verticalAlign: "bottom",
          cursor: editable ? "text" : "default",
        }}
      >
        {value || (editable ? "Add theme…" : "—")}
      </span>
    );
  }

  return (
    <input
      ref={inputRef}
      type="text"
      value={draft}
      disabled={busy}
      onChange={(e) => setDraft(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === "Enter") save();
        if (e.key === "Escape") { setEditing(false); setDraft(value || ""); setErr(null); }
      }}
      onBlur={save}
      placeholder="e.g. AI / Semis"
      style={{
        width: "100%", maxWidth: 220,
        fontSize: 11, fontFamily: "var(--font-ui)",
        padding: "2px 6px",
        background: "var(--surface-2)",
        border: "1px solid " + (err ? "var(--red, var(--accent))" : "var(--accent)"),
        borderRadius: 4,
        color: "var(--text)",
        outline: "none",
      }}
      title={err || ""}
    />
  );
}

// ─── MTTable column registry ─────────────────────────────────────────────────
// Schema per MTTable: { key, label, numeric?, defaultVisible?, defaultWidth?,
// tooltip?, render?(row), sortValue?(row) }
// numeric:true triggers right-aligned monospace tabular-nums per MTTable CSS.
function buildColumns({ onUpdateTheme, userOwnsRow }) {
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
      tooltip: "Your watchlist note for this ticker. Click to edit.",
      sortValue: (r) => (r.theme || "").toLowerCase(),
      render: (r) => (
        <ThemeCell
          ticker={r.ticker}
          value={r.theme}
          editable={!!onUpdateTheme && userOwnsRow(r.ticker)}
          onUpdateTheme={onUpdateTheme}
        />
      ),
    },
  ];

  // Trading Opportunities screener columns — re-pointed 2026-05-21
  // (Phase 7 of the screener overhaul) from the retired six-signal model
  // to the rebuilt dual-direction screener. Numbers here match the
  // Trading Opportunities page exactly for the same ticker on the same
  // scan. The screener publishes only LAUNCHED names, so a watchlist name
  // the screener has not flagged shows an em-dash across this group.
  const screenerCols = [
    {
      key: "signal", label: "SIGNAL", categorical: true, defaultWidth: 115,
      tooltip: "The screener's directional call. BUY · LONG means the rebuilt screener flagged this name on the latest scan; a dash means it has not.",
      filterValue: (r) => r._topps?.signal || "Not flagged",
      sortValue: (r) => (r._topps?.signal ? 1 : 0),
      render: (r) => {
        const s = r._topps?.signal;
        if (!s) return <span style={{color:"var(--text-dim)"}}>—</span>;
        return <span style={{ fontFamily: "var(--font-ui)", fontSize: 11, fontWeight: 600, color: "var(--green-text)" }}>{s}</span>;
      },
    },
    {
      key: "score", label: "SCORE", numeric: true, defaultWidth: 95,
      tooltip: "The screener score — out of 5 today (insider buying and trend live), rising to 10 once the dark-pool and options layers activate. A name launches onto the buy list at 3.",
      sortValue: (r) => r._topps?.score ?? null,
      render: (r) => {
        const v = r._topps?.score;
        if (v == null) return <span style={{color:"var(--text-dim)"}}>—</span>;
        const col = v >= 4.5 ? "var(--green-text)" : v >= 3.5 ? "var(--green)" : "var(--text)";
        return (
          <span style={{ fontFamily: "var(--font-ui)", fontVariantNumeric: "tabular-nums", fontWeight: 700, color: col, fontSize: 13 }}>
            {Number(v).toFixed(1)}
            <span style={{ fontSize: 9, color: "var(--text-dim)", fontWeight: 600 }}> / 5</span>
          </span>
        );
      },
    },
    {
      key: "score_1w", label: "SCORE 1W", numeric: true, defaultWidth: 100,
      tooltip: "The screener score one week ago. A dash means the name was not on the list then.",
      sortValue: (r) => r._topps?.score_1w ?? null,
      render: (r) => {
        const v = r._topps?.score_1w;
        if (v == null) return <span style={{color:"var(--text-dim)"}}>—</span>;
        return <span style={{ fontFamily: "var(--font-mono)", color: "var(--text-muted)" }}>{Number(v).toFixed(1)}</span>;
      },
    },
    {
      key: "score_1m", label: "SCORE 1M", numeric: true, defaultWidth: 100,
      tooltip: "The screener score one month ago. A dash means the name was not on the list then.",
      sortValue: (r) => r._topps?.score_1m ?? null,
      render: (r) => {
        const v = r._topps?.score_1m;
        if (v == null) return <span style={{color:"var(--text-dim)"}}>—</span>;
        return <span style={{ fontFamily: "var(--font-mono)", color: "var(--text-muted)" }}>{Number(v).toFixed(1)}</span>;
      },
    },
    {
      key: "win_rate", label: "WIN RATE", numeric: true, defaultWidth: 100,
      tooltip: "The empirical success rate of this screener setup from the back-test — how often launched names were higher one month later.",
      sortValue: (r) => r._topps?.win_rate ?? null,
      render: (r) => {
        const v = r._topps?.win_rate;
        if (v == null) return <span style={{color:"var(--text-dim)"}}>—</span>;
        return <span style={{ fontFamily: "var(--font-mono)", color: "var(--text)" }}>{Number(v).toFixed(0)}%</span>;
      },
    },
    {
      key: "insider", label: "INSIDER ACTIVITY", categorical: true, defaultWidth: 150,
      tooltip: "C-suite open-market buying that drove the score — the rules that fired (A conviction buy, B size, C consensus) and how many days ago the triggering buy was filed.",
      filterValue: (r) => (r._topps?.insider_rules || []).join(""),
      sortValue: (r) => r._topps?.insider_pts ?? null,
      render: (r) => {
        const t = r._topps;
        const rules = (t && Array.isArray(t.insider_rules)) ? t.insider_rules : [];
        if (!t || (rules.length === 0 && t.insider_age_days == null)) return <span style={{color:"var(--text-dim)"}}>—</span>;
        return (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            {rules.map((tag, i) => (
              <span key={i} style={{ fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 700, color: "var(--green-text)", border: "1px solid var(--border-faint)", borderRadius: 3, padding: "1px 4px" }}>{String(tag)}</span>
            ))}
            {t.insider_age_days != null && (
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-muted)" }}>{Number(t.insider_age_days)}d</span>
            )}
          </span>
        );
      },
    },
    {
      key: "sma200", label: "% VS 200D MA", numeric: true, defaultWidth: 115,
      tooltip: "Today's close as a percent distance from the 200-day average price — the screener's trend layer. Above the line helps the score; below it applies a penalty.",
      sortValue: (r) => r._topps?.sma200_pct ?? null,
      render: (r) => {
        const v = r._topps?.sma200_pct;
        if (v == null) return <span style={{color:"var(--text-dim)"}}>—</span>;
        const col = v >= 0 ? "var(--green-text)" : "var(--red-text)";
        return <span style={{ fontFamily: "var(--font-mono)", color: col }}>{v >= 0 ? "+" : ""}{Number(v).toFixed(1)}%</span>;
      },
    },
    {
      key: "rsi", label: "RSI(14)", numeric: true, defaultWidth: 90,
      tooltip: "14-day Relative Strength Index. Above 65 is overheated and costs the screener score 2 points; conventional overbought is 70, oversold 30.",
      sortValue: (r) => r._topps?.rsi ?? null,
      render: (r) => {
        const v = r._topps?.rsi;
        if (v == null) return <span style={{color:"var(--text-dim)"}}>—</span>;
        const col = v > 65 ? "var(--red-text)" : "var(--text)";
        return <span style={{ fontFamily: "var(--font-mono)", color: col }}>{Number(v).toFixed(0)}</span>;
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
    ...screenerCols,                                   // signal, score, 1W/1M, win rate, insider, trend
    baseCols[3], baseCols[4], baseCols[5],            // price, day%, mcap
    baseCols[6], baseCols[7], baseCols[8], baseCols[9], // ivRank, divYield, nextEarnings, week52
    baseCols[10],                                      // theme
    ...riskCols,                                       // beta, annVol, maxDD, VaR
    watchCol,
  ];
}

export default function WatchlistTable({
  rows, signals, screener, info,
  onOpenTicker, heldTickers, emptyMessage,
  tableKey = "watchlist_other",
  userWatchlistTickers,
  onAddToWatchlist,
  onRemoveFromWatchlist,
  onUpdateTheme,
  portfolioAuthed = false,
}) {
  // Column registry depends on the row-ownership predicate, so re-derive
  // when the user's watchlist set changes (e.g. they add/remove a ticker).
  const COLUMNS = useMemo(
    () => buildColumns({
      onUpdateTheme: portfolioAuthed ? onUpdateTheme : null,
      userOwnsRow: (t) => userWatchlistTickers
        ? userWatchlistTickers.has(String(t || "").toUpperCase())
        : false,
    }),
    [onUpdateTheme, portfolioAuthed, userWatchlistTickers]
  );
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
  const { byTicker: _toppsByTicker } = useTradingOppsBatch(_tickers);
  // Single source of truth for price + day-change: prices_eod via the
  // batched hook. Replaces the old scanData.signals.screener.close read,
  // which had its own refresh cadence and could disagree with the
  // Positions table on the same screen (Joe 2026-05-15 bug report).
  const { byTicker: _eodByTicker } = usePricesEodBatch(_tickers);

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

      // Price + prev-close come from prices_eod via usePricesEodBatch so
      // every list-rendering surface (Watchlist here, Positions in
      // useUserPortfolio's positions.price, the drawer headline in
      // useTickerEodPrice) resolves the same numbers. Fall back to the
      // legacy screener overlay only when prices_eod has no row for
      // the ticker — that is the case for very-new listings before
      // the first overnight ingest.
      const eod = _eodByTicker[t] || {};
      const price = Number.isFinite(eod.close) ? eod.close
                  : (sc.close != null ? Number(sc.close) : (sc.prev_close != null ? Number(sc.prev_close) : null));
      const prev  = Number.isFinite(eod.prev_close) ? eod.prev_close
                  : (sc.prev_close != null ? Number(sc.prev_close) : null);
      const dayChangePct = Number.isFinite(eod.day_pct) ? eod.day_pct
                         : ((price != null && prev) ? (price / prev - 1) * 100 : null);

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
        _topps:   _toppsByTicker[t] || null,
      };
    });
  }, [rows, signals, screenerMap, infoMap, heldTickers, _riskByTicker, _toppsByTicker, userWatchlistTickers, watchBusy, portfolioAuthed]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <MTTable
      columns={COLUMNS}
      rows={enriched}
      rowKey="ticker"
      onRowClick={(row) => onOpenTicker?.(row.ticker)}
      storageKey={`${tableKey}-s2`}
      features="full"
      emptyMessage={emptyMessage || "No tickers on your watchlist. Add one below."}
    />
  );
}
