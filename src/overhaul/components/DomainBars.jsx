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

// Compact unit shown on the pill face — only short symbols; longer units
// (index, ratio, etc.) stay in the tooltip so the pill never crowds.
const FACE_UNITS = new Set(['%', 'bp', 'x', 'pts', '¢']);
function faceUnit(u) {
  const s = (u || '').trim();
  return FACE_UNITS.has(s) ? s : '';
}
// Indicator reading for the pill face: value + compact unit, no space to save
// width ("4.35%", "27bp", "1.2x"). Long-unit series show the bare number.
function indReading(i) {
  if (i.value == null || !Number.isFinite(i.value)) return null;
  return `${fmtVal(i.value, i.decimals)}${faceUnit(i.unit)}`;
}
// Positioning reading for the pill face: dealer = net $bn, futures = net % of
// open interest, both signed.
function posReading(m) {
  if (m.specNet == null || !Number.isFinite(m.specNet)) return null;
  const sign = m.specNet > 0 ? '+' : '';
  return m.comm == null ? `${sign}${m.specNet}bn` : `${sign}${m.specNet}%`;
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

/* Signed change in the element's value over its own cadence (last day / week /
   month / quarter). Returns the magnitude (lastV − prevV) or null. */
function changeOf(points, freq) {
  if (!Array.isArray(points) || points.length < 2) return null;
  const lastT = Date.parse(String(points[points.length - 1][0]).slice(0, 10) + 'T00:00:00Z');
  const lastV = points[points.length - 1][1];
  if (!Number.isFinite(lastV) || !Number.isFinite(lastT)) return null;
  const lookbackMs = (PERIOD_DAYS[freq] || 7) * 86400000 - 43200000;
  let prevV = points[points.length - 2][1];
  for (let k = points.length - 2; k >= 0; k--) {
    const t = Date.parse(String(points[k][0]).slice(0, 10) + 'T00:00:00Z');
    if (Number.isFinite(points[k][1])) prevV = points[k][1];
    if (Number.isFinite(t) && lastT - t >= lookbackMs) break;
  }
  if (!Number.isFinite(prevV)) return null;
  return lastV - prevV;
}
/* Direction +1 up / −1 down / 0 flat — green up / red down, site convention. */
function trendOf(points, freq) {
  const d = changeOf(points, freq);
  return d == null || d === 0 ? 0 : d > 0 ? 1 : -1;
}
// Change magnitude (unsigned) formatted to the element's own precision; the
// arrow carries the direction, so the number stays uncluttered.
function fmtChange(delta, decimals) {
  if (delta == null || !Number.isFinite(delta) || delta === 0) return null;
  const s = fmtVal(Math.abs(delta), decimals);
  // Magnitude rounds to zero at this precision — show the direction arrow only,
  // never a misleading "▲ 0".
  return parseFloat(s) === 0 ? null : s;
}

function tagClass(state) {
  return `mc-pill mt-tag--${state === 'extreme' ? 'extreme' : state === 'elevated' ? 'elev' : 'calm'}`;
}

function GaugePill({ label, valueText, changeText, tipText, pct, state, trend = 0, dashed, dimmed, onClick, onTip, onHideTip }) {
  const arrow = trend > 0 ? '▲' : trend < 0 ? '▼' : '·';
  const arrowColor = trend > 0 ? 'var(--mt-up)' : trend < 0 ? 'var(--mt-down)' : 'var(--mt-ink-3)';
  const rowBase = { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 6 };
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
        font: 'inherit', padding: '6px 9px', lineHeight: 1.2,
        width: '100%', display: 'block', textAlign: 'left', borderRadius: 7,
        opacity: dimmed ? 0.85 : 1, transition: 'opacity .25s ease, filter .12s ease, transform .12s ease',
      }}
    >
      {/* Row 1: name + reading */}
      <span style={rowBase}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 11.5, color: 'var(--mt-ink-1)' }}>{label}</span>
        <span className="num" style={{ flex: '0 0 auto', fontWeight: 600, color: 'var(--mt-ink-0)', fontSize: 12.5 }}>{valueText != null ? valueText : '—'}</span>
      </span>
      {/* Row 2: change (arrow + magnitude) + percentile */}
      <span style={{ ...rowBase, marginTop: 3 }}>
        <span className="num" style={{ fontSize: 9.5, color: arrowColor, fontWeight: 700, whiteSpace: 'nowrap' }}>
          {arrow}{trend !== 0 && changeText ? ` ${changeText}` : ''}
        </span>
        <span className="num" style={{ flex: '0 0 auto', fontSize: 9.5, color: 'var(--mt-ink-3)', fontWeight: 600 }}>
          {pct == null ? '—' : `${Math.round(pct)}${ordSfx(pct)}`}
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
        {inds.map((i) => {
          const delta = changeOf(i.points, i.freq);
          const chgUnit = faceUnit(i.unit);
          return (
          <GaugePill
            key={i.id}
            label={shortLabel(i.name)}
            valueText={indReading(i)}
            changeText={fmtChange(delta, i.decimals)}
            tipText={
              (i.pct == null
                ? `${i.name} — not enough history to rank yet`
                : `${i.name} — ${fmtVal(i.value, i.decimals)}${i.unit ? ' ' + i.unit : ''} · ${Math.round(i.pct)}${ordSfx(i.pct)} percentile of its 3-year range`
                  + (delta != null && delta !== 0 ? ` · ${delta > 0 ? '+' : '−'}${fmtVal(Math.abs(delta), i.decimals)}${chgUnit} latest move` : ''))
              + (i.description ? `\n\n${i.description}` : '')
            }
            pct={i.pct}
            state={i.state}
            trend={delta == null || delta === 0 ? 0 : delta > 0 ? 1 : -1}
            onClick={() => onSelectInd(i)}
            onTip={onTip}
            onHideTip={onHideTip}
          />
          );
        })}
      </div>
      {markets.length > 0 && (
        <>
          <div style={{ ...head, margin: '13px 0 7px', paddingTop: 12, borderTop: '1px solid var(--mt-line-1)' }}>
            Positioning signals
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 5 }}>
            {markets.map((m) => {
              const mstate = m.spec <= 10 || m.spec >= 90 ? 'extreme' : m.spec <= 25 || m.spec >= 75 ? 'elevated' : 'calm';
              const h = Array.isArray(m.history) ? m.history : [];
              const mDelta = h.length >= 2 && Number.isFinite(h[h.length - 1][1]) && Number.isFinite(h[h.length - 2][1])
                ? h[h.length - 1][1] - h[h.length - 2][1] : null;
              const mtrend = mDelta == null || mDelta === 0 ? 0 : mDelta > 0 ? 1 : -1;
              return (
                <GaugePill
                  key={m.market}
                  label={shortLabel(m.market)}
                  valueText={posReading(m)}
                  changeText={fmtChange(mDelta, 0)}
                  tipText={`${m.market} — ${m.comm == null ? 'dealers' : 'speculators'} net ${posReading(m) || '—'} · ${Math.round(m.spec)}${ordSfx(m.spec)} percentile of 3 years`
                    + (mDelta != null && mDelta !== 0 ? ` · ${mDelta > 0 ? '+' : '−'}${Math.abs(Math.round(mDelta))} pctile vs prior print` : '')
                    + (posDimmed ? ` · awaiting next print${posNextPrint ? ` (${posNextPrint})` : ''}` : '')}
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
