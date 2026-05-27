import React from "react";
import LegacyTradingOpps from "../../v2/pages/TradingOppsPage";

export default function ScannerPage({ openTicker, setPage }) {
  return <LegacyTradingOpps onOpenTicker={openTicker} setPage={setPage} />;
}
