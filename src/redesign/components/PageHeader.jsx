/**
 * PageHeader — sticky top bar with date, search placeholder, freshness
 * pill, theme cycler, and tweaks toggle.
 */
import React from "react";
import { FreshnessChip } from "../atoms";

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const DAYS = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];

function formatToday() {
  const d = new Date();
  return {
    dayName: DAYS[d.getDay()],
    rest: `${MONTHS[d.getMonth()]} ${d.getDate()} · ${d.getFullYear()}`,
    isWeekend: d.getDay() === 0 || d.getDay() === 6,
  };
}

export default function PageHeader({ onOpenTweaks, theme, setTheme }) {
  const t = formatToday();
  const closed = t.isWeekend; // simple proxy; real wiring can use a calendar
  return (
    <header className="mt-header">
      <div className="mt-headmeta">
        <span>
          <span className="mt-marketdot" />
          {closed ? "Market closed" : "Market open"}
        </span>
        <span className="mt-headmeta-sep" />
        <span>
          <b>{t.dayName}</b>, {t.rest}
        </span>
      </div>
      <div className="mt-search">
        <span>⌕</span>
        <span>Search tickers, indicators, scenarios…</span>
        <kbd>⌘K</kbd>
      </div>
      <div className="mt-headstatus">
        <FreshnessChip
          state="fresh"
          asOf="3 min"
          variant="pill"
          label="All feeds healthy"
        />
        <button
          className="mt-iconbtn"
          onClick={() => {
            const order = ["light", "dark", "navy"];
            const next = order[(order.indexOf(theme) + 1) % order.length];
            setTheme(next);
          }}
          aria-label="Cycle theme"
          title={`Theme: ${theme}`}
        >
          {theme === "light" ? "☾" : theme === "dark" ? "✱" : "☀"}
        </button>
        <button className="mt-iconbtn" onClick={onOpenTweaks} aria-label="Open tweaks">
          ⚙
        </button>
      </div>
    </header>
  );
}
