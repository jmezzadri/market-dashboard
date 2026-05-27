import React from "react";
import LegacyScenarios from "../../v2/pages/ScenariosPage";

export default function ScenariosPage({ openTicker, setPage }) {
  return <LegacyScenarios onOpenTicker={openTicker} setPage={setPage} />;
}
