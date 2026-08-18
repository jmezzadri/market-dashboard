/* PageHeader — sticky top header with market state, date, search,
   freshness pill, and the light/dark theme toggle.
   (Tweaks gear retired 2026-07-21 — theme is the only remaining option.)
   Ported from site-overhaul prototype lm-core.jsx. */

import React from 'react';
import { createPortal } from 'react-dom';
import FreshnessChip from '../components/FreshnessChip';
import TickerSearch from './TickerSearch';
import { useTweaks } from '../tweaks/TweaksContext';
import { useFreshnessRollup } from '../../hooks/useFreshness';
import { NYSE_HOLIDAYS } from '../../lib/freshnessClock';

// "All feeds" pill — a TRUE site-wide rollup across EVERY registered data
// element, graded with the exact same logic the per-element chips use
// (useFreshnessRollup -> rollupStatus). The old version read only
// indicator_history.json + COT, so it stayed "All feeds current" while a
// scanner or equity chip on the page was red (Joe 2026-06-15: "the header
// should read everything since it's on every page"). Reusing the chip grader
// guarantees the header count matches the chips and never relies on the
// watchdog's stored status (which can lag the true grade).
// Hover opens a styled tooltip listing exactly which feeds are stale, by their
// plain-English label (Joe 2026-06-15: "make the header have a tooltip for
// what's stale"). Mirrors the FreshnessChip tooltip look so it feels native.
function AllFeedsPill() {
  const { loading, red, amber, untracked = [] } = useFreshnessRollup();
  const [hover, setHover] = React.useState(false);
  const [xy, setXY] = React.useState(null);
  const ref = React.useRef(null);

  // Untracked = a scheduled feed with no health record (a registration defect,
  // e.g. the 2026-07-20 EDGAR cutover). It outranks green: the pill must never
  // claim "All feeds current" while a feed exists that the system isn't
  // watching (Joe 2026-07-21). Grey, not red — the feed may well be running;
  // we just can't prove it.
  const status = loading ? 'checking' : red.length > 0 ? 'red' : amber.length > 0 ? 'amber' : untracked.length > 0 ? 'untracked' : 'green';
  const color =
    status === 'red' ? 'var(--mt-down)'
      : status === 'amber' ? 'var(--mt-amber)'
        : status === 'green' ? 'var(--mt-up)'
          : 'var(--mt-ink-3)';
  const text =
    status === 'checking' ? 'Checking feeds…'
      : status === 'red' ? `${red.length} feed${red.length > 1 ? 's' : ''} stale`
        : status === 'amber' ? `${amber.length} feed${amber.length > 1 ? 's' : ''} lagging`
          : status === 'untracked' ? `${untracked.length} feed${untracked.length > 1 ? 's' : ''} not tracked`
            : 'All feeds current';

  const onEnter = () => {
    setHover(true);
    const el = ref.current;
    if (el) {
      const r = el.getBoundingClientRect();
      const HALF = 150;
      const cx = Math.max(HALF, Math.min(window.innerWidth - HALF, r.left + r.width / 2));
      setXY({ x: cx, y: r.bottom });
    }
  };
  const onLeave = () => { setHover(false); setXY(null); };

  const Row = ({ item }) => (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 7, padding: '3px 0' }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--mt-down)', flexShrink: 0, marginTop: 5 }} />
      <span style={{ color: 'var(--mt-ink-0)', lineHeight: 1.35 }}>{item.label}</span>
    </div>
  );
  const AmberRow = ({ item }) => (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 7, padding: '3px 0' }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--mt-amber)', flexShrink: 0, marginTop: 5 }} />
      <span style={{ color: 'var(--mt-ink-0)', lineHeight: 1.35 }}>{item.label}</span>
    </div>
  );

  const tip = hover && xy ? createPortal(
    <div
      role="tooltip"
      style={{
        position: 'fixed', left: xy.x, top: xy.y + 10, transform: 'translate(-50%,0)',
        background: 'var(--mt-surface)', color: 'var(--mt-ink-0)',
        border: '1px solid var(--mt-line-1)', borderRadius: 8,
        padding: '10px 12px', fontSize: 11.5, fontFamily: 'var(--mt-font-ui)',
        boxShadow: '0 8px 24px rgba(0,0,0,0.12)', maxWidth: 300, width: 'max-content',
        zIndex: 9999, pointerEvents: 'none',
      }}
    >
      {status === 'green' ? (
        <div style={{ color: 'var(--mt-ink-1)' }}>Every tracked feed across the whole site is within its freshness target.</div>
      ) : status === 'untracked' ? (
        <>
          <div style={{ fontWeight: 600, color: 'var(--mt-ink-0)', marginBottom: 4 }}>
            {untracked.length} scheduled feed{untracked.length > 1 ? 's' : ''} without freshness tracking
          </div>
          {untracked.map((item) => (
            <div key={item.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 7, padding: '3px 0' }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--mt-ink-3)', flexShrink: 0, marginTop: 5 }} />
              <span style={{ color: 'var(--mt-ink-0)', lineHeight: 1.35 }}>{item.label}</span>
            </div>
          ))}
          <div style={{ marginTop: 6, color: 'var(--mt-ink-2)' }}>These feeds are registered but have no health record yet, so their freshness can't be verified.</div>
        </>
      ) : status === 'checking' ? (
        <div style={{ color: 'var(--mt-ink-2)' }}>Checking feeds…</div>
      ) : (
        <>
          {red.length > 0 && (
            <>
              <div style={{ fontWeight: 600, color: 'var(--mt-ink-0)', marginBottom: 4 }}>
                {red.length} feed{red.length > 1 ? 's' : ''} stale
              </div>
              {red.map((item) => <Row key={item.id} item={item} />)}
            </>
          )}
          {amber.length > 0 && (
            <>
              <div style={{ fontWeight: 600, color: 'var(--mt-ink-0)', margin: '8px 0 4px' }}>
                {amber.length} lagging (today's update is late)
              </div>
              {amber.map((item) => <AmberRow key={item.id} item={item} />)}
            </>
          )}
          <div style={{ marginTop: 8, paddingTop: 7, borderTop: '1px solid var(--mt-line-1)', color: 'var(--mt-ink-2)', fontSize: 10.5 }}>
            Full status on Admin · Data
          </div>
        </>
      )}
    </div>,
    document.body,
  ) : null;

  return (
    <span
      ref={ref}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      onFocus={onEnter}
      onBlur={onLeave}
      tabIndex={0}
      aria-label={status === 'red' ? `${red.length} feeds stale: ${red.map((r) => r.label).join(', ')}` : text}
      style={{ cursor: 'help', display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, fontFamily: 'var(--mt-font-ui)', color, padding: '3px 10px', borderRadius: 999, background: `color-mix(in oklab, ${color} 12%, transparent)`, fontWeight: 500 }}
    >
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: color, flexShrink: 0 }} />
      {text}
      {tip}
    </span>
  );
}

// Exported 2026-08-18: the homepage footer carried its OWN market clock and the
// two had drifted. Before 9:30 ET the header read "Market pre-open" while the
// footer a few screens below read "market closed" — one page, one instant, two
// answers. Worse, that copy had no holiday table, so on Juneteenth or
// Thanksgiving it would have read "market open" outright. One clock, one
// reader: LESSONS 4.28 rule 2, pointed at a market state rather than a
// freshness deadline.
export function nyseMarketState(now = new Date()) {
  // NYSE 9:30 ET → 16:00 ET on trading days. Trading day = weekday AND not an
  // NYSE holiday (the same holiday table the freshness clock uses, so a federal
  // holiday like Juneteenth reads "Market closed", not "Market open").
  const opts = { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false, weekday: 'short' };
  const parts = new Intl.DateTimeFormat('en-US', opts).formatToParts(now);
  const get = (t) => parts.find((p) => p.type === t)?.value;
  const wk = get('weekday');
  const h = Number(get('hour'));
  const m = Number(get('minute'));
  const mins = h * 60 + m;
  // ET calendar date (YYYY-MM-DD) for the holiday lookup.
  const etDate = now.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  const isHoliday = NYSE_HOLIDAYS.has(etDate);
  const isTradingDay = !['Sat', 'Sun'].includes(wk) && !isHoliday;
  if (!isTradingDay) return { open: false, label: isHoliday ? 'Market closed · holiday' : 'Market closed' };
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
  const { tweaks, setTweak } = useTweaks();
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
      <TickerSearch />
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
      </div>
    </header>
  );
}
