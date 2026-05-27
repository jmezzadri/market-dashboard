/**
 * v2 HomePage — wraps the production HomePage from src/v2/pages/HomePage.jsx.
 *
 * The redesign mockup from f84a0b7 was a static design-handoff layout with
 * no live data and no clickable behavior. This wrapper drops the mock and
 * mounts the production Home tile cluster (cycle composite, 6-mechanism
 * mini bar, regime headlines, scanner top names) directly inside the v2
 * shell.
 */
import React from "react";
import LegacyHomePage from "../../v2/pages/HomePage";

export default function HomePage({ openTicker, setPage }) {
  return <LegacyHomePage onOpenTicker={openTicker} setPage={setPage} />;
}
