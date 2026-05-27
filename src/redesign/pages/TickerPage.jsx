/**
 * v2 TickerPage — full feature parity with the live TickerDetailModal.
 *
 * Renders the same component the legacy Insights/Scanner tabs open as a modal,
 * but inline as a full page within the v2 shell. The KPI strip, SignalIntelligenceRail,
 * HistoricalChart, About/Dividends/Splits tabs, ActionRow, watchlist toggle —
 * everything the live ticker drill does — comes along automatically.
 *
 * "Back" returns to the Scanner page in the v2 shell.
 */
import React, { useEffect, useState } from "react";

import { useSession } from "../../auth/useSession";
import { useUserPortfolio } from "../../hooks/useUserPortfolio";
import useScanData from "../hooks/useScanData";
import useCycleBoard from "../hooks/useCycleBoard";
import useV9Allocation from "../hooks/useV9Allocation";

import TickerDetailModal from "../../components/TickerDetailModal";

export default function TickerPage({ symbol, onBack, openTicker }) {
  const { session } = useSession();
  const portfolioAuthed = !!session;
  const {
    accounts: ACCOUNTS,
    watchlist: userWatchlistRows,
    refetch: refetchPortfolio,
  } = useUserPortfolio();

  const { data: scanData } = useScanData();
  const { data: cycleBoardSnap } = useCycleBoard();
  const { data: v9Alloc } = useV9Allocation();

  /* When openTicker is called from inside the modal (Related-Names grid),
     it should swap to a new ticker page rather than open a nested modal. */
  const handleOpenTicker = (next) => {
    if (next && next !== symbol) openTicker?.(next);
  };

  /* Wrap onClose to take the user back to scanner via the shell instead of
     hiding a modal (there is no modal here). */
  const handleClose = () => onBack?.();

  /* Keep body scroll free of the modal lock — the modal's own useEffect
     locks document.body.style.overflow. Reset on unmount just in case. */
  useEffect(() => {
    return () => {
      try { document.body.style.overflow = ""; } catch (e) {}
    };
  }, []);

  if (!symbol) return null;

  return (
    <div className="v2-ticker-host" style={hostStyle}>
      <TickerDetailModal
        ticker={symbol}
        scanData={scanData}
        accounts={ACCOUNTS}
        watchlistRows={userWatchlistRows}
        portfolioAuthed={portfolioAuthed}
        refetchPortfolio={refetchPortfolio}
        onClose={handleClose}
        onTickerAdded={handleOpenTicker}
        scanBusy={false}
        cycleBoardSnap={cycleBoardSnap}
        v9Alloc={v9Alloc}
      />
    </div>
  );
}

/* The TickerDetailModal is built as a fixed-position sheet with its own
   backdrop. The v2 shell already provides the page chrome, so we let the
   modal render itself — it overlays the v2 surface on purpose. Users see
   the full live experience, and the v2 Back arrow returns to the scanner.

   If you later want the modal CONTENT inline (not overlayed), refactor
   TickerDetailModal to split its body into a separate component that both
   the modal and this page can mount. That refactor is queued for PR #2. */
const hostStyle = { minHeight: "calc(100vh - 120px)" };
