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
  /* 2026-05-27 — Joe directive: top of page = today's call, bottom = historical.
     Two expandable tiles below the engine read. Regime History defaults open
     (it's the visual at-a-glance), Backtest Results defaults closed so the
     page stays short by default. */
  const [regimeOpen, setRegimeOpen] = useState(true);
  const [backtestOpen, setBacktestOpen] = useState(false);
  /* Backtest chart timeframe selector. Independent of the 24W gauge selector. */
  const [bkRange, setBkRange] = useState('Max');
  /* Backtest chart hover — for the tooltip on the long-history chart. */
  const [bkHover, setBkHover] = useState(null);
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

  /* Long-history backtest chart — independent timeframe slicer.
     Joe directive 2026-05-27: bottom of Asset Tilt becomes the historical
     view. Show Asset Tilt vs SPY vs SPY/Cash blend (regime_only is the
     SPY-with-de-risk-into-cash line per validation.regime_only.label) from
     1986 → today, with timeframe pills (1M / 6M / 1Y / 5Y / Max). */
  const BK_WINDOWS = [
    { key: '1m',  label: '1M',  weeks: 4 },
    { key: '6m',  label: '6M',  weeks: 26 },
    { key: '1y',  label: '1Y',  weeks: 52 },
    { key: '5y',  label: '5Y',  weeks: 260 },
    { key: 'Max', label: 'Max', weeks: null },
  ];
  const bkSeries = useMemo(() => {
    const w = backtest?.weekly;
    if (!Array.isArray(w)) return [];
    const cfg = BK_WINDOWS.find((c) => c.key === bkRange) ?? BK_WINDOWS[4];
    return cfg.weeks ? w.slice(-cfg.weeks) : w;
  }, [backtest, bkRange]);

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
          <FreshnessChip elementId="v10-allocation-daily" variant="pill" label="Engine in cadence" />
        </div>

        <div className="at-engineread">
          {/* Stress signal · MOVE */}
          <article className="mt-card at-gauge">
            <div className="at-gaugehead">
              <div className="mt-eyebrow">Stress signal · MOVE</div>
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
                {HIST_WINDOWS.find((c) => c.key === histRange)?.label ?? '24W'} history{' '}
                {stressHist.length === 0 && (
                  <FreshnessChip elementId="cycle-mechanism-board-daily" variant="dot" />
                )}
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
              <div className="mt-eyebrow">Yield regime · 3M Δ 10y</div>
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
                {HIST_WINDOWS.find((c) => c.key === histRange)?.label ?? '24W'} history{' '}
                {yieldHist.length === 0 && (
                  <FreshnessChip elementId="cycle-mechanism-board-daily" variant="dot" />
                )}
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
            <div className="mt-eyebrow">Recommended allocation</div>
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
            <div className="mt-eyebrow">Equity bucket · sector tilts</div>
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
          <span className="lm-flowfootsep" />
          <FreshnessChip elementId="v10-allocation-daily" variant="label" />
          <span className="at-foot-push">
            <button type="button" className="mt-btn mt-btn--ghost" onClick={() => navigate('/portfolio')}>
              Apply to my portfolio →
            </button>
          </span>
        </div>
      </section>

      {/* Historical Engine Reading — collapsible tile */}
      <section className="mt-pagesection">
        <button
          type="button"
          className={`at-tilehead ${regimeOpen ? 'is-open' : ''}`}
          onClick={() => setRegimeOpen((v) => !v)}
          aria-expanded={regimeOpen}
        >
          <div>
            <div className="mt-eyebrow">Last 24 weeks</div>
            <div className="mt-h2">
              Historical Engine Reading{' '}
              {weeklyTail24.length === 0 && (
                <FreshnessChip elementId="cycle-mechanism-board-daily" variant="dot" />
              )}
            </div>
          </div>
          <span className="at-tilechev" aria-hidden="true">{regimeOpen ? '▾' : '▸'}</span>
        </button>
        {regimeOpen && (
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
                      <div className="at-regcell-stack">
                        <div className={`at-regband at-regband--stress at-regband--${stress}`} />
                        <div className={`at-regband at-regband--yield at-regband--${stage}`} />
                      </div>
                    </Tip>
                  );
                })
              ) : (
                /* Grayscale 24-cell skeleton per Joe nuance */
                Array.from({ length: 24 }).map((_, i) => (
                  <div key={i} className="at-regcell-stack">
                    <div className="at-regband at-regband--skel" />
                    <div className="at-regband at-regband--skel" />
                  </div>
                ))
              )}
            </div>
            <div className="at-regfoot at-regfoot--split">
              <div className="at-regfootrow">
                <span className="at-regfootlabel">Stress signal (top band)</span>
                <span><span className="at-regdot at-regdot--on" /> Risk On</span>
                <span><span className="at-regdot at-regdot--watch" /> Watch</span>
                <span><span className="at-regdot at-regdot--off" /> Risk Off</span>
              </div>
              <div className="at-regfootrow">
                <span className="at-regfootlabel">Yield regime (bottom band)</span>
                <span><span className="at-regdot at-regdot--defl" /> Deflationary</span>
                <span><span className="at-regdot at-regdot--neutral" /> Neutral</span>
                <span><span className="at-regdot at-regdot--infl" /> Inflationary</span>
                <span className="num at-foot-push">24 weeks · rebalanced weekly</span>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* Backtest Results — collapsible tile, full 1986→today chart + drawdown table */}
      <section className="mt-pagesection">
        <button
          type="button"
          className={`at-tilehead ${backtestOpen ? 'is-open' : ''}`}
          onClick={() => setBacktestOpen((v) => !v)}
          aria-expanded={backtestOpen}
        >
          <div>
            <div className="mt-eyebrow">{validatedRange}</div>
            <div className="mt-h2">
              Backtest Results{' '}
              {!backtest && (
                <FreshnessChip elementId="cycle-mechanism-board-daily" variant="dot" />
              )}
            </div>
            <div className="at-tilesummary num">
              {at && spy ? (
                <>
                  Asset Tilt {fmtPctRaw(at.cagr, 1)}% annualized vs SPY {fmtPctRaw(spy.cagr, 1)}% ·
                  Sharpe {at.sharpe.toFixed(2)} vs {spy.sharpe.toFixed(2)} ·
                  Max drawdown {fmtPctFraction(at.max_drawdown, 0)}% vs {fmtPctFraction(spy.max_drawdown, 0)}%
                </>
              ) : '—'}
            </div>
          </div>
          <span className="at-tilechev" aria-hidden="true">{backtestOpen ? '▾' : '▸'}</span>
        </button>
        {backtestOpen && (
          <div className="mt-card">
            <div className="at-bkhead">
              <div>
                <div className="mt-eyebrow">Cumulative growth of $1</div>
                <div className="at-bklegend num">
                  <span className="at-bklegitem"><i className="at-bkdot at-bkdot--at" />Asset Tilt</span>
                  <span className="at-bklegitem"><i className="at-bkdot at-bkdot--spy" />S&amp;P 500</span>
                  <span className="at-bklegitem"><i className="at-bkdot at-bkdot--blend" />S&amp;P 500 / Cash blend</span>
                </div>
              </div>
              <div className="mt-pillgroup">
                {BK_WINDOWS.map((c) => (
                  <button
                    key={c.key}
                    type="button"
                    className={`mt-pill ${bkRange === c.key ? 'on' : ''}`}
                    onClick={() => setBkRange(c.key)}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            </div>
            {bkSeries.length > 1 ? (
              <BacktestChart series={bkSeries} hover={bkHover} setHover={setBkHover} />
            ) : (
              <div className="at-spark-placeholder">Backtest series loading…</div>
            )}
            <div className="at-bkdrawhead">
              <div className="mt-eyebrow">Drawdown comparison · major peak-to-trough episodes</div>
            </div>
            <div className="at-bkdrawtable num">
              <div className="at-bkdrawrow at-bkdrawrow--head">
                <span>Episode</span>
                <span className="at-bkdrawnum">SPY depth</span>
                <span className="at-bkdrawnum">Engine depth</span>
                <span className="at-bkdrawnum">Engine − SPY</span>
                <span>Dominant yield regime</span>
              </div>
              {(backtest?.drawdowns || []).map((d) => (
                <div key={d.name} className="at-bkdrawrow">
                  <span className="at-bkdrawname">{d.name}</span>
                  <span className="at-bkdrawnum down">{fmtPctFraction(d.spy_depth, 1)}%</span>
                  <span className="at-bkdrawnum down">{fmtPctFraction(d.engine_depth, 1)}%</span>
                  <span className={`at-bkdrawnum ${d.diff_pp > 0 ? 'up' : d.diff_pp < 0 ? 'down' : ''}`}>
                    {d.diff_pp > 0 ? '+' : ''}{d.diff_pp.toFixed(1)} pp
                  </span>
                  <span className="at-bkdrawregime">{d.yield_regime_dominant}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * BacktestChart                                                      *
 *                                                                    *
 * Inline SVG line chart for the long-history backtest. Three lines:  *
 *   - Asset Tilt cumulative (orange / accent)                         *
 *   - SPY cumulative (slate)                                          *
 *   - SPY/Cash blend a.k.a. regime_only (warn/amber)                  *
 *                                                                    *
 * Behind the lines, paint vertical bands keyed off stress_state +    *
 * yield_regime so the user can see WHICH regime each rally or         *
 * drawdown happened in. Bands are low-opacity so the lines stay       *
 * readable.                                                           *
 *                                                                    *
 * Joe directive 2026-05-27: this is the historical view.              *
 * ------------------------------------------------------------------ */
function BacktestChart({ series, hover, setHover }) {
  const W = 980;
  const H = 420;
  const PAD = { l: 110, r: 16, t: 16, b: 92 };
  const innerW = W - PAD.l - PAD.r;
  const innerH = H - PAD.t - PAD.b;
  /* Layout for the labeled rails BELOW the plot area:
       y = PAD.t + innerH           → bottom of plot, where lines/grid end
       y = PAD.t + innerH + 8       → top of year-label row
       y = PAD.t + innerH + 28      → top of stress-signal rail
       y = PAD.t + innerH + 50      → top of yield-regime rail
     The rails are clearly outside the chart so they never overlap the
     lines OR the year labels. */
  const RAIL_H = 14;
  const yearY  = PAD.t + innerH + 22;
  const stressY = PAD.t + innerH + 38;
  const yieldY  = PAD.t + innerH + 60;

  /* Re-base each series so the first visible point starts at 1.0 — that way
     the chart compares performance OVER the selected window, not since 1986
     forever. */
  const at0 = series[0]?.asset_tilt_cumulative || 1;
  const spy0 = series[0]?.spy_cumulative || 1;
  const reg0 = series[0]?.regime_only_cumulative || 1;
  const norm = series.map((w) => ({
    date: w.date,
    at: (w.asset_tilt_cumulative ?? 0) / at0,
    spy: (w.spy_cumulative ?? 0) / spy0,
    reg: (w.regime_only_cumulative ?? 0) / reg0,
    stress: w.stress_state,
    yld: w.yield_regime,
  }));

  const allVals = norm.flatMap((p) => [p.at, p.spy, p.reg]).filter(Number.isFinite);
  const yMin = Math.min(...allVals);
  const yMax = Math.max(...allVals);
  const yPad = (yMax - yMin) * 0.04 || 0.04;
  const y0 = yMin - yPad;
  const y1 = yMax + yPad;

  const xOf = (i) => PAD.l + (i / (norm.length - 1)) * innerW;
  const yOf = (v) => PAD.t + (1 - (v - y0) / (y1 - y0)) * innerH;
  const path = (key) => norm.map((p, i) => `${i ? 'L' : 'M'}${xOf(i).toFixed(1)},${yOf(p[key]).toFixed(1)}`).join(' ');

  /* Regime bands — paint a faint vertical color block behind each contiguous
     run of identical stress + yield state. Run-length compression keeps the
     SVG element count down. */
  const bands = [];
  let runStart = 0;
  for (let i = 1; i <= norm.length; i++) {
    const prev = norm[i - 1];
    const cur = norm[i];
    if (!cur || cur.stress !== prev.stress || cur.yld !== prev.yld) {
      bands.push({
        start: runStart,
        end: i - 1,
        stress: prev.stress,
        yld: prev.yld,
      });
      runStart = i;
    }
  }
  const stressFill = (s) => {
    if (s === 'Risk Off') return 'var(--mt-down)';
    if (s === 'Watch') return 'var(--mt-warn)';
    return 'var(--mt-up)';
  };
  const yieldFill = (y) => {
    if (y === 'Inflationary') return 'var(--mt-warn)';
    if (y === 'Deflationary') return 'var(--mt-accent)';
    return 'var(--mt-line-1)';
  };

  const yTicks = 4;
  const tickVals = Array.from({ length: yTicks + 1 }, (_, i) => y0 + ((y1 - y0) * i) / yTicks);

  /* x-axis: pick a small number of date labels — first, last, and a few
     evenly spaced years in between. Dedupe in case rounding produces
     repeats on short windows (1M/6M). Format depends on window length:
     show MMM-YYYY for windows under ~2 years, just YYYY for longer
     spans so labels never collide. */
  const seenIdx = new Set();
  const labelIdxs = [];
  const labelN = 6;
  for (let i = 0; i < labelN; i++) {
    const idx = Math.round((i / (labelN - 1)) * (norm.length - 1));
    if (!seenIdx.has(idx)) { seenIdx.add(idx); labelIdxs.push(idx); }
  }
  const isShortWindow = norm.length <= 110; // ~2 years
  const formatXLabel = (d) => {
    if (!d) return '';
    if (isShortWindow) {
      const m = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][parseInt(d.slice(5,7),10)-1] || '';
      return `${m} ${d.slice(2,4)}`;
    }
    return d.slice(0, 4);
  };

  function onMove(e) {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const idx = Math.max(0, Math.min(norm.length - 1, Math.round(((px - PAD.l) / innerW) * (norm.length - 1))));
    setHover({ idx, p: norm[idx] });
  }
  function onLeave() { setHover(null); }

  const hi = hover?.p;
  const hx = hover ? xOf(hover.idx) : null;

  return (
    <div className="at-bkchart">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="at-bkchart-svg"
        onMouseMove={onMove}
        onMouseLeave={onLeave}
      >
        {/* y-grid */}
        {tickVals.map((v, i) => (
          <g key={`t${i}`}>
            <line
              x1={PAD.l}
              x2={PAD.l + innerW}
              y1={yOf(v)}
              y2={yOf(v)}
              stroke="var(--mt-line-1)"
              strokeWidth="1"
              opacity="0.35"
            />
            <text
              x={PAD.l - 8}
              y={yOf(v) + 4}
              textAnchor="end"
              className="at-bkchart-tick"
            >
              {v >= 10 ? `${v.toFixed(0)}×` : `${v.toFixed(1)}×`}
            </text>
          </g>
        ))}
        {/* Plot frame — light border so the plot area reads as one box,
            separate from the rails below. */}
        <rect
          x={PAD.l}
          y={PAD.t}
          width={innerW}
          height={innerH}
          fill="none"
          stroke="var(--mt-line-1)"
          strokeWidth="1"
          opacity="0.7"
        />
        {/* Lines */}
        <path d={path('spy')} fill="none" stroke="var(--mt-ink-2)" strokeWidth="1.4" opacity="0.85" />
        <path d={path('reg')} fill="none" stroke="var(--mt-warn)" strokeWidth="1.4" opacity="0.85" />
        <path d={path('at')}  fill="none" stroke="var(--mt-accent)" strokeWidth="1.8" />
        {/* Hover crosshair — extends from top of plot area down through both rails so the user can see what regime applied at any date. */}
        {hx != null && (
          <g pointerEvents="none">
            <line x1={hx} x2={hx} y1={PAD.t} y2={yieldY + RAIL_H} stroke="var(--mt-ink-2)" strokeWidth="1" opacity="0.55" strokeDasharray="3 3" />
            <circle cx={hx} cy={yOf(hi.at)}  r="3.5" fill="var(--mt-accent)" />
            <circle cx={hx} cy={yOf(hi.spy)} r="3"   fill="var(--mt-ink-2)" />
            <circle cx={hx} cy={yOf(hi.reg)} r="3"   fill="var(--mt-warn)" />
          </g>
        )}
        {/* Year axis labels — their own row, between plot and rails. */}
        {labelIdxs.map((i) => (
          <text
            key={`x${i}`}
            x={xOf(i)}
            y={yearY}
            textAnchor="middle"
            className="at-bkchart-tick"
          >
            {formatXLabel(norm[i]?.date)}
          </text>
        ))}
        {/* Stress signal rail — labeled, lives OUTSIDE the plot area. */}
        <text
          x={PAD.l - 8}
          y={stressY + RAIL_H * 0.72}
          textAnchor="end"
          className="at-bkchart-railLabel"
        >
          Stress signal
        </text>
        {bands.map((b, i) => (
          <rect
            key={`s${i}`}
            x={xOf(b.start)}
            y={stressY}
            width={Math.max(0.5, xOf(b.end) - xOf(b.start))}
            height={RAIL_H}
            fill={stressFill(b.stress)}
            opacity="0.85"
          />
        ))}
        {/* Yield regime rail — labeled, lives OUTSIDE the plot area. */}
        <text
          x={PAD.l - 8}
          y={yieldY + RAIL_H * 0.72}
          textAnchor="end"
          className="at-bkchart-railLabel"
        >
          Yield regime
        </text>
        {bands.map((b, i) => (
          <rect
            key={`y${i}`}
            x={xOf(b.start)}
            y={yieldY}
            width={Math.max(0.5, xOf(b.end) - xOf(b.start))}
            height={RAIL_H}
            fill={yieldFill(b.yld)}
            opacity="0.8"
          />
        ))}
      </svg>
      <div className="at-bkchart-readout num">
        {hi ? (
          <>
            <span><b>{hi.date}</b></span>
            <span><i className="at-bkdot at-bkdot--at" />Asset Tilt {hi.at.toFixed(2)}×</span>
            <span><i className="at-bkdot at-bkdot--blend" />Blend {hi.reg.toFixed(2)}×</span>
            <span><i className="at-bkdot at-bkdot--spy" />SPY {hi.spy.toFixed(2)}×</span>
            <span className="at-bkchart-regime">{hi.stress} · {hi.yld}</span>
          </>
        ) : (
          <span className="at-bkchart-hint">Hover the chart to read values · two labeled rails below the year axis show the stress signal and yield regime for each week</span>
        )}
      </div>
    </div>
  );
}
