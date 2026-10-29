/* PageHeader — the STATUS LINE under the top bar, on every page (2026-10-28
   redesign): the date, the market state with the session the prices belong
   to ("US market pre-open · prices as of Monday's close", or "US market open ·
   live prices"), and the site-wide feeds pill with its pulsing dot. The
   search box and the theme toggle moved up into TopNav.

   Every word on this line is driven by logic that already existed: the
   market clock below (one clock for the whole site, LESSONS 4.28), the
   newest "as of" among the ticker bar's series (the same reader Home's old
   footer used), and the freshness rollup the pill has always graded off.
   (Tweaks gear retired 2026-07-21.) */

import React, { useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useFreshnessRollup } from '../../hooks/useFreshness';
import { NYSE_HOLIDAYS, latestTradingSessionDate } from '../../lib/freshnessClock';
import useMarketLevels from '../lib/useMarketLevels';
import { TAPE_ITEMS } from './MarketTape';

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
  const { loading, red, amber, untracked = [], skipped = [] } = useFreshnessRollup();
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
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--sp-7)', padding: 'var(--sp-3) 0' }}>
      <span style={{ width: 6, height: 6, borderRadius: 'var(--r-50pct)', background: 'var(--mt-down)', flexShrink: 0, marginTop: 'var(--sp-5)' }} />
      <span style={{ color: 'var(--mt-ink-0)', lineHeight: 1.35 }}>{item.label}</span>
    </div>
  );
  const AmberRow = ({ item }) => (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--sp-7)', padding: 'var(--sp-3) 0' }}>
      <span style={{ width: 6, height: 6, borderRadius: 'var(--r-50pct)', background: 'var(--mt-amber)', flexShrink: 0, marginTop: 'var(--sp-5)' }} />
      <span style={{ color: 'var(--mt-ink-0)', lineHeight: 1.35 }}>{item.label}</span>
    </div>
  );

  const tip = hover && xy ? createPortal(
    <div
      role="tooltip"
      style={{
        position: 'fixed', left: xy.x, top: xy.y + 10, transform: 'translate(-50%,0)',
        background: 'var(--mt-surface)', color: 'var(--mt-ink-0)',
        border: '1px solid var(--mt-line-1)', borderRadius: 'var(--r-8)',
        padding: 'var(--sp-10) var(--sp-12)', fontSize: 'var(--v13-t2)', fontFamily: 'var(--mt-type-sans)',
        boxShadow: 'var(--sh-25)', maxWidth: 300, width: 'max-content',
        zIndex: 9999, pointerEvents: 'none',
      }}
    >
      {status === 'green' ? (
        <div style={{ color: 'var(--mt-ink-1)' }}>Every tracked feed across the whole site is within its freshness target.</div>
      ) : status === 'untracked' ? (
        <>
          <div style={{ fontWeight: 'var(--fw-600)', color: 'var(--mt-ink-0)', marginBottom: 'var(--sp-4)' }}>
            {untracked.length} scheduled feed{untracked.length > 1 ? 's' : ''} without freshness tracking
          </div>
          {untracked.map((item) => (
            <div key={item.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--sp-7)', padding: 'var(--sp-3) 0' }}>
              <span style={{ width: 6, height: 6, borderRadius: 'var(--r-50pct)', background: 'var(--mt-ink-3)', flexShrink: 0, marginTop: 'var(--sp-5)' }} />
              <span style={{ color: 'var(--mt-ink-0)', lineHeight: 1.35 }}>{item.label}</span>
            </div>
          ))}
          <div style={{ marginTop: 'var(--sp-6)', color: 'var(--mt-ink-2)' }}>These feeds are registered but have no health record yet, so their freshness can't be verified.</div>
        </>
      ) : status === 'checking' ? (
        <div style={{ color: 'var(--mt-ink-2)' }}>Checking feeds…</div>
      ) : (
        <>
          {red.length > 0 && (
            <>
              <div style={{ fontWeight: 'var(--fw-600)', color: 'var(--mt-ink-0)', marginBottom: 'var(--sp-4)' }}>
                {red.length} feed{red.length > 1 ? 's' : ''} stale
              </div>
              {red.map((item) => <Row key={item.id} item={item} />)}
            </>
          )}
          {amber.length > 0 && (
            <>
              <div style={{ fontWeight: 'var(--fw-600)', color: 'var(--mt-ink-0)', margin: 'var(--sp-8) 0 var(--sp-4)' }}>
                {amber.length} lagging (today's update is late)
              </div>
              {amber.map((item) => <AmberRow key={item.id} item={item} />)}
            </>
          )}
          {/* Producers that ran and published nothing. Listed, never counted as
              stale (Joe 2026-10-02) — the pill reports breakages, and these are
              working writers with nothing to say. */}
          {skipped.length > 0 && (
            <>
              <div style={{ fontWeight: 'var(--fw-600)', color: 'var(--mt-ink-0)', margin: 'var(--sp-8) 0 var(--sp-4)' }}>
                {skipped.length} ran with nothing new to publish
              </div>
              {skipped.map((item) => (
                <div key={item.id} style={{ display: 'flex', gap: 'var(--sp-6)', alignItems: 'flex-start', padding: 'var(--sp-3) 0' }}>
                  <span style={{ width: 6, height: 6, borderRadius: 'var(--r-50pct)', background: 'var(--mt-ink-3)', flexShrink: 0, marginTop: 'var(--sp-5)' }} />
                  <span style={{ color: 'var(--mt-ink-0)', lineHeight: 1.35 }}>
                    {item.label}
                    {item.skipCount > 1 ? ` · ${item.skipCount} runs in a row` : ''}
                  </span>
                </div>
              ))}
            </>
          )}
          <div style={{ marginTop: 'var(--sp-8)', paddingTop: 'var(--sp-7)', borderTop: '1px solid var(--mt-line-1)', color: 'var(--mt-ink-2)', fontSize: 'var(--v13-t1)' }}>
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
      className={`rd-feeds rd-feeds--${status}`}
      style={{ '--rd-feeds-color': color }}
    >
      {/* the dot pulses only when everything is current — a soft ring every
          2.4s; a red or amber dot holds still so the state reads at a glance */}
      <span className={`rd-feeds-dot${status === 'green' ? ' rd-live' : ''}`} />
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

/* "Monday's close" — the weekday of the newest close the ticker bar is
   showing, in words. Outside the session the status line says which close
   the prices belong to; during the session it says they are live. */
function closeWeekday(iso) {
  if (!iso) return null;
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(d.getTime())) return null;
  return d.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
}

export default function PageHeader() {
  const ms = nyseMarketState();
  const today = formatToday();
  const { level } = useMarketLevels();
  const newestAsOf = useMemo(() => {
    // 2026-10-29: the tape also carries series that are stamped ahead of the
    // US session — Nikkei closes ~2am ET, uranium is dated the same morning —
    // so at 6am Thursday this line read "prices as of Thursday's close" while
    // every US row was Wednesday's. The line describes the US session: cap the
    // newest as-of at the last COMPLETED US session (the same clock the
    // freshness code uses). A feed older than that still shows its own day.
    const ds = TAPE_ITEMS.map((r) => level(r.key)?.asOf).filter(Boolean)
      .map((s) => String(s).slice(0, 10)).sort();
    if (!ds.length) return null;
    const newest = ds[ds.length - 1];
    const last = latestTradingSessionDate();
    const pad = (n) => String(n).padStart(2, '0');
    const lastIso = `${last.getFullYear()}-${pad(last.getMonth() + 1)}-${pad(last.getDate())}`;
    return newest > lastIso ? lastIso : newest;
  }, [level]);
  const wd = closeWeekday(newestAsOf);
  const prices = ms.open
    ? 'live prices'
    : wd ? `prices as of ${wd}'s close` : null;
  const stateText = `US ${ms.label.charAt(0).toLowerCase()}${ms.label.slice(1)}`;
  const [weekday, ...rest] = today.split(', ');
  /* The phone row has room for "Wed, Oct 28 · Pre-open" and the feeds pill;
     the long form stays on wider screens. Both are rendered, CSS shows one. */
  const shortDate = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'America/New_York' }).format(new Date());
  const shortState = ms.open ? 'Open' : /pre-open/i.test(ms.label) ? 'Pre-open' : /holiday/i.test(ms.label) ? 'Closed · holiday' : 'Closed';

  return (
    <div className="rd-status" role="contentinfo" aria-label="Market status">
      <div className="rd-status-in">
        <span className="rd-status-date rd-status-long"><b>{weekday}</b>, {rest.join(', ')}</span>
        <span className="rd-status-sep" aria-hidden="true" />
        <span className="rd-status-market rd-status-long">
          <span className={`rd-marketdot${ms.open ? ' is-open' : ''}`} aria-hidden="true" />
          {stateText}{prices ? ` · ${prices}` : ''}
        </span>
        <span className="rd-status-short" title={`${stateText}${prices ? ` · ${prices}` : ''}`}>
          <b>{shortDate}</b> · {shortState}
        </span>
        <span className="rd-status-fill" />
        <AllFeedsPill />
      </div>
    </div>
  );
}
