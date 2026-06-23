/* DomainBars — the Macro Overview domain tile.

   v3 (Joe 2026-06-22): the median-anchored fill bar is removed. Magnitude now
   reads as BACKGROUND SHADE — the more stretched an element is in its own
   3-year range (the real percentile the page already computes), the darker the
   tint of its state color (calm green / elevated amber / extreme red — the
   site's existing warn colors, unchanged). Every tile also carries a consistent
   trend arrow (▲ up = green, ▼ down = red) showing the move over the element's
   own cadence (last day / week / month / quarter), and an instant styled
   tooltip with the element's real description.

   Carried over (binding):
   - Labels via shortLabel() — sanctioned names only.
   - Hover/click parity with the detail panels; .mc-pill drives the hover lift.
   - Instant tooltip via the page's onTip/onHideTip portal — never native title.
   - Positioning section dims between COT prints; tooltip notes the next print. */

import React from 'react';

function ordSfx(n) {
  const v = Math.abs(Math.round(n)), k = v % 100;
  if (k >= 11 && k <= 13) return 'th';
  return { 1: 'st', 2: 'nd', 3: 'rd' }[v % 10] || 'th';
}

function fmtVal(v, decimals) {
  if (v == null || !Number.isFinite(v)) return '—';
  return v.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: decimals ?? 2 });
}

function stateColor(state) {
  return state === 'extreme' ? 'var(--mt-down)' : state === 'elevated' ? 'var(--mt-warn)' : 'var(--mt-up)';
}

/* Background shade from the real percentile: distance from the 3-year median
   (|pct − 50| / 50) scales the tint of the element's state color into the
   surface. Median-neutral tiles read nearly plain; extremes read strongly. */
function shadeBg(pct, state) {
  if (pct == null || !Number.isFinite(pct)) return 'var(--mt-surface)';
  const stretch = Math.min(1, Math.abs(pct - 50) / 50);
  const mix = (7 + 25 * stretch).toFixed(1);
  return `color-mix(in oklab, ${stateColor(state)} ${mix}%, var(--mt-surface))`;
}

const PERIOD_DAYS = { D: 1, W: 7, M: 31, Q: 93 };

/* Direction of the element's value over its own cadence. +1 up / −1 down / 0
   flat. Green up / red down, matching the site convention. */
function trendOf(points, freq) {
  if (!Array.isArray(points) || points.length < 2) return 0;
  const lastIso = String(points[points.length - 1][0]).slice(0, 10);
  const lastT = Date.parse(lastIso + 'T00:00:00Z');
  const lastV = points[points.length - 1][1];
  if (!Number.isFinite(lastV) || !Number.isFinite(lastT)) return 0;
  const lookbackMs = (PERIOD_DAYS[freq] || 7) * 86400000 - 43200000;
  let prevV = points[points.length - 2][1];
  for (let k = points.length - 2; k >= 0; k--) {
    const t = Date.parse(String(points[k][0]).slice(0, 10) + 'T00:00:00Z');
    if (Number.isFinite(points[k][1])) prevV = points[k][1];
    if (Number.isFinite(t) && lastT - t >= lookbackMs) break;
  }
  if (!Number.isFinite(prevV) || prevV === lastV) return 0;
  return lastV > prevV ? 1 : -1;
}

function tagClass(state) {
  return `mc-pill mt-tag--${state === 'extreme' ? 'extreme' : state === 'elevated' ? 'elev' : 'calm'}`;
}

function GaugePill({ label, tipText, pct, state, trend = 0, dashed, dimmed, onClick, onTip, onHideTip }) {
  const arrow = trend > 0 ? '▲' : trend < 0 ? '▼' : '·';
  const arrowColor = trend > 0 ? 'var(--mt-up)' : trend < 0 ? 'var(--mt-down)' : 'var(--mt-ink-3)';
  return (
    <button
      type="button"
      className={tagClass(state)}
      onClick={(e) => { e.stopPropagation(); onClick && onClick(); }}
      onMouseEnter={(e) => onTip && onTip(e, tipText)}
      onMouseLeave={onHideTip}
      style={{
        cursor: 'pointer',
        border: dashed ? '1px dashed var(--mt-line-1)' : '1px solid var(--mt-line-0)',
        background: shadeBg(pct, state),
        color: 'var(--mt-ink-0)',
        font: 'inherit', fontSize: 11.5, padding: '5px 8px', lineHeight: 1.25,
        width: '100%', display: 'block', textAlign: 'left', borderRadius: 7,
        opacity: dimmed ? 0.85 : 1, transition: 'opacity .25s ease, filter .12s ease, transform .12s ease',
      }}
    >
      <span style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'space-between' }}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
        <span style={{ flex: '0 0 auto', display: 'inline-flex', alignItems: 'baseline', gap: 5 }}>
          <span className="num" style={{ fontSize: 9.5, color: arrowColor, fontWeight: 700 }}>{arrow}</span>
          <span className="num" style={{ fontWeight: 600, color: 'var(--mt-ink-1)' }}>{pct == null ? '—' : Math.round(pct)}</span>
        </span>
      </span>
    </button>
  );
}

export default function DomainBars({ inds = [], markets = [], shortLabel, posDimmed, posNextPrint, onSelectInd, onSelectPos, onTip, onHideTip }) {
  const head = {
    fontSize: 11.5, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase',
    color: 'var(--mt-ink-1)', marginBottom: 7,
  };
  return (
    <div style={{ marginTop: 10 }}>
      <div style={head}>Indicators</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 5 }}>
        {inds.map((i) => (
          <GaugePill
            key={i.id}
            label={shortLabel(i.name)}
            tipText={
              (i.pct == null
                ? `${i.name} — not enough history to rank yet`
                : `${i.name} — ${fmtVal(i.value, i.decimals)}${i.unit ? ' ' + i.unit : ''} · ${Math.round(i.pct)}${ordSfx(i.pct)} percentile of its 3-year range${i.deltaPct != null && Math.abs(i.deltaPct) >= 2 ? ` · ${i.deltaPct > 0 ? '+' : ''}${Math.round(i.deltaPct)} pts vs prior print` : ''}`)
              + (i.description ? `\n\n${i.description}` : '')
            }
            pct={i.pct}
            state={i.state}
            trend={trendOf(i.points, i.freq)}
            onClick={() => onSelectInd(i)}
            onTip={onTip}
            onHideTip={onHideTip}
          />
        ))}
      </div>
      {markets.length > 0 && (
        <>
          <div style={{ ...head, margin: '13px 0 7px', paddingTop: 12, borderTop: '1px solid var(--mt-line-1)' }}>
            Positioning signals
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 5 }}>
            {markets.map((m) => {
              const mstate = m.spec <= 10 || m.spec >= 90 ? 'extreme' : m.spec <= 25 || m.spec >= 75 ? 'elevated' : 'calm';
              const mtrend = Array.isArray(m.history) && m.history.length >= 2
                ? (m.history[m.history.length - 1][1] > m.history[m.history.length - 2][1] ? 1
                  : m.history[m.history.length - 1][1] < m.history[m.history.length - 2][1] ? -1 : 0)
                : 0;
              return (
                <GaugePill
                  key={m.market}
                  label={shortLabel(m.market)}
                  tipText={`${m.market} — speculators at the ${Math.round(m.spec)}${ordSfx(m.spec)} percentile of 3 years${posDimmed ? ` · awaiting next print${posNextPrint ? ` (${posNextPrint})` : ''}` : ''}`}
                  pct={m.spec}
                  state={mstate}
                  trend={mtrend}
                  dashed
                  dimmed={posDimmed}
                  onClick={() => onSelectPos(m)}
                  onTip={onTip}
                  onHideTip={onHideTip}
                />
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
