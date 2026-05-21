// WatchlistTable — the Portfolio Insights watchlist, rendered as the EXACT
// same results table as the Trading Opportunities page.
//
// Rebuilt 2026-05-21 (Phase 7 fix). The earlier Phase 7 pass grafted a
// hand-picked set of score columns onto the legacy watchlist grid — a
// different table from Trading Opportunities. This version instead renders
// the real Trading Opportunities results table (the same 5 column groups,
// the same 34 columns, the same column picker, the same styling), scoped
// to the user's watchlist names, with one slim remove control pinned at
// the end of each row so the list stays manageable.
//
// A watchlist name the screener has not launched in the latest scan shows
// the ticker with em-dashes across every screener column — correct, since
// the screener flags names rather than scoring the whole universe.
//
// The component keeps the same name and props it had before, so the two
// existing call sites in App.jsx need no change. Props beyond the ones
// used below (signals / screener / info / tableKey / heldTickers /
// onAddToWatchlist / onUpdateTheme / tintByScore) are accepted and
// ignored for that reason — adding names is handled by the add box that
// already sits below the table.

import { useMemo, useState } from "react";
import useTradingOppsBatch from "../hooks/useTradingOppsBatch";
import {
  loadColState,
  saveColState,
  ColumnCustomizer,
  ResultsTable,
  PAGE_CSS,
} from "../v2/pages/TradingOppsPage";

// Watchlist keeps its own saved column layout, independent of the full
// Trading Opportunities scan page.
const WATCHLIST_COL_STORAGE = "mt-watchlist-opps-cols-v1";

const WL_CSS = `
.wl-opps { font-family: var(--font-ui); }
.wl-opps .wl-remove {
  background: var(--surface-2); border: 1px solid var(--border);
  color: var(--text-muted); border-radius: 50%;
  width: 22px; height: 22px; line-height: 1; font-size: 13px;
  cursor: pointer; display: inline-flex; align-items: center; justify-content: center;
}
.wl-opps .wl-remove:hover { color: var(--red-text); border-color: var(--red); }
.wl-opps .wl-remove:disabled { opacity: .4; cursor: default; }
`;

export default function WatchlistTable({
  rows,
  onOpenTicker,
  onRemoveFromWatchlist,
  emptyMessage,
  portfolioAuthed = false,
  // accepted but unused — kept so the existing call sites need no change:
  signals, screener, info, tableKey, heldTickers, userWatchlistTickers,
  onAddToWatchlist, onUpdateTheme, tintByScore,
}) {
  const tickers = useMemo(
    () => (rows || []).map((r) => String(r.ticker || "").toUpperCase()).filter(Boolean),
    [rows]
  );

  const { byTicker, loading } = useTradingOppsBatch(tickers);

  // One row per watchlist ticker: the screener's full row when the name
  // launched in the latest scan, otherwise a bare { ticker } row so the
  // table renders the ticker with em-dashes across the screener columns.
  const tableRows = useMemo(
    () => tickers.map((t) => (byTicker[t] ? { ...byTicker[t], ticker: t } : { ticker: t })),
    [tickers, byTicker]
  );

  const [colState, setColState] = useState(() => loadColState(WATCHLIST_COL_STORAGE));
  const [custOpen, setCustOpen] = useState(false);
  const updateColState = (next) => {
    setColState(next);
    saveColState(next, WATCHLIST_COL_STORAGE);
  };

  const [removing, setRemoving] = useState(null);
  const removeCol =
    portfolioAuthed && typeof onRemoveFromWatchlist === "function"
      ? {
          render: (r) => (
            <button
              type="button"
              className="wl-remove"
              disabled={removing === r.ticker}
              title="Remove from watchlist"
              aria-label={`Remove ${r.ticker} from watchlist`}
              onClick={async () => {
                setRemoving(r.ticker);
                try { await onRemoveFromWatchlist(r.ticker); }
                finally { setRemoving(null); }
              }}
            >
              &times;
            </button>
          ),
        }
      : null;

  return (
    <div className="wl-opps">
      <style>{PAGE_CSS}</style>
      <style>{WL_CSS}</style>

      <div className="to-controls" style={{ justifyContent: "flex-end" }}>
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

      <div className="to-legend">
        <span className="sw" />
        Shaded columns feed the score &mdash; Insider Activity, Dark Pool
        Anchor, Options Vol Shock, SMA200, RSI.
      </div>

      {loading && tableRows.length === 0 ? (
        <div className="to-state" style={{ color: "var(--text-muted)" }}>
          Loading watchlist&hellip;
        </div>
      ) : tableRows.length === 0 ? (
        <div className="to-state" style={{ color: "var(--text-muted)" }}>
          {emptyMessage || "No tickers on your watchlist. Add one below."}
        </div>
      ) : (
        <ResultsTable
          rows={tableRows}
          order={colState.order}
          hidden={colState.hidden}
          onRowClick={(t) => onOpenTicker && onOpenTicker(t)}
          extraCol={removeCol}
        />
      )}
    </div>
  );
}
