/* DomainBars — the "bars" view of a Macro Overview domain tile
   (Joe-approved design, 2026-06-11 mock v3 iteration).

   One compact chart per domain: every indicator and positioning signal is a
   thin vertical bar ANCHORED AT ITS OWN 3-YEAR MEDIAN (the 50th-percentile
   line). Bar length = how far today sits from its normal; direction = above
   or below; color = the SAME state that colors the pill (calm / stretched /
   3-year extreme), so the two views can never disagree.

   Joe's binding requirements baked in:
   - Labels use shortLabel() — the exact sanctioned pill names. Never invent
     abbreviations here.
   - Full hover + click parity with pills: hover lifts the bar and shows the
     page tooltip (name · value · percentile · Δ); click opens the same
     indicator / positioning detail panel.
   - NO text badges like "4 extreme" — the bars carry the message.
   - Gridlines run the full width of the chart (25 / 50 / 75).
   - Positioning group sits right of a dashed divider and dims between
     prints (CFTC report older than 6 calendar days), with the next print
     noted in its tooltip rather than text clutter.
   - Theme tokens only; animates height on mount and on view toggle. */

import React, { useEffect, useState } from 'react';

const CHART_H = 120;
const LABEL_H = 64;

function ordSfx(n) {
  const v = Math.abs(Math.round(n)), k = v % 100;
  if (k >= 11 && k <= 13) return 'th';
  return { 1: 'st', 2: 'nd', 3: 'rd' }[v % 10] || 'th';
}

function stateColor(s) {
  return s === 'extreme' ? 'var(--mt-down)' : s === 'elevated' ? 'var(--mt-warn)' : 'var(--mt-up)';
}

function fmtVal(v, decimals) {
  if (v == null || !Number.isFinite(v)) return '—';
  return v.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: decimals ?? 2 });
}

/* One bar (indicator or positioning). Mounts at zero height and grows to its
   value so the view "pops" in — same spirit as the pill hover transitions. */
function Bar({ label, tipText, pct, state, dimmed, onClick, onTip, onHideTip, delta }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const t = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(t);
  }, []);
  const has = pct != null && Number.isFinite(pct);
  const up = has && pct >= 50;
  const frac = has ? Math.abs(pct - 50) / 100 : 0;
  const hPx = Math.max(has ? 3 : 2, frac * CHART_H);
  const topPx = up ? (1 - pct / 100) * CHART_H : CHART_H / 2;
  return (
    <div
      className="mb-col"
      role="button"
      tabIndex={0}
      onClick={(e) => { e.stopPropagation(); onClick && onClick(); }}
      onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); onClick && onClick(); } }}
      onMouseEnter={(e) => onTip && onTip(e, tipText)}
      onMouseLeave={onHideTip}
      style={{ flex: 1, minWidth: 0, position: 'relative', height: CHART_H + LABEL_H, cursor: 'pointer', opacity: dimmed ? 0.45 : 1, transition: 'opacity .25s ease' }}
    >
      {delta != null && Math.abs(delta) >= 2 && (
        <span
          className="num"
          style={{
            position: 'absolute', left: 0, right: 0, textAlign: 'center',
            top: Math.max(0, (up ? topPx : CHART_H / 2 + hPx) + (up ? -13 : 2)),
            fontSize: 9.5, color: 'var(--mt-ink-3)', whiteSpace: 'nowrap', pointerEvents: 'none',
          }}
        >
          {delta > 0 ? '▲' : '▼'}{Math.abs(Math.round(delta))}
        </span>
      )}
      <span
        className="mb-bar"
        style={{
          position: 'absolute', left: '50%', transform: 'translateX(-50%)',
          width: '55%', maxWidth: 12, minWidth: 3,
          top: mounted ? topPx : CHART_H / 2,
          height: mounted ? hPx : 2,
          background: has ? stateColor(state) : 'var(--mt-ink-3)',
          borderRadius: up ? '2px 2px 0 0' : '0 0 2px 2px',
          opacity: has ? 1 : 0.35,
        }}
      />
      <span
        style={{
          position: 'absolute', top: CHART_H + 6, left: 0, right: 0,
          display: 'flex', justifyContent: 'center', height: LABEL_H - 8, overflow: 'hidden', pointerEvents: 'none',
        }}
      >
        <span style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)', fontSize: 10.5, lineHeight: 1.1, color: 'var(--mt-ink-2)', maxHeight: LABEL_H - 8, overflow: 'hidden' }}>
          {label}
        </span>
      </span>
    </div>
  );
}

export default function DomainBars({ inds = [], markets = [], shortLabel, posDimmed, posNextPrint, onSelectInd, onSelectPos, onTip, onHideTip }) {
  const gridline = (p, strong) => (
    <div
      key={p}
      style={{
        position: 'absolute', left: 0, right: 0, top: (1 - p / 100) * CHART_H,
        borderTop: strong ? '1.5px solid var(--mt-line-1)' : '1px dashed var(--mt-line-0)',
        pointerEvents: 'none',
      }}
    />
  );
  return (
    <div style={{ position: 'relative', marginTop: 10 }}>
      <style>{`.mb-bar{transition:height .45s var(--mt-ease, ease), top .45s var(--mt-ease, ease), filter .12s ease}.mb-col:hover .mb-bar{filter:brightness(1.25)}.mb-col:hover{transform:translateY(-1px)}.mb-col{transition:transform .12s ease}`}</style>
      <div style={{ position: 'relative', height: CHART_H + LABEL_H }}>
        {[75, 25].map((p) => gridline(p, false))}
        {gridline(50, true)}
        <span style={{ position: 'absolute', right: 0, top: (1 - 50 / 100) * CHART_H - 14, fontSize: 9, letterSpacing: '.06em', color: 'var(--mt-ink-3)', pointerEvents: 'none' }}>3y median</span>
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'stretch', gap: 2 }}>
          {inds.map((i) => (
            <Bar
              key={i.id}
              label={shortLabel(i.name)}
              tipText={
                i.pct == null
                  ? `${i.name} — not enough history to rank yet`
                  : `${i.name} — ${fmtVal(i.value, i.decimals)}${i.unit ? ' ' + i.unit : ''} · ${Math.round(i.pct)}${ordSfx(i.pct)} percentile of its 3-year range${i.deltaPct != null && Math.abs(i.deltaPct) >= 2 ? ` · ${i.deltaPct > 0 ? '+' : ''}${Math.round(i.deltaPct)} pts vs prior print` : ''}`
              }
              pct={i.pct}
              state={i.state}
              delta={i.deltaPct}
              onClick={() => onSelectInd(i)}
              onTip={onTip}
              onHideTip={onHideTip}
            />
          ))}
          {markets.length > 0 && (
            <div style={{ width: 0, borderLeft: '1px dashed var(--mt-line-1)', margin: '0 4px', height: CHART_H + LABEL_H }} />
          )}
          {markets.map((m) => (
            <Bar
              key={m.market}
              label={shortLabel(m.market)}
              tipText={`${m.market} — speculators at the ${Math.round(m.spec)}${ordSfx(m.spec)} percentile of 3 years${posDimmed ? ` · awaiting next print${posNextPrint ? ` (${posNextPrint})` : ''}` : ''}`}
              pct={m.spec}
              state={m.spec <= 10 || m.spec >= 90 ? 'extreme' : m.spec <= 25 || m.spec >= 75 ? 'elevated' : 'calm'}
              dimmed={posDimmed}
              onClick={() => onSelectPos(m)}
              onTip={onTip}
              onHideTip={onHideTip}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
