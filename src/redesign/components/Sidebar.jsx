/**
 * Sidebar — left rail nav for the v2 shell.
 * Each item wrapped in <Tip side="right" bare block> so the collapsed
 * rail still surfaces full labels on hover.
 */
import React from "react";
import { Tip } from "../atoms";

function NavIcon({ k }) {
  const paths = {
    home: "M3 11 L12 4 L21 11 V20 H14 V14 H10 V20 H3 Z",
    macro: "M3 18 L9 12 L13 15 L21 6",
    tilt: "M4 4 V20 H20 M4 14 L9 8 L13 11 L20 6",
    scanner: "M11 18 A7 7 0 1 1 11 4 A7 7 0 0 1 11 18 M16 16 L21 21",
    portfolio: "M3 12 A9 9 0 1 1 12 21 V12 Z M12 3 A9 9 0 0 1 21 12 H12 Z",
    scenarios: "M4 20 L4 4 H20 V20 Z M4 14 L9 9 L13 13 L20 6",
    indicators: "M4 6 H20 M4 12 H20 M4 18 H20",
    methodology: "M5 4 H17 L19 6 V20 H5 Z M8 9 H14 M8 13 H14 M8 17 H12",
    legacy: "M5 4 H19 V20 H5 Z M5 9 H19 M9 4 V20",
  };
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={paths[k] || paths.home} />
    </svg>
  );
}

export default function Sidebar({ page, setPage, onLegacy }) {
  const items = [
    ["home", "Home", <NavIcon k="home" />, false],
    ["macro", "Macro overview", <NavIcon k="macro" />, false],
    ["tilt", "Asset Tilt", <NavIcon k="tilt" />, false],
    ["scanner", "Trading scanner", <NavIcon k="scanner" />, false],
    ["portfolio", "Portfolio insights", <NavIcon k="portfolio" />, false],
    ["scenarios", "Scenario analysis", <NavIcon k="scenarios" />, false],
    ["indicators", "All indicators", <NavIcon k="indicators" />, false],
    ["methodology", "Methodology", <NavIcon k="methodology" />, false],
  ];

  return (
    <aside className="mt-sidebar">
      <div className="mt-sidebar-brand">
        <div className="mt-mark">
          <svg viewBox="0 0 32 32">
            <circle cx="16" cy="16" r="14" fill="none" stroke="currentColor" strokeWidth="1.5" />
            <path
              d="M 8 22 L 16 12 L 24 22"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </div>
        <div>
          <div className="mt-sidebar-name">
            Macro
            <i style={{ color: "var(--mt-accent)", fontStyle: "italic" }}>Tilt</i>
          </div>
          <div className="mt-sidebar-sub">v2 preview</div>
        </div>
      </div>
      <nav className="mt-sidebar-nav">
        {items.map(([id, label, icon, chip]) => (
          <Tip key={id} content={label} side="right" bare block>
            <button
              className={`mt-navitem ${page === id ? "mt-navitem--active" : ""}`}
              onClick={() => setPage(id)}
              aria-label={label}
            >
              <span className="mt-navicon">{icon}</span>
              <span className="mt-navlbl">{label}</span>
              {chip && <span className="mt-navchip">{chip}</span>}
            </button>
          </Tip>
        ))}
        <div className="mt-navsep">
          <span className="mt-navsep-lbl">Switch</span>
        </div>
        <Tip content="Back to the current production site" side="right" bare block>
          <button
            className="mt-navitem"
            onClick={onLegacy}
            aria-label="Back to current site"
          >
            <span className="mt-navicon">
              <NavIcon k="legacy" />
            </span>
            <span className="mt-navlbl">Current site</span>
          </button>
        </Tip>
      </nav>
      <div className="mt-sidebar-foot">v2 preview · feedback welcome</div>
    </aside>
  );
}

export function TopNav({ page, setPage }) {
  const items = [
    ["home", "Home"],
    ["macro", "Macro"],
    ["tilt", "Tilt"],
    ["scanner", "Scanner"],
    ["portfolio", "Portfolio"],
    ["scenarios", "Scenarios"],
    ["indicators", "All indicators"],
    ["methodology", "Methodology"],
  ];
  return (
    <div className="mt-topnav">
      {items.map(([id, label]) => (
        <button
          key={id}
          className={`mt-pill ${page === id ? "on" : ""}`}
          onClick={() => setPage(id)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
