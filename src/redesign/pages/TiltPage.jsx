import React from "react";
import LegacyAssetTilt from "../../v2/pages/AssetTiltPage";

export default function TiltPage({ openTicker, setPage }) {
  return <LegacyAssetTilt onOpenTicker={openTicker} setPage={setPage} />;
}
