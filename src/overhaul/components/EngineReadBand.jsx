/* EngineReadBand — "Engine read" headline band for Macro Overview.

   Moved here from the retired Asset Tilt page (Joe 2026-06-22). Surfaces the
   two-axis de-risk engine — the validated muscle of MacroTilt — as the lead
   read on Macro Overview:
     - Stress panel (MOVE) → how much equity to carry.
     - Yield-regime panel (3-month change in the 10-year) → which defensive
       sleeve holds when de-risked.
     - 24-week regime strip → when the engine last moved.

   Each axis is its own separated panel: title + live reading (brand display
   font), the gauge, its zone legend, and a 1-year history sparkline you can
   hover for any week's value. The threshold rules live in an instant tooltip
   on each gauge so the surface stays clean but the detail is one hover away.

   Every value is real — live MOVE / yield from useEngineRegime, thresholds
   from macrotilt_engine.json, the strip from macrotilt_engine_history.json,
   the sparklines from each indicator's own price history. Nothing is
   fabricated; missing data renders an em-dash. */

import React, { useEffect, useState, useMemo } from 'react';
import BigGauge, { GaugeLegend } from './BigGauge';
import FreshnessChip from './FreshnessChip';
import Sparkline from './Sparkline';
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

function fmtDate(d) {
  try {
    return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });
  } catch {
    return String(d || '');
  }
}

// Daily level series [date, value] → clean pairs (drops gaps).
function levelSeries(ind) {
  if (!ind?.points?.length) return [];
  return ind.points.filter((p) => Array.isArray(p) && Number.isFinite(p[1])).map((p) => [p[0], p[1]]);
}
// Rolling 3-month (~63 trading day) change series, in basis points — the same
// metric the yield gauge reads, so the sparkline and the dial agree.
function deltaSeriesBp(ind) {
  if (!ind?.points?.length || ind.points.length < 65) return [];
  const unit = (ind.unit || '').toLowerCase();
  const mult = unit === '%' ? 100 : 1;
  const out = [];
  for (let i = 63; i < ind.points.length; i++) {
    const v = ind.points[i]?.[1];
    const p = ind.points[i - 63]?.[1];
    if (Number.isFinite(v) && Number.isFinite(p)) out.push([ind.points[i][0], (v - p) * mult]);
  }
  return out;
}

// One axis: title + live reading, gauge, legend, 1-year history sparkline.
function DialPanel({
  title, freshnessId, valueMain, unit, pctText, accent,
  caption, gauge, legendZones, history, fmt, tipText, onTip, onHideTip,
}) {
  const [hi, setHi] = useState(null);
  const data = useMemo(() => history.map((p) => p[1]), [history]);
  const hovered = hi != null && history[hi] ? history[hi] : null;
  const latest = history.length ? history[history.length - 1] : null;

  return (
    <div className="mer-panel">
      <div className="mer-ghead">
        <div className="mer-gtitle">
          <span>{title}</span>
          {freshnessId && <FreshnessChip elementId={freshnessId} variant="dot" />}
        </div>
        <div className="mer-ghval">
          <span className="mer-gval" style={{ color: accent }}>
            {valueMain}{unit && <span className="mer-gunit">{unit}</span>}
          </span>
          <span className="mer-gsub">{pctText}</span>
        </div>
      </div>

      <div className="mer-gcap">{caption || ''}</div>

      <div
        className="mer-dialwrap"
        onMouseEnter={(e) => onTip && onTip(e, tipText)}
        onMouseLeave={onHideTip}
      >
        {gauge}
      </div>

      {legendZones && <GaugeLegend zones={legendZones} />}

      {data.length > 1 && (
        <div className="mer-spark">
          <div className="mer-sparkhead">
            <span>1-year history</span>
            <span className="mer-sparkval">
              {hovered
                ? `${fmtDate(hovered[0])} · ${fmt(hovered[1])}`
                : latest ? `latest ${fmt(latest[1])}` : ''}
            </span>
          </div>
          <div style={{ color: accent }}>
            <Sparkline
              data={data}
              width={560}
              height={40}
              stroke={accent}
              fill={accent}
              area
              fluid
              showDot
              onHover={(i) => setHi(i)}
            />
          </div>
        </div>
      )}
    </div>
  );
}

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

  // 1-year (~252 trading day) history for each axis, from its own series.
  const moveHist = useMemo(() => levelSeries(regime.moveInd).slice(-252), [regime.moveInd]);
  const yieldHist = useMemo(() => deltaSeriesBp(regime.yieldInd).slice(-252), [regime.yieldInd]);

  const moveVal = regime.move;
  const yVal = regime.yieldDeltaBp;

  const stressTip =
    `ICE BofA MOVE Index — the volatility priced into U.S. Treasury options (the bond market's fear gauge). `
    + `Reading ${moveVal != null ? moveVal.toFixed(1) : '—'}`
    + `${regime.movePct != null ? `, ${regime.movePct}th percentile over 5 years` : ''}.\n\n`
    + `Engine: below ${Math.round(watchT)} carries full equity; ${Math.round(watchT)}–${Math.round(riskOffT)} is a watch zone; `
    + `${Math.round(riskOffT)}+ de-risks up to half into the defensive sleeve.`;

  const yieldTip =
    `Three-month change in the 10-year real yield, in basis points — the engine's inflation/deflation axis. `
    + `Reading ${yVal != null ? `${yVal >= 0 ? '+' : ''}${yVal.toFixed(0)} bp` : '—'}`
    + `${regime.yieldPct != null ? `, ${regime.yieldPct}th percentile over 5 years` : ''}.\n\n`
    + `Engine (when stress signals Risk Off): ${Math.round(deflT)} bp or lower leans long Treasuries; `
    + `+${Math.round(inflT)} bp or higher leans gold & short T-bills; in between holds a balanced sleeve.`;

  return (
    <section className="mt-pagesection mer-band" style={{ paddingTop: 14 }}>
      <style>{`
        .mer-card{background:var(--mt-surface);border:1px solid var(--mt-line-1);border-radius:var(--mt-r-lg);padding:18px 20px}
        .mer-state{font-family:var(--mt-font-display);font-size:clamp(16px,1.7vw,21px);font-weight:500;color:var(--mt-ink-0);line-height:1.2}
        .mer-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:16px}
        .mer-panel{background:var(--mt-surface-2);border:1px solid var(--mt-line-1);border-radius:12px;padding:14px 16px 12px}
        .mer-ghead{display:flex;align-items:baseline;justify-content:space-between;gap:10px}
        .mer-gtitle{display:flex;align-items:center;gap:8px;font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--mt-ink-3);font-weight:700}
        .mer-ghval{display:flex;flex-direction:column;align-items:flex-end;gap:1px;text-align:right;flex:0 0 auto}
        .mer-gval{font-family:var(--mt-font-display);font-size:32px;font-weight:500;line-height:1;letter-spacing:-.01em}
        .mer-gunit{font-family:var(--mt-font-ui);font-size:14px;font-weight:500;color:var(--mt-ink-2);margin-left:4px;letter-spacing:0}
        .mer-gsub{font-size:11px;color:var(--mt-ink-3)}
        .mer-gcap{min-height:32px;font-size:11.5px;color:var(--mt-ink-2);line-height:1.4;margin:8px 0 4px}
        .mer-dialwrap{cursor:help}
        .mer-spark{margin-top:12px;padding-top:10px;border-top:1px solid var(--mt-line-1)}
        .mer-sparkhead{display:flex;align-items:baseline;justify-content:space-between;gap:8px;font-size:9.5px;letter-spacing:.09em;text-transform:uppercase;color:var(--mt-ink-3);font-weight:700;margin-bottom:5px}
        .mer-sparkval{text-transform:none;letter-spacing:0;font-weight:500;color:var(--mt-ink-1);font-family:var(--mt-font-mono);font-size:11px}
        .mer-strip-wrap{margin-top:18px;padding-top:14px;border-top:1px solid var(--mt-line-1)}
        .mer-strip{display:grid;grid-template-columns:repeat(24,1fr);gap:3px;margin-top:8px}
        .mer-cell{height:26px;border-radius:3px;cursor:default;border-bottom:3px solid transparent}
        .mer-legend{display:flex;flex-wrap:wrap;gap:14px;margin-top:10px;font-size:10.5px;color:var(--mt-ink-3)}
        .mer-legend span{display:inline-flex;align-items:center;gap:5px}
        .mer-dot{width:9px;height:9px;border-radius:50%;display:inline-block}
        @media (max-width:760px){.mer-grid{grid-template-columns:1fr;gap:14px}.mer-strip{grid-template-columns:repeat(12,1fr)}}
      `}</style>

      <div className="mer-card">
        <div className="mer-state">
          {stressState || '—'} · {yieldState || '—'} — {equityPct != null ? `${equityPct}%` : '—'} equity,
          defensive {defensiveOn ? `firing (${sleeveLabel || '—'} sleeve)` : 'on standby'}.
        </div>

        <div className="mer-grid">
          <DialPanel
            title="Stress signal · MOVE Index"
            freshnessId="indicator-move-daily"
            valueMain={moveVal != null ? moveVal.toFixed(1) : '—'}
            pctText={regime.movePct != null ? `${regime.movePct}th pctile · 5y` : '—'}
            accent={regime.stressColor}
            caption=""
            gauge={
              <BigGauge
                value={moveVal ?? 0}
                max={200}
                thresholds={[{ pos: watchT / 200 }, { pos: riskOffT / 200 }]}
              />
            }
            legendZones={[
              { kind: 'up', label: 'Risk On', range: `≤ ${Math.round(watchT)}` },
              { kind: 'warn', label: 'Watch', range: `${Math.round(watchT)}–${Math.round(riskOffT)}` },
              { kind: 'down', label: 'Risk Off', range: `≥ ${Math.round(riskOffT)}` },
            ]}
            history={moveHist}
            fmt={(v) => v.toFixed(1)}
            tipText={stressTip}
            onTip={onTip}
            onHideTip={onHideTip}
          />

          <DialPanel
            title="Yield regime · 3-month change in 10-year"
            freshnessId="indicator-yield_curve-daily"
            valueMain={yVal != null ? `${yVal >= 0 ? '+' : ''}${yVal.toFixed(0)}` : '—'}
            unit="bp"
            pctText={regime.yieldPct != null ? `${regime.yieldPct}th pctile · 5y` : '—'}
            accent={regime.yieldColor}
            caption="When Stress Signal indicates Risk Off, Yield Regime dictates allocation."
            gauge={
              <BigGauge
                value={yVal ?? 0}
                max={100}
                bidirectional
                thresholds={[{ pos: (100 + deflT) / 200 }, { pos: (100 + inflT) / 200 }]}
              />
            }
            legendZones={[
              { kind: 'up', label: 'Deflationary', range: `≤ ${Math.round(deflT)} bp` },
              { kind: 'warn', label: 'Neutral', range: `${Math.round(deflT)} / +${Math.round(inflT)}` },
              { kind: 'down', label: 'Inflationary', range: `≥ +${Math.round(inflT)} bp` },
            ]}
            history={yieldHist}
            fmt={(v) => `${v >= 0 ? '+' : ''}${v.toFixed(0)} bp`}
            tipText={yieldTip}
            onTip={onTip}
            onHideTip={onHideTip}
          />
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
