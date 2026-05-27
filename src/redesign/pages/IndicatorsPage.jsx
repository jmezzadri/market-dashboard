import React from "react";
import LegacyIndicators from "../../v2/pages/IndicatorsPage";

export default function IndicatorsPage({ openTicker, setPage }) {
  return <LegacyIndicators onOpenTicker={openTicker} setPage={setPage} />;
}
