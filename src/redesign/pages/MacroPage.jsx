import React from "react";
import LegacyMacroOverview from "../../v2/pages/MacroOverviewPage";

export default function MacroPage({ openTicker, setPage }) {
  return <LegacyMacroOverview onOpenTicker={openTicker} setPage={setPage} />;
}
