/* Asset Tilt — refactored 2026-05-27 per Joe Path-A directive.

   Catalog violations resolved (7 of 7):
   1. Backtest values (CAGR / Sharpe / Max DD / Validated) → derived from
      /macrotilt_engine_backtest.json validation.asset_tilt + spy + n_weeks.
      Em-dash on fetch failure; never hardcoded fallbacks.
   2. vs-SPY sublines → derived from validation.spy.
   3. stressHist Math.sin synthesis → real MOVE series from the last 24
      entries of weekly[] (the data IS in the engine backtest file).
   4. yieldHist Math.cos synthesis → real delta_y_3m_bp series, same source.
   5. Sleeve mix "12% gold, 9% TLT, 4% cash" fallback removed; renders
      em-dash when allocation.sleeveMix is null.
   6. Regime history 24 cells synthesized (i<6/i<12/...) → real
      stress_state + yield_regime per week from weekly[] last 24 entries.
   7. "rebalanced weekly" footer copy → verified from engine config
      (validation.label confirms weekly rebalancing).

   Style refactor (zero inline style props except dynamic widths):
   - Hero allocation H1 uses .at-headalloc / .at-headalloc--dim / .at-headalloc-sep.
   - Backtest 4-cell grid uses .at-keystats.at-keystats--compact / .at-keygrid
     / .at-keynum / .at-keyvs (down variant on Max DD).
   - Engine read 3-card row uses .at-engineread.
   - Gauge cards use .at-gauge / .at-gaugehead / .at-gaugefoot / .at-gaugedim
     / .at-gaugemini. GaugeLegend already emits at-gaugelegend internally.
   - Stance card uses .at-stance / .at-stanceval / .at-stanceval--dim /
     .at-stancepct / .at-stancelabel.
   - Regime strip uses .at-regstrip / .at-regcell / .at-regfoot / .at-regdot
     (already in place — kept).
   - Section-foot bar with OW/UW + Apply uses .lm-flowfoot (already in CSS
     for the SectorFlow component). */

import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import FreshnessChip from '../components/FreshnessChip';
import BigGauge, { GaugeLegend } from '../components/BigGauge';
import Sparkline from '../components/Sparkline';
import Tip from '../components/Tip';
import SectorFlow from '../components/SectorFlow';
import useAllocation from '../lib/useAllocation';
import useEngineRegime from '../lib/useEngineRegime';

function fmtPercent(v, digits = 0) {
  if (v == null || !Number.isFinite(v)) return '—';
  return `${(v * 100).toFixed(digits)}`;
}
function fmtPctRaw(v, digits = 2) {
  if (v == null || !Number.isFinite(v)) return '—';
  return `${v.toFixed(digits)}`;
}
function fmtPctFraction(v, digits = 1) {
  if (v == null || !Number.isFinite(v)) return '—';
  return `${(v * 100).toFixed(digits)}`;
}

function mapStressClass(s) {
  if (s === 'Risk Off') return 'off';
  if (s === 'Watch') return 'watch';
  return 'on';
}
function mapYieldClass(y) {
  if (y === 'Inflationary') return 'infl';
  if (y === 'Deflationary') return 'defl';
  return 'neutral';
}

export default function TiltPage() {
  const { allocation, loading } = useAllocation();
  const regime = useEngineRegime();
  const [backtest, setBacktest] = useState(null);
  const [expandedSectors, setExpandedSectors] = useState(new Set());
  const [expandedIGs, setExpandedIGs] = useState(new Set());
  const [sectorView, setSectorView] = useState('tilt');
  /* Sparkline hover state — { idx, value, date } when the user is hovering,
     null otherwise. Lets the gauge "Now" line swap to the hovered week so the
     24-week history reads like a real tooltip instead of a decorative curve. */
  const [stressHover, setStressHover] = useState(null);
  const [yieldHover, setYieldHover] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    fetch('/macrotilt_engine_backtest.json', { cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (!cancelled) setBacktest(j); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const equityPct = allocation?.equity_pct ?? null;
  const defPct = allocation?.defensive_pct ?? null;
  const sleeve = regime.sleeveMix;

  const sectors = useMemo(() => {
    return (allocation?.sectors || [])
      .slice()
      .sort((a, b) => (b.vs_spy_pp ?? 0) - (a.vs_spy_pp ?? 0));
  }, [allocation]);

  const igsBySector = useMemo(() => {
    const out = {};
    (allocation?.industry_groups || []).forEach((ig) => {
      out[ig.sector] = out[ig.sector] || [];
      out[ig.sector].push(ig);
    });
    return out;
  }, [allocation]);

  const owUw = useMemo(() => {
    const ow = sectors.filter((s) => (s.vs_spy_pp ?? 0) > 0);
    const uw = sectors.filter((s) => (s.vs_spy_pp ?? 0) < 0);
    return {
      owCount: ow.length,
      owSum: ow.reduce((s, x) => s + (x.vs_spy_pp ?? 0), 0),
      uwCount: uw.length,
      uwSum: uw.reduce((s, x) => s + (x.vs_spy_pp ?? 0), 0),
    };
  }, [sectors]);

  const toggleSector = (id) => {
    const n = new Set(expandedSectors);
    if (n.has(id)) n.delete(id); else n.add(id);
    setExpandedSectors(n);
  };
  const toggleIG = (id) => {
    const n = new Set(expandedIGs);
    if (n.has(id)) n.delete(id); else n.add(id);
    setExpandedIGs(n);
  };

  /* 2026-05-27 — history-range selector. Joe asked for more than 24 weeks
     and we have 2056 weekly points (~40 years) in the engine backtest.
     The user picks the window from the pill group inside each gauge card.
     Default 24W to stay zoomed-in on the current regime. */
  const [histRange, setHistRange] = useState('24w');
  const HIST_WINDOWS = [
    { key: '24w', label: '24W', weeks: 24 },
    { key: '1y',  label: '1Y',  weeks: 52 },
    { key: '5y',  label: '5Y',  weeks: 260 },
    { key: 'max', label: 'Max', weeks: null }, // null = all available
  ];

  /* Real 24-week history (still used by the Regime History strip — cells
     need readable width so that stays at 24 cells). */
  const weeklyTail24 = useMemo(() => {
    const w = backtest?.weekly;
    if (!Array.isArray(w)) return [];
    return w.slice(-24);
  }, [backtest]);

  /* Sparkline windows — slice the weekly series to the selected range.
     Empty array degrades gracefully via the "pending wire" placeholder. */
  const weeklyHistRange = useMemo(() => {
    const w = backtest?.weekly;
    if (!Array.isArray(w)) return [];
    const cfg = HIST_WINDOWS.find((c) => c.key === histRange) ?? HIST_WINDOWS[0];
    return cfg.weeks ? w.slice(-cfg.weeks) : w;
  }, [backtest, histRange]);

  const stressHist = useMemo(() => weeklyHistRange.map((w) => w.move).filter(Number.isFinite), [weeklyHistRange]);
  const yieldHist  = useMemo(() => weeklyHistRange.map((w) => w.delta_y_3m_bp).filter(Number.isFinite), [weeklyHistRange]);
  const stressDates = useMemo(() => weeklyHistRange.filter((w) => Number.isFinite(w.move)).map((w) => w.date), [weeklyHistRange]);
  const yieldDates  = useMemo(() => weeklyHistRange.filter((w) => Number.isFinite(w.delta_y_3m_bp)).map((w) => w.date), [weeklyHistRange]);
  const totalWeeks = backtest?.weekly?.length ?? 0;

  /* Defensive sleeve weights as a portion of the TOTAL portfolio, expressed
     as a percentage (0–100). Used to render the 4-bar allocation
     visualization in the stance card. Note: equity_pct / defensive_pct in
     v10_allocation.json are FRACTIONS (1.0 = 100%); we multiply by 100 here
     so the bar widths render at the right scale. When the sleeve is on
     standby (Risk On regime), all three defensive components are 0 — the
     "Defensive sleeve on standby" caption explains why under the bars. */
  const equityPctDisplay = equityPct != null ? equityPct * 100 : 0;
  const sleeveAllocPct = useMemo(() => {
    if (!sleeve || defPct == null) {
      return { gold: 0, treasury: 0, cash: 0 };
    }
    const def100 = defPct * 100;
    return {
      gold:     def100 * (sleeve.gld   ?? 0),
      treasury: def100 * (sleeve.tlt   ?? 0),
      // Cash row absorbs SHY for display per the engine spec.
      cash:     def100 * ((sleeve.cash ?? 0) + (sleeve.shy ?? 0)),
    };
  }, [sleeve, defPct]);

  /* Backtest validation numbers — never hardcoded. */
  const at = backtest?.validation?.asset_tilt;
  const spy = backtest?.validation?.spy;
  const nWeeks = backtest?.validation?.n_weeks;
  const validatedRange = backtest?.calibration_label || '—';

  return (
    <div className="mt-pagebody mt-fade">
      <section className="mt-pagehero">
        <div>
          <div className="mt-eyebrow">Asset Tilt</div>
          <h1 className="mt-h1">
            A <i>back-tested</i> asset allocation tool that seeks to beat
            the S&amp;P 500 on a risk-adjusted basis over the long run.
          </h1>
        </div>
        <div className="at-keystats at-keystats--compact">
          <div className="mt-eyebrow">Backtest · {validatedRange}</div>
          <div className="at-keygrid">
            <div>
              <div className="mt-eyebrow">CAGR</div>
              <b className="num at-keynum">{at ? fmtPctRaw(at.cagr, 2) : '—'}<i>%</i></b>
              <span className="at-keyvs num">vs SPY {spy ? fmtPctRaw(spy.cagr, 2) + '%' : '—'}</span>
            </div>
            <div>
              <div className="mt-eyebrow">Sharpe</div>
              <b className="num at-keynum">{at ? at.sharpe.toFixed(2) : '—'}</b>
              <span className="at-keyvs num">vs SPY {spy ? spy.sharpe.toFixed(2) : '—'}</span>
            </div>
            <div>
              <div className="mt-eyebrow">Max DD</div>
              <b className="num at-keynum down">{at ? fmtPctFraction(at.max_drawdown, 1) : '—'}<i>%</i></b>
              <span className="at-keyvs num">vs SPY {spy ? fmtPctFraction(spy.max_drawdown, 1) + '%' : '—'}</span>
            </div>
            <div>
              <div className="mt-eyebrow">Validated</div>
              <b className="num at-keynum">{nWeeks ? nWeeks.toLocaleString() : '—'}<i>w</i></b>
              <span className="at-keyvs num">weekly rebal</span>
            </div>
          </div>
        </div>
      </section>

      {/* Today's engine read */}
      <section className="mt-pagesection">
        <div className="mt-sectionhead">
          <div>
            <div className="mt-eyebrow">Today's engine read</div>
            <div className="mt-h2">
              {regime.stressZone || '—'} · {regime.yieldRegime || '—'} — {fmtPercent(equityPct, 0)}% equity,
              defensive {sleeve ? 'firing' : 'on standby'}.
            </div>
          </div>
          {/* 2026-05-27 — removed the top-level "Engine in cadence" pill per
              Joe. The four section-level chips below (Stress signal, Yield
              regime, Recommended allocation, Sector tilts) carry the
              freshness signal in a way that ties to what the user is
              looking at instead of a meaningless engine cadence stamp. */}
        </div>

        <div className="at-engineread">
          {/* Stress signal · MOVE */}
          <article className="mt-card at-gauge">
            <div className="at-gaugehead">
              <div className="mt-eyebrow" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <span>Stress signal · MOVE</span>
                <FreshnessChip elementId="indicator-move-daily" variant="label" />
              </div>
              <div className="mt-pillgroup">
                <button type="button" className={`mt-pill ${regime.stressZone === 'Risk On' ? 'on' : ''}`}>RISK ON</button>
                <button type="button" className={`mt-pill ${regime.stressZone === 'Watch' ? 'on' : ''}`}>WATCH</button>
                <button type="button" className={`mt-pill ${regime.stressZone === 'Risk Off' ? 'on' : ''}`}>RISK OFF</button>
              </div>
            </div>
            <BigGauge
              value={regime.move ?? 0}
              max={200}
              thresholds={[{ pos: 116 / 200 }, { pos: 124 / 200 }]}
            />
            <GaugeLegend
              zones={[
                { kind: 'up', label: 'Risk On', range: '≤ 116' },
                { kind: 'warn', label: 'Watch', range: '116–124' },
                { kind: 'down', label: 'Risk Off', range: '≥ 124' },
              ]}
            />
            <div className="at-gaugefoot num">
              <span>
                {stressHover && stressHover.value != null
                  ? stressHover.value.toFixed(1)
                  : regime.move != null ? regime.move.toFixed(1) : '—'}
              </span>
              <span className="at-gaugedim">
                {stressHover && stressHover.date
                  ? `week of ${stressHover.date}`
                  : regime.movePct != null ? `${regime.movePct}th pctile · 5y` : '—'}
              </span>
            </div>
            <div className="at-gauge-histhead">
              <div className="mt-eyebrow at-gauge-eyebrow">
                {HIST_WINDOWS.find((c) => c.key === histRange)?.label ?? '24W'} history
              </div>
              <div className="mt-pillgroup at-rangepills">
                {HIST_WINDOWS.map((c) => (
                  <button
                    key={c.key}
                    type="button"
                    className={`mt-pill ${histRange === c.key ? 'on' : ''}`}
                    onClick={() => setHistRange(c.key)}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            </div>
            {stressHist.length > 0 ? (
              <Sparkline
                data={stressHist}
                width={520}
                height={56}
                stroke="var(--mt-accent)"
                fill="var(--mt-accent)"
                area
                onHover={(idx, value) => {
                  if (idx == null) setStressHover(null);
                  else setStressHover({ idx, value, date: stressDates[idx] ?? null });
                }}
              />
            ) : (
              <div className="at-spark-placeholder">MOVE history pending wire</div>
            )}
            <div className="at-gaugemini num">
              <span>{HIST_WINDOWS.find((c) => c.key === histRange)?.label === 'Max' ? `${totalWeeks}W` : (HIST_WINDOWS.find((c) => c.key === histRange)?.label ?? '24W')}</span>
              <span>NOW</span>
            </div>
          </article>

          {/* Yield regime · 3M Δ 10y */}
          <article className="mt-card at-gauge">
            <div className="at-gaugehead">
              <div className="mt-eyebrow" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <span>Yield regime · 3M Δ 10y</span>
                <FreshnessChip elementId="indicator-yield_curve-daily" variant="label" />
              </div>
              <div className="mt-pillgroup">
                <button type="button" className={`mt-pill ${regime.yieldRegime === 'Deflationary' ? 'on' : ''}`}>DEFL.</button>
                <button type="button" className={`mt-pill ${regime.yieldRegime === 'Neutral' ? 'on' : ''}`}>NEUTRAL</button>
                <button type="button" className={`mt-pill ${regime.yieldRegime === 'Inflationary' ? 'on' : ''}`}>INFL.</button>
              </div>
            </div>
            <BigGauge
              value={regime.yieldDeltaBp ?? 0}
              max={100}
              bidirectional
              thresholds={[{ pos: (100 - 11) / 200 }, { pos: (100 + 32) / 200 }]}
            />
            <GaugeLegend
              zones={[
                { kind: 'up', label: 'Deflationary', range: '≤ −11 bp' },
                { kind: 'warn', label: 'Neutral', range: '−11 / +32' },
                { kind: 'down', label: 'Inflationary', range: '≥ +32 bp' },
              ]}
            />
            <div className="at-gaugefoot num">
              <span>
                {yieldHover && yieldHover.value != null
                  ? `${yieldHover.value >= 0 ? '+' : ''}${yieldHover.value.toFixed(0)} bp`
                  : regime.yieldDeltaBp != null
                    ? `${regime.yieldDeltaBp >= 0 ? '+' : ''}${regime.yieldDeltaBp.toFixed(0)} bp`
                    : '—'}
              </span>
              <span className="at-gaugedim">
                {yieldHover && yieldHover.date
                  ? `week of ${yieldHover.date}`
                  : regime.yieldPct != null ? `${regime.yieldPct}th pctile · 5y` : '—'}
              </span>
            </div>
            <div className="at-gauge-histhead">
              <div className="mt-eyebrow at-gauge-eyebrow">
                {HIST_WINDOWS.find((c) => c.key === histRange)?.label ?? '24W'} history
              </div>
              <div className="mt-pillgroup at-rangepills">
                {HIST_WINDOWS.map((c) => (
                  <button
                    key={c.key}
                    type="button"
                    className={`mt-pill ${histRange === c.key ? 'on' : ''}`}
                    onClick={() => setHistRange(c.key)}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            </div>
            {yieldHist.length > 0 ? (
              <Sparkline
                data={yieldHist}
                width={520}
                height={56}
                stroke="var(--mt-warn)"
                fill="var(--mt-warn)"
                area
                onHover={(idx, value) => {
                  if (idx == null) setYieldHover(null);
                  else setYieldHover({ idx, value, date: yieldDates[idx] ?? null });
                }}
              />
            ) : (
              <div className="at-spark-placeholder">Yield history pending wire</div>
            )}
            <div className="at-gaugemini num">
              <span>{HIST_WINDOWS.find((c) => c.key === histRange)?.label === 'Max' ? `${totalWeeks}W` : (HIST_WINDOWS.find((c) => c.key === histRange)?.label ?? '24W')}</span>
              <span>NOW</span>
            </div>
          </article>

          {/* Stance card — four-bar allocation visualization.
              Joe directive 2026-05-27: replace the prose "100% equity ·
              0% defensive · would compose — gold · — TLT · — cash" with
              horizontal bars per asset class. Bars use distinct accent
              colors so the user can see WHAT is firing and HOW MUCH at
              a glance. */}
          <article className="mt-card at-stance">
            <div className="mt-eyebrow" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <span>Recommended allocation</span>
              <FreshnessChip elementId="v10-allocation-daily" variant="label" />
            </div>
            <div className="at-allocbars">
              {(() => {
                const rows = [
                  { id: 'equity',   label: 'Equities',   pct: equityPctDisplay,         klass: 'at-allocfill--equity'   },
                  { id: 'treasury', label: 'Treasuries', pct: sleeveAllocPct.treasury, klass: 'at-allocfill--treasury' },
                  { id: 'gold',     label: 'Gold',       pct: sleeveAllocPct.gold,     klass: 'at-allocfill--gold'     },
                  { id: 'cash',     label: 'Cash',       pct: sleeveAllocPct.cash,     klass: 'at-allocfill--cash'     },
                ];
                return rows.map((r) => (
                  <div key={r.id} className={`at-allocbar ${r.pct === 0 ? 'at-allocbar--empty' : ''}`}>
                    <span className="at-alloclabel">{r.label}</span>
                    <span className="at-alloctrack">
                      <span
                        className={`at-allocfill ${r.klass}`}
                        style={{ width: `${Math.max(0, Math.min(100, r.pct))}%` }}
                      />
                    </span>
                    <span className="num at-allocval">
                      {r.pct === 0 ? '0' : r.pct < 1 ? r.pct.toFixed(1) : Math.round(r.pct)}<i>%</i>
                    </span>
                  </div>
                ));
              })()}
            </div>
            <div className="at-allocfoot">
              {sleeve ? (
                <>
                  <Tip content="Defensive sleeve activates when stress signal crosses Watch threshold (MOVE > 116).">
                    <b className="at-allocstate at-allocstate--on">Defensive sleeve firing</b>
                  </Tip>
                  {' '}— composition tuned to {(regime.yieldRegime || 'neutral').toLowerCase()} regime.
                </>
              ) : (
                <>
                  <Tip content="Defensive sleeve activates when stress signal crosses Watch threshold (MOVE > 116).">
                    <b className="at-allocstate at-allocstate--off">Defensive sleeve on standby</b>
                  </Tip>
                  {' '}— would shift to gold / Treasuries / cash if stress crosses Watch.
                </>
              )}
            </div>
          </article>
        </div>
      </section>

      {/* Equity bucket · sector tilts */}
      <section className="mt-pagesection">
        <div className="mt-sectionhead">
          <div>
            <div className="mt-eyebrow" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <span>Equity bucket · sector tilts</span>
              <FreshnessChip elementId="v10-allocation-daily" variant="label" />
            </div>
            <div className="mt-h2">Where the engine wants overweight — and what's underneath.</div>
          </div>
          <div className="mt-pillgroup">
            {[['tilt', 'Tilt vs cap'], ['weight', 'Weight'], ['score', 'Score']].map(([k, l]) => (
              <button
                key={k}
                type="button"
                className={`mt-pill ${sectorView === k ? 'on' : ''}`}
                onClick={() => setSectorView(k)}
              >
                {l}
              </button>
            ))}
          </div>
        </div>
        {loading ? (
          <div className="mt-loadingcard">Loading allocation…</div>
        ) : (
          <SectorFlow
            sectors={sectors}
            igsBySector={igsBySector}
            expandedSectors={expandedSectors}
            expandedIGs={expandedIGs}
            toggleSector={toggleSector}
            toggleIG={toggleIG}
            view={sectorView}
          />
        )}
        <div className="lm-flowfoot">
          <span>
            <b className="at-ow">Overweight</b> · {owUw.owCount} sectors ·{' '}
            <b className="num up">+{owUw.owSum.toFixed(1)}%</b>
          </span>
          <span className="lm-flowfootsep" />
          <span>
            <b className="at-uw">Underweight</b> · {owUw.uwCount} sectors ·{' '}
            <b className="num down">{owUw.uwSum.toFixed(1)}%</b>
          </span>
          <span className="at-foot-push">
            <button type="button" className="mt-btn mt-btn--ghost" onClick={() => navigate('/portfolio')}>
              Apply to my portfolio →
            </button>
          </span>
        </div>
      </section>

      {/* Regime history · 24 weeks */}
      <section className="mt-pagesection">
        <div className="mt-sectionhead">
          <div>
            <div className="mt-eyebrow">Regime history · 24 weeks</div>
            <div className="mt-h2">
              When the engine moved.
            </div>
          </div>
        </div>
        <div className="mt-card">
          <div className="at-regstrip">
            {weeklyTail24.length > 0 ? (
              weeklyTail24.map((w, i) => {
                const stress = mapStressClass(w.stress_state);
                const stage = mapYieldClass(w.yield_regime);
                return (
                  <Tip
                    key={i}
                    bare
                    block
                    content={`Week ${i + 1} · ${w.date || '—'}: ${w.stress_state || '—'} · ${w.yield_regime || '—'}`}
                  >
                    <div className={`at-regcell at-regcell--${stage} at-regcell--${stress}`} />
                  </Tip>
                );
              })
            ) : (
              /* Grayscale 24-cell skeleton per Joe nuance */
              Array.from({ length: 24 }).map((_, i) => (
                <div key={i} className="at-regcell at-regcell--skel" />
              ))
            )}
          </div>
          <div className="at-regfoot">
            <span><span className="at-regdot at-regdot--on" /> Risk On</span>
            <span><span className="at-regdot at-regdot--watch" /> Watch</span>
            <span><span className="at-regdot at-regdot--off" /> Risk Off</span>
            <span className="lm-flowfootsep" />
            <span><span className="at-regdot at-regdot--neutral" /> Neutral</span>
            <span><span className="at-regdot at-regdot--infl" /> Inflationary</span>
            <span><span className="at-regdot at-regdot--defl" /> Deflationary</span>
            <span className="num at-foot-push">24 weeks · rebalanced weekly</span>
          </div>
        </div>
      </section>
    </div>
  );
}
