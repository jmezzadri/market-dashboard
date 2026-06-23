/* EngineReadBand — slimmed "Engine read" headline band for Macro Overview.

   Moved here from the retired Asset Tilt page (Joe 2026-06-22). Surfaces the
   two-axis de-risk engine — the validated muscle of MacroTilt — as the lead
   read on Macro Overview:
     - Stress gauge (MOVE) → how much equity to carry.
     - Yield-regime gauge (3-month change in the 10-year) → which defensive
       sleeve holds when de-risked.
     - 24-week regime strip → when the engine last moved.

   Self-contained on purpose: it reuses the shared gauge + live engine hook
   but carries its OWN compact styling (tokens only) so it does not depend on
   the Asset Tilt stylesheet, which is removed with that page. Every value is
   real — live MOVE / yield from useEngineRegime, thresholds + equity split
   from macrotilt_engine.json, the strip from macrotilt_engine_history.json.
   Nothing is fabricated; missing data renders an em-dash. */

import React, { useEffect, useState, useMemo } from 'react';
import BigGauge, { GaugeLegend } from './BigGauge';
import FreshnessChip from './FreshnessChip';
import useEngineRegime from '../lib/useEngineRegime';

function stressKind(s) {
  if (s === 'Risk On') return 'up';
  if (s === 'Watch') return 'warn';
  if (s === 'Risk Off') return 'down';
  return 'flat';
}
function yieldKind(y) {
  if (y === 'Deflationary') return 'up';
  if (y === 'Inflationary') return 'down';
  if (y === 'Neutral') return 'warn';
  return 'flat';
}
const KIND_COLOR = {
  up: 'var(--mt-up)',
  warn: 'var(--mt-warn)',
  down: 'var(--mt-down)',
  flat: 'var(--mt-ink-3)',
};

export default function EngineReadBand({ onTip, onHideTip }) {
  const regime = useEngineRegime();
  const [eng, setEng] = useState(null);
  const [weekly, setWeekly] = useState([]);

  useEffect(() => {
    let cancelled = false;
    fetch('/macrotilt_engine.json', { cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (!cancelled && j) setEng(j); })
      .catch(() => {});
    fetch('/macrotilt_engine_history.json', { cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (!cancelled && Array.isArray(j?.weekly)) setWeekly(j.weekly); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const stress = eng?.stress || null;
  const yld = eng?.yield_regime || null;
  const alloc = eng?.allocation || null;
  const equityPct = alloc?.equity_pct ?? null;
  const sleeveLabel = alloc?.active_sleeve_label || yld?.state || null;
  const defensiveOn = equityPct != null && equityPct < 100;

  const watchT = stress?.watch_threshold_value ?? 116;
  const riskOffT = stress?.risk_off_threshold_value ?? 124;
  const inflT = yld?.inflationary_threshold_bp ?? 33;
  const deflT = yld?.deflationary_threshold_bp ?? -10;

  const tail24 = useMemo(() => weekly.slice(-24), [weekly]);

  const stressState = stress?.state || regime.stressZone || null;
  const yieldState = yld?.state || regime.yieldRegime || null;

  const tip = (e, text) => onTip && onTip(e, text);

  return (
    <section className="mt-pagesection mer-band" style={{ paddingTop: 14 }}>
      <style>{`
        .mer-card{background:var(--mt-surface);border:1px solid var(--mt-line-1);border-radius:var(--mt-r-lg);padding:18px 20px}
        .mer-head{display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:8px;margin-bottom:4px}
        .mer-state{font-family:var(--mt-font-display);font-size:clamp(16px,1.7vw,21px);font-weight:500;color:var(--mt-ink-0);line-height:1.2}
        .mer-grid{display:grid;grid-template-columns:1fr 1fr;gap:22px;margin-top:14px}
        .mer-ghead{display:flex;align-items:baseline;justify-content:space-between;gap:10px}
        .mer-gtitle{display:flex;align-items:center;gap:8px;font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--mt-ink-3);font-weight:700}
        .mer-ghval{display:flex;flex-direction:column;align-items:flex-end;gap:1px;text-align:right;flex:0 0 auto}
        .mer-gval{font-family:var(--mt-font-mono);font-size:24px;font-weight:600;color:var(--mt-ink-0);line-height:1.1}
        .mer-gsub{font-size:11px;color:var(--mt-ink-3)}
        .mer-gcap{min-height:34px;font-size:11.5px;color:var(--mt-ink-2);line-height:1.4;margin:8px 0 2px}
        .mer-strip-wrap{margin-top:18px;padding-top:14px;border-top:1px solid var(--mt-line-1)}
        .mer-strip{display:grid;grid-template-columns:repeat(24,1fr);gap:3px;margin-top:8px}
        .mer-cell{height:26px;border-radius:3px;cursor:default;border-bottom:3px solid transparent}
        .mer-legend{display:flex;flex-wrap:wrap;gap:14px;margin-top:10px;font-size:10.5px;color:var(--mt-ink-3)}
        .mer-legend span{display:inline-flex;align-items:center;gap:5px}
        .mer-dot{width:9px;height:9px;border-radius:50%;display:inline-block}
        @media (max-width:760px){.mer-grid{grid-template-columns:1fr;gap:16px}.mer-strip{grid-template-columns:repeat(12,1fr)}}
      `}</style>

      <div className="mer-card">
        <div className="mer-state">
          {stressState || '—'} · {yieldState || '—'} — {equityPct != null ? `${equityPct}%` : '—'} equity,
          defensive {defensiveOn ? `firing (${sleeveLabel || '—'} sleeve)` : 'on standby'}.
        </div>

        <div className="mer-grid">
          {/* Stress gauge → equity % */}
          <div>
            <div className="mer-ghead">
              <div className="mer-gtitle">
                <span>Stress signal · MOVE Index</span>
                <FreshnessChip elementId="indicator-move-daily" variant="dot" />
              </div>
              <div className="mer-ghval">
                <span className="mer-gval">{regime.move != null ? regime.move.toFixed(1) : '—'}</span>
                <span className="mer-gsub">{regime.movePct != null ? `${regime.movePct}th pctile · 5y` : '—'}</span>
              </div>
            </div>
            {/* spacer keeps both dials aligned with the Yield Regime caption */}
            <div className="mer-gcap" aria-hidden="true" />
            <BigGauge
              value={regime.move ?? 0}
              max={200}
              thresholds={[{ pos: watchT / 200 }, { pos: riskOffT / 200 }]}
            />
            <GaugeLegend
              zones={[
                { kind: 'up', label: 'Risk On', range: `≤ ${Math.round(watchT)}` },
                { kind: 'warn', label: 'Watch', range: `${Math.round(watchT)}–${Math.round(riskOffT)}` },
                { kind: 'down', label: 'Risk Off', range: `≥ ${Math.round(riskOffT)}` },
              ]}
            />
          </div>

          {/* Yield gauge → which sleeve */}
          <div>
            <div className="mer-ghead">
              <div className="mer-gtitle">
                <span>Yield regime · 3-month change in 10-year</span>
                <FreshnessChip elementId="indicator-yield_curve-daily" variant="dot" />
              </div>
              <div className="mer-ghval">
                <span className="mer-gval">{regime.yieldDeltaBp != null ? `${regime.yieldDeltaBp >= 0 ? '+' : ''}${regime.yieldDeltaBp.toFixed(0)} bp` : '—'}</span>
                <span className="mer-gsub">{regime.yieldPct != null ? `${regime.yieldPct}th pctile · 5y` : '—'}</span>
              </div>
            </div>
            <div className="mer-gcap">When Stress Signal indicates Risk Off, Yield Regime dictates allocation.</div>
            <BigGauge
              value={regime.yieldDeltaBp ?? 0}
              max={100}
              bidirectional
              thresholds={[{ pos: (100 + deflT) / 200 }, { pos: (100 + inflT) / 200 }]}
            />
            <GaugeLegend
              zones={[
                { kind: 'up', label: 'Deflationary', range: `≤ ${Math.round(deflT)} bp` },
                { kind: 'warn', label: 'Neutral', range: `${Math.round(deflT)} / +${Math.round(inflT)}` },
                { kind: 'down', label: 'Inflationary', range: `≥ +${Math.round(inflT)} bp` },
              ]}
            />
          </div>
        </div>

        {/* 24-week regime strip */}
        <div className="mer-strip-wrap">
          <div className="mt-eyebrow">Regime history · 24 weeks — when the engine moved</div>
          <div className="mer-strip">
            {tail24.length > 0
              ? tail24.map((w, i) => {
                  const sk = stressKind(w.stress_state);
                  const yk = yieldKind(w.yield_regime);
                  return (
                    <div
                      key={i}
                      className="mer-cell"
                      style={{
                        background: `color-mix(in oklab, ${KIND_COLOR[sk]} 30%, var(--mt-surface-3))`,
                        borderBottomColor: KIND_COLOR[yk],
                      }}
                      onMouseEnter={(e) => tip(e, `Week of ${w.date || '—'}: ${w.stress_state || '—'} · ${w.yield_regime || '—'}`)}
                      onMouseLeave={onHideTip}
                    />
                  );
                })
              : Array.from({ length: 24 }).map((_, i) => (
                  <div key={i} className="mer-cell" style={{ background: 'var(--mt-surface-3)' }} />
                ))}
          </div>
          <div className="mer-legend">
            <span><span className="mer-dot" style={{ background: 'var(--mt-up)' }} /> Risk On</span>
            <span><span className="mer-dot" style={{ background: 'var(--mt-warn)' }} /> Watch</span>
            <span><span className="mer-dot" style={{ background: 'var(--mt-down)' }} /> Risk Off</span>
            <span style={{ opacity: 0.6 }}>fill = stress · underline = yield regime</span>
          </div>
        </div>
      </div>
    </section>
  );
}
