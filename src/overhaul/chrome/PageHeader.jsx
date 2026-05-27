/* PageHeader — sticky top header with market state, date, search,
   freshness pill, theme cycler, and Tweaks toggle.
   Ported from site-overhaul prototype lm-core.jsx. */

import React from 'react';
import FreshnessChip from '../components/FreshnessChip';
import { useTweaks } from '../tweaks/TweaksContext';

function nyseMarketState(now = new Date()) {
  // Lightweight client-side approximation. NYSE 9:30 ET → 16:00 ET on weekdays.
  // Doesn't account for holidays — that's fine for a chrome label; the
  // FreshnessChip is the source of truth on stale data.
  const opts = { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false, weekday: 'short' };
  const parts = new Intl.DateTimeFormat('en-US', opts).formatToParts(now);
  const get = (t) => parts.find((p) => p.type === t)?.value;
  const wk = get('weekday');
  const h = Number(get('hour'));
  const m = Number(get('minute'));
  const mins = h * 60 + m;
  const isWeekday = !['Sat', 'Sun'].includes(wk);
  if (!isWeekday) return { open: false, label: 'Market closed' };
  if (mins < 9 * 60 + 30) return { open: false, label: 'Market pre-open' };
  if (mins >= 16 * 60) return { open: false, label: 'Market closed' };
  return { open: true, label: 'Market open' };
}

function formatToday(now = new Date()) {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'America/New_York',
  }).format(now);
}

export default function PageHeader() {
  const { tweaks, setTweak, openPanel } = useTweaks();
  const ms = nyseMarketState();
  const today = formatToday();

  const cycleTheme = () => {
    const order = ['light', 'dark', 'navy'];
    const next = order[(order.indexOf(tweaks.theme) + 1) % order.length];
    setTweak('theme', next);
  };

  const themeGlyph = tweaks.theme === 'light' ? '☾' : tweaks.theme === 'dark' ? '✱' : '☀';

  return (
    <header className="mt-header">
      <div className="mt-headmeta">
        <span>
          <span className={`mt-marketdot ${ms.open ? 'mt-marketdot--open' : ''}`} />
          {ms.label}
        </span>
        <span className="mt-headmeta-sep" />
        <span><b>{today.split(', ')[0]}</b>, {today.split(', ').slice(1).join(', ')}</span>
      </div>
      <div className="mt-search" role="search" aria-label="Search">
        <span aria-hidden>⌕</span>
        <span>Search tickers, indicators, scenarios…</span>
        <kbd>⌘K</kbd>
      </div>
      <div className="mt-headstatus">
        {/* Freshness pill rolls up the universe pipeline — when all
            ingest pipelines are green, this reads "All feeds healthy".
            When any are red, the chip flips and the tooltip names the
            failing upstream. */}
        {/* Real manifest ID — was a fictional ID prior to PR-O13; the
            fictional ID resolved to "no manifest entry → green" which made
            the All-feeds chip permanently green regardless of actual
            pipeline state. */}
        <FreshnessChip
          elementId="market-universe_master-daily"
          variant="pill"
          label="All feeds"
        />
        <button
          type="button"
          className="mt-iconbtn"
          onClick={cycleTheme}
          aria-label={`Theme: ${tweaks.theme} (click to cycle)`}
          title={`Theme: ${tweaks.theme}`}
        >
          {themeGlyph}
        </button>
        <button
          type="button"
          className="mt-iconbtn"
          onClick={openPanel}
          aria-label="Open tweaks panel"
          title="Tweaks"
        >
          ⚙
        </button>
      </div>
    </header>
  );
}
