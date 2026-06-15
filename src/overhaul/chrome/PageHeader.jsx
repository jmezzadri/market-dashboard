/* PageHeader — sticky top header with market state, date, search,
   freshness pill, theme cycler, and Tweaks toggle.
   Ported from site-overhaul prototype lm-core.jsx. */

import React from 'react';
import FreshnessChip from '../components/FreshnessChip';
import { useTweaks } from '../tweaks/TweaksContext';
import { useFreshnessRollup } from '../../hooks/useFreshness';

// "All feeds" pill — a TRUE site-wide rollup across EVERY registered data
// element, graded with the exact same logic the per-element chips use
// (useFreshnessRollup -> rollupStatus). The old version read only
// indicator_history.json + COT, so it stayed "All feeds current" while a
// scanner or equity chip on the page was red (Joe 2026-06-15: "the header
// should read everything since it's on every page"). Reusing the chip grader
// guarantees the header count matches the chips and never relies on the
// watchdog's stored status (which can lag the true grade).
function AllFeedsPill() {
  const { loading, red, amber } = useFreshnessRollup();
  const status = loading ? 'checking' : red.length > 0 ? 'red' : amber.length > 0 ? 'amber' : 'green';
  const color =
    status === 'red' ? 'var(--mt-down)'
      : status === 'amber' ? 'var(--mt-amber)'
        : status === 'green' ? 'var(--mt-up)'
          : 'var(--mt-ink-3)';
  const text =
    status === 'checking' ? 'Checking feeds\u2026'
      : status === 'red' ? `${red.length} feed${red.length > 1 ? 's' : ''} stale`
        : status === 'amber' ? `${amber.length} feed${amber.length > 1 ? 's' : ''} lagging`
          : 'All feeds current';
  const title =
    status === 'red'
      ? `Stale: ${red.map((r) => r.label).join(', ')} \u2014 open All Indicators or Admin \u00b7 Data (a stale feed may not have a tile on this page)`
      : status === 'amber'
        ? `Lagging (today's update is late): ${amber.map((a) => a.label).join(', ')}`
        : 'Every tracked feed across the whole site is within its freshness target';
  return (
    <span
      title={title}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, fontFamily: 'var(--mt-font-ui)', color, padding: '3px 10px', borderRadius: 999, background: `color-mix(in oklab, ${color} 12%, transparent)`, fontWeight: 500 }}
    >
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: color, flexShrink: 0 }} />
      {text}
    </span>
  );
}

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

  /* 2026-05-27 — Joe directive: keep only Light and Dark Navy; drop the
     pure-black 'dark' variant from the cycle. If a user has 'dark' saved
     in localStorage from a prior session, treat it as navy. */
  const cycleTheme = () => {
    const order = ['light', 'navy'];
    const current = tweaks.theme === 'dark' ? 'navy' : tweaks.theme;
    const next = order[(order.indexOf(current) + 1) % order.length];
    setTweak('theme', next);
  };

  const themeGlyph = tweaks.theme === 'light' ? '☾' : '☀';

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
      {/* Header search removed 2026-05-27 — the prior static
          "Search tickers, indicators, scenarios…" pill was unwired chrome
          ported from the prototype. If a real command palette is ever
          built, mount it here. */}
      <div className="mt-headstatus">
        {/* Freshness pill rolls up the universe pipeline — when all
            ingest pipelines are green, this reads "All feeds healthy".
            When any are red, the chip flips and the tooltip names the
            failing upstream. */}
        {/* Real manifest ID — was a fictional ID prior to PR-O13; the
            fictional ID resolved to "no manifest entry → green" which made
            the All-feeds chip permanently green regardless of actual
            pipeline state. */}
        <AllFeedsPill />
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
