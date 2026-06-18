/* DomainBars — the "bars" view of a Macro Overview domain tile.

   v2 (Joe 2026-06-11): the original thin vertical bars with rotated labels
   lost every legibility comparison with the pill view ("toggling to bars it
   just looks like shit"). This version IS the pill view — identical grid,
   identical tag chrome, identical text — with one addition per pill: a slim
   horizontal gauge anchored at the element's own 3-year median (center tick),
   filling toward today's percentile in the pill's own state color. Length =
   how stretched; side = above or below its normal; color = the same
   calm / stretched / extreme state as everywhere else.

   Joe's binding requirements carried over:
   - Labels via shortLabel() — sanctioned names only.
   - Hover/click parity: same tooltip, same detail panels, same hover lift
     (the .mc-pill class from the pill view drives the animation).
   - No text badges; Δ vs prior print appears as a small marker on fresh
     prints only.
   - Positioning section dims between COT prints, tooltip notes next print. */

import React, { useEffect, useState } from 'react';

function ordSfx(n) {
  const v = Math.abs(Math.round(n)), k = v % 100;
  if (k >= 11 && k <= 13) return 'th';
  return { 1: 'st', 2: 'nd', 3: 'rd' }[v % 10] || 'th';
}

function fmtVal(v, decimals) {
  if (v == null || !Number.isFinite(v)) return '—';
  return v.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: decimals ?? 2 });
}

function tagClass(state) {
  return `mt-tag mc-pill mt-tag--${state === 'extreme' ? 'extreme' : state === 'elevated' ? 'elev' : 'calm'}`;
}

/* The median-anchored gauge inside a pill. Drawn with currentColor so it
   automatically takes the pill's state color in every theme. Animates from
   the center on mount, like the old bars grew from the baseline. */
function Gauge({ pct, dimmed }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const t = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(t);
  }, []);
  if (pct == null || !Number.isFinite(pct)) return <span style={{ display: 'block', height: 3, marginTop: 4 }} />;
  const left = Math.min(pct, 50);
  const width = Math.abs(pct - 50);
  return (
    <span style={{ position: 'relative', display: 'block', height: 3, marginTop: 4, borderRadius: 2, background: 'color-mix(in oklab, currentColor 18%, transparent)', opacity: dimmed ? 0.45 : 1, transition: 'opacity .25s ease' }}>
      <span style={{ position: 'absolute', left: '50%', top: -1, bottom: -1, width: 1.5, background: 'currentColor', opacity: 0.55 }} />
      <span
        style={{
          position: 'absolute', top: 0, bottom: 0, borderRadius: 2, background: 'currentColor',
          left: mounted ? `${left}%` : '50%',
          width: mounted ? `${width}%` : 0,
          transition: 'left .45s var(--mt-ease, ease), width .45s var(--mt-ease, ease)',
        }}
      />
    </span>
  );
}

function GaugePill({ label, tipText, pct, state, delta, dashed, dimmed, onClick, onTip, onHideTip }) {
  return (
    <button
      type="button"
      className={tagClass(state)}
      onClick={(e) => { e.stopPropagation(); onClick && onClick(); }}
      onMouseEnter={(e) => onTip && onTip(e, tipText)}
      onMouseLeave={onHideTip}
      style={{
        cursor: 'pointer', border: dashed ? '1px dashed currentColor' : 'none', font: 'inherit',
        fontSize: 11.5, padding: '2px 7px', lineHeight: 1.25,
        width: '100%', display: 'block', textAlign: 'left',
        // Off-print state (Joe 2026-06-11: "make the text more visible on the
        // signals"): the old 50% whole-pill dim washed out the labels. Names
        // and numbers stay at full strength; the GAUGE carries the dim, and
        // the section header carries "next print Sat 7:00a ET".
        opacity: dimmed ? 0.9 : 1, transition: 'opacity .25s ease',
      }}
    >
      <span style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'space-between' }}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
        <span style={{ flex: '0 0 auto', display: 'inline-flex', alignItems: 'baseline', gap: 4 }}>
          {delta != null && Math.abs(delta) >= 2 && (
            <span className="num" style={{ fontSize: 9.5, opacity: 0.75 }}>{delta > 0 ? '▲' : '▼'}{Math.abs(Math.round(delta))}</span>
          )}
          <span className="num" style={{ opacity: 0.85 }}>{pct == null ? '—' : Math.round(pct)}</span>
        </span>
      </span>
      <Gauge pct={pct} dimmed={dimmed} />
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
      </div>
      {markets.length > 0 && (
        <>
          <div style={{ ...head, margin: '13px 0 7px', paddingTop: 12, borderTop: '1px solid var(--mt-line-1)' }}>
            Positioning signals
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 5 }}>
            {markets.map((m) => (
              <GaugePill
                key={m.market}
                label={shortLabel(m.market)}
                tipText={`${m.market} — speculators at the ${Math.round(m.spec)}${ordSfx(m.spec)} percentile of 3 years${posDimmed ? ` · awaiting next print${posNextPrint ? ` (${posNextPrint})` : ''}` : ''}`}
                pct={m.spec}
                state={m.spec <= 10 || m.spec >= 90 ? 'extreme' : m.spec <= 25 || m.spec >= 75 ? 'elevated' : 'calm'}
                dashed
                dimmed={posDimmed}
                onClick={() => onSelectPos(m)}
                onTip={onTip}
                onHideTip={onHideTip}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
