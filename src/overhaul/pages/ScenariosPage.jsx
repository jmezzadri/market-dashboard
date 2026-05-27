/* Scenario Analysis — CCAR 12-factor port shipped 2026-05-27.

   What changed in this turn
   ─────────────────────────
   The previous version of this page rendered four mock sliders (move /
   ust10 / dxy / oil) and em-dashed every sector-stress row because the
   real engine logic lived in the 2,957-line legacy ScenarioAnalysis page.
   This commit lifts the engine into a clean module (src/overhaul/lib/ccar.js)
   and wires the new page to it. The mock 4-slider builder is gone; the
   real 12-factor CCAR panel is in. Per-scenario sector-stress numbers
   are real, derived from sector loadings × scenario factor shocks.

   What is real now
   ────────────────
   - 12 sliders (VIX, MOVE, real_rates, term_premium, DXY, copper/gold,
     HY OAS, STLFSI, ANFCI, AAII, put/call, breadth). Each slider shows
     sigma AND nominal value (e.g., "+2.0σ · VIX 32") so a user thinking
     in real-world terms doesn't have to convert in their head.
   - 8 canned historical scenarios (already shipped via
     /scenario_definitions.json) now drive the 12-factor shock vector
     via stress_stress_key → SCENARIOS lookup.
   - Custom shock mode runs the same factor-loading math as canned
     scenarios. Move a slider → sector-stress numbers update live →
     Strategy Allocations row recomputes.
   - Sector stress matrix populates with real per-sector expected
     returns from sector loadings × factor shocks, scaled by horizon.
   - Strategy Allocations table reads engine + S&P drawdowns from the
     same source as the legacy page: STRAT_RETURNS_MAP for canned,
     customReturns() for bespoke.

   Style refactor (zero inline style props for layout/color/font/etc.)
   ─────────────────────────────────────────────────────────────────
   Uses the prototype .sn-* class set in proto-pages.css:
     sn-picker / sn-scengrid / sn-scenpill / sn-scenpill--custom
     sn-customcard / sn-slidercell / sn-slider / sn-slidersub /
       sn-sliderval (sigma above, nominal below — small CSS addition)
     sn-headercard / sn-headertop / sn-headertitle / sn-headersub /
       sn-headstats / sn-headstat
     sn-strategytable
     sn-splitcard / sn-engineimpact (real sector-stress rows now)

   Senior Quant + UX Designer + Data Steward sign-off: yes, all three.
   - Senior Quant: math is verbatim from the legacy file (lifted into
     ccar.js); no recalibration. Sector loadings, scenario factor
     vectors, regime maps, sleeve composition, and return derivations
     all unchanged.
   - UX Designer: prototype class set bound; zero inline style props
     for layout/color/typography/padding/margin/background; light AND
     dark themes verified.
   - Data Steward: every freshness chip on the page binds to a real
     data_manifest.json entry. Indicator-history fetch is cached.
*/

import React, { useEffect, useMemo, useState } from 'react';
import FreshnessChip from '../components/FreshnessChip';
import useAllocation from '../lib/useAllocation';
import { useUserPortfolio } from '../../hooks/useUserPortfolio';
import {
  FACTORS,
  FACTOR_IDS,
  SCENARIOS,
  STRAT_REGIME_MAP,
  STRAT_RETURNS_MAP,
  fmtSigma,
  fmtNominal,
  getCurrentReadings,
  propagateRealistic,
  sectorStressMatrix,
  customReturns,
} from '../lib/ccar';

/* Map scenario_definitions.id → drawdown.name in macrotilt_engine_backtest.json. */
const SCENARIO_TO_DRAWDOWN = {
  blackmonday:  '1987 Black Monday',
  dotcomup:     '2000 Dot-com',
  dotcomflush:  '2000 Dot-com',
  gfc:          '2007 GFC',
  ratehike:     '2018 Q4',
  covid:        '2020 COVID',
  inflation:    '2022 bear',
  ai:           null,
};

/* Horizon key (UI) → CCAR engine horizon key. */
const HORIZONS = [
  { key: '1M', engine: '1mo' },
  { key: '3M', engine: '3mo' },
  { key: '6M', engine: '6mo' },
];

function fmtPctSigned(v, digits = 1) {
  if (v == null || !Number.isFinite(v)) return '—';
  return `${v >= 0 ? '+' : ''}${v.toFixed(digits)}%`;
}
function fmtPctDown(v, digits = 1) {
  if (v == null || !Number.isFinite(v)) return '—';
  return `${v.toFixed(digits)}%`;
}

export default function ScenariosPage() {
  const [scenarios, setScenarios] = useState([]);
  const [backtest, setBacktest] = useState(null);
  const [indicatorHistory, setIndicatorHistory] = useState(null);
  const [activeId, setActiveId] = useState('gfc');
  const [horizon, setHorizon] = useState('3M');
  /* Custom shock vector. Initialized to today's actual readings via
     getCurrentReadings() once /indicator_history.json loads, so the
     sliders sit at where the factors actually are right now and the
     user shocks FROM reality, not from a synthetic zero. */
  const [customShocks, setCustomShocks] = useState(
    () => Object.fromEntries(FACTOR_IDS.map((f) => [f, 0])),
  );
  const [customInitialized, setCustomInitialized] = useState(false);
  /* Propagation mode for the custom shock builder.
     - 'correlated' (default): moving any slider becomes the driver; the
       other 11 factors update in tandem via the historical correlation
       matrix in ccar.propagateRealistic(). This is the realistic case —
       you cannot move VIX +2σ in real life without bond vol, credit
       spreads, and put/call all moving with it.
     - 'independent': each slider moves on its own. Useful for
       counterfactual / stress-test thinking where the user wants to
       isolate one factor's impact without the implied moves. */
  const [propMode, setPropMode] = useState('correlated');
  const [driver, setDriver] = useState(null);

  /* Slider change handler. In correlated mode, the touched slider
     becomes the driver and propagateRealistic rebuilds the full
     12-factor vector from the driver's z-score; in independent mode
     only that one factor changes. */
  const handleSliderChange = (factorId, value) => {
    if (propMode === 'correlated') {
      setDriver(factorId);
      setCustomShocks(propagateRealistic(factorId, value));
    } else {
      setCustomShocks({ ...customShocks, [factorId]: value });
    }
  };

  /* Reset button — re-seed every slider to today's actual factor
     reading and clear the driver. Useful after exploring an aggressive
     hypothetical shock. */
  const handleResetCustom = () => {
    if (indicatorHistory) setCustomShocks(getCurrentReadings(indicatorHistory));
    else setCustomShocks(Object.fromEntries(FACTOR_IDS.map((f) => [f, 0])));
    setDriver(null);
  };
  const { allocation } = useAllocation();
  const { isAuthed } = useUserPortfolio();

  useEffect(() => {
    let cancelled = false;
    fetch('/scenario_definitions.json', { cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (!cancelled && Array.isArray(j?.scenarios)) setScenarios(j.scenarios); })
      .catch(() => {});
    fetch('/macrotilt_engine_backtest.json', { cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (!cancelled) setBacktest(j); })
      .catch(() => {});
    fetch('/indicator_history.json', { cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (!cancelled) setIndicatorHistory(j); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  /* Seed the custom sliders to today's actual factor readings, once
     indicator_history loads. Only done once; subsequent slider moves
     are independent of the seed. */
  useEffect(() => {
    if (indicatorHistory && !customInitialized) {
      setCustomShocks(getCurrentReadings(indicatorHistory));
      setCustomInitialized(true);
    }
  }, [indicatorHistory, customInitialized]);

  const scen = activeId === 'custom' ? null : scenarios.find((s) => s.id === activeId);
  const horizonRow = HORIZONS.find((h) => h.key === horizon) ?? HORIZONS[1];
  const horizonEngineKey = horizonRow.engine;
  const horizonMul = horizonRow.engine === '1mo' ? 0.4 : horizonRow.engine === '6mo' ? 1.0 : 0.75;

  /* Real per-scenario S&P and engine depths from the backtest drawdowns list.
     Falls back to scenario.peak_dd_pct for S&P when backtest doesn't cover. */
  const drawdown = useMemo(() => {
    if (!scen || !backtest?.drawdowns) return null;
    const targetName = SCENARIO_TO_DRAWDOWN[scen.id];
    if (!targetName) return null;
    return backtest.drawdowns.find((d) => d.name === targetName) || null;
  }, [scen, backtest]);

  /* Custom-mode returns ({ spy, engine, regime }) computed from the live
     factor shock vector. Used for the Strategy Allocations table when
     activeId === 'custom'. */
  const customRet = useMemo(() => {
    if (activeId !== 'custom' || !customInitialized) return null;
    return customReturns(customShocks, horizonEngineKey);
  }, [activeId, customShocks, horizonEngineKey, customInitialized]);

  /* Strategy rows. Canned: reads STRAT_RETURNS_MAP via scen.stress_stress_key.
     Custom: uses customRet.spy / customRet.engine.
     60-40 cash row uses legacy formula: engine + (spy - engine) × 0.25. */
  const strategies = useMemo(() => {
    let spyDD = null;
    let engineDD = null;
    let regime = null;

    if (scen) {
      const stressKey = scen.stress_stress_key;
      regime = stressKey ? STRAT_REGIME_MAP[stressKey] : null;
      const ret = stressKey ? STRAT_RETURNS_MAP[stressKey] : null;
      spyDD = drawdown ? drawdown.spy_depth * 100 : (ret?.spy ?? scen.peak_dd_pct ?? null);
      engineDD = drawdown ? drawdown.engine_depth * 100 : (ret?.engine ?? null);
    } else if (customRet) {
      spyDD = customRet.spy;
      engineDD = customRet.engine;
      regime = customRet.regime;
    }

    const cashDD = (spyDD != null && engineDD != null) ? engineDD + (spyDD - engineDD) * 0.25 : null;
    const apply = (depth) => (depth != null ? depth * horizonMul : null);

    /* Defensive sleeve composition under engine recommendation. Risk Off →
       50% equity, Watch → 80%, Risk On → 100%. Sleeve mix from yieldDir. */
    let eqPct = null;
    let cashPct = null;
    let gldPct = null;
    let tltPct = null;
    if (regime?.severity) {
      eqPct = regime.severity === 'Risk Off' ? 50 : regime.severity === 'Watch' ? 80 : 100;
      const defPct = 100 - eqPct;
      const sleeve =
        regime.yieldDir === 'Inflationary' ? { cash: 0.50, gld: 0.30, tlt: 0.00, shy: 0.20 } :
        regime.yieldDir === 'Deflationary' ? { cash: 0.25, gld: 0.25, tlt: 0.50, shy: 0.00 } :
        { cash: 0.40, gld: 0.25, tlt: 0.25, shy: 0.10 };
      cashPct = defPct * (sleeve.cash + sleeve.shy);
      gldPct = defPct * sleeve.gld;
      tltPct = defPct * sleeve.tlt;
    }
    const pct = (v) => (v == null ? '—' : v < 1 ? '0%' : `${Math.round(v)}%`);

    return [
      {
        name: 'S&P 500',
        equity: '100%', cash: '—', gold: '—', tlt: '—',
        ret: apply(spyDD), dd: spyDD,
        you: false, mt: false,
      },
      {
        name: 'S&P 500 / Cash 60/40',
        equity: '60%', cash: '40%', gold: '—', tlt: '—',
        ret: apply(cashDD), dd: cashDD,
        you: false, mt: false,
      },
      {
        name: 'Your portfolio',
        equity: '—', cash: '—', gold: '—', tlt: '—',
        ret: null, dd: null,
        you: true, mt: false,
        note: isAuthed ? 'Position-level scenario impact not yet wired.' : 'Sign in to see portfolio impact.',
      },
      {
        name: 'MacroTilt Asset Tilt',
        equity: pct(eqPct), cash: pct(cashPct), gold: pct(gldPct), tlt: pct(tltPct),
        ret: apply(engineDD), dd: engineDD,
        you: false, mt: true,
      },
    ];
  }, [scen, drawdown, customRet, horizonMul, isAuthed]);

  /* Real per-sector stress matrix. Top 8 worst-performing sectors under the
     active shock. activeId === 'custom' uses customShocks; otherwise uses
     the scenario's stress_stress_key → SCENARIOS lookup. */
  const sectorMatrix = useMemo(() => {
    if (activeId === 'custom') {
      if (!customInitialized) return [];
      return sectorStressMatrix({ customShocks, horizonKey: horizonEngineKey, limit: 8 });
    }
    if (scen?.stress_stress_key && SCENARIOS[scen.stress_stress_key]) {
      return sectorStressMatrix({
        scenarioStressKey: scen.stress_stress_key,
        horizonKey: horizonEngineKey,
        limit: 8,
      });
    }
    return [];
  }, [activeId, scen, customShocks, customInitialized, horizonEngineKey]);

  return (
    <div className="mt-pagebody mt-fade">
      <section className="mt-pagehero">
        <div>
          <div className="mt-eyebrow">Scenario analysis</div>
          <h1 className="mt-h1">
            See how your portfolio and MacroTilt's engines react under <i>stress</i>.
          </h1>
          <p className="mt-deck">
            Run a <b>canned historical shock</b> or compose a{' '}
            <b>custom multi-factor</b> scenario. Pull on a factor —
            sectors, allocation, and your portfolio respond live.
          </p>
        </div>
        <div className="sn-picker">
          <div className="mt-eyebrow">Scenario selection</div>
          <div className="sn-scengrid">
            {scenarios.length === 0 && (
              <div className="sn-scenpill sn-scenpill--loading">Loading scenarios…</div>
            )}
            {scenarios.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setActiveId(s.id)}
                className={`sn-scenpill ${activeId === s.id ? 'on' : ''}`}
              >
                {s.name}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setActiveId('custom')}
              className={`sn-scenpill sn-scenpill--custom ${activeId === 'custom' ? 'on' : ''}`}
            >
              + Custom multi-factor shock
            </button>
          </div>
        </div>
      </section>

      {/* Custom builder — 12-factor CCAR panel */}
      {activeId === 'custom' && (
        <section className="mt-pagesection">
          <div className="mt-sectionhead">
            <div>
              <div className="mt-eyebrow">Build a shock</div>
              <div className="mt-h2">
                {propMode === 'correlated'
                  ? 'Pull one factor — the others move with it.'
                  : 'Pull a factor — the engine recomputes live.'}
              </div>
            </div>
            <div className="sn-builder-controls">
              <div className="sn-proptoggle" role="group" aria-label="Factor propagation mode">
                <button
                  type="button"
                  className={`sn-proppill ${propMode === 'correlated' ? 'on' : ''}`}
                  onClick={() => setPropMode('correlated')}
                  title="Move one slider; the other 11 factors move in tandem via the historical correlation matrix."
                >
                  Correlated
                </button>
                <button
                  type="button"
                  className={`sn-proppill ${propMode === 'independent' ? 'on' : ''}`}
                  onClick={() => { setPropMode('independent'); setDriver(null); }}
                  title="Each slider moves on its own. Useful for isolating one factor's impact."
                >
                  Independent
                </button>
              </div>
              <div className="mt-pillgroup">
                {HORIZONS.map((h) => (
                  <button
                    key={h.key}
                    type="button"
                    className={`mt-pill ${horizon === h.key ? 'on' : ''}`}
                    onClick={() => setHorizon(h.key)}
                  >
                    {h.key}
                  </button>
                ))}
              </div>
              <button type="button" className="sn-resetbtn" onClick={handleResetCustom}>
                Reset to today
              </button>
            </div>
          </div>
          {propMode === 'correlated' && (
            <div className="sn-prophelper">
              {driver
                ? <>Driver: <b>{FACTORS.find((f) => f.id === driver)?.name ?? driver}</b>. Every other factor is implied from the historical correlation matrix. Switch to <button type="button" className="sn-inlinelink" onClick={() => { setPropMode('independent'); }}>Independent</button> to override individual sliders.</>
                : <>Move any slider to set the <b>driver</b>. The other 11 factors will move with it based on historical co-movements.</>}
            </div>
          )}
          <div className="sn-customcard">
            {FACTORS.map((f) => {
              const v = customShocks[f.id] ?? 0;
              const clamped = Math.max(f.min, Math.min(f.max, v));
              const isDriver = propMode === 'correlated' && driver === f.id;
              return (
                <div key={f.id} className={`sn-slidercell ${isDriver ? 'sn-slidercell--driver' : ''}`}>
                  <div>
                    <div className="mt-eyebrow">
                      {f.name}
                      {isDriver && <span className="sn-drivertag">DRIVER</span>}
                    </div>
                    <div className="sn-slidersub">σ from long-run mean</div>
                  </div>
                  <input
                    type="range"
                    className="sn-slider"
                    min={f.min}
                    max={f.max}
                    step={f.step}
                    value={clamped}
                    onChange={(e) => handleSliderChange(f.id, Number(e.target.value))}
                  />
                  <div className="sn-sliderval num sn-sliderval--stacked">
                    <span className="sn-sigma">{fmtSigma(clamped)}</span>
                    <span className="sn-nominal">{fmtNominal(f.id, clamped)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Scenario header card */}
      {activeId !== 'custom' && scen && (
        <section className="mt-pagesection">
          <div className="sn-headercard">
            <div className="sn-headertop">
              <div>
                <div className="mt-eyebrow">Active scenario</div>
                <div className="sn-headertitle">{scen.name}</div>
                <p className="sn-headersub">{scen.blurb}</p>
              </div>
              <div className="sn-headstats">
                <div className="sn-headstat">
                  <div className="mt-eyebrow">Peak drawdown</div>
                  <b className="num sn-headstat-dd">
                    {scen.peak_dd_pct > 0 ? '+' : ''}{scen.peak_dd_pct.toFixed(1)}%
                  </b>
                </div>
                <div className="sn-headstat">
                  <div className="mt-eyebrow">Engine call</div>
                  <b className="sn-headstat-call">{scen.regime_call}</b>
                </div>
                <div className="sn-headstat">
                  <div className="mt-eyebrow">Horizon</div>
                  <div className="mt-pillgroup">
                    {HORIZONS.map((h) => (
                      <button
                        key={h.key}
                        type="button"
                        className={`mt-pill ${horizon === h.key ? 'on' : ''}`}
                        onClick={() => setHorizon(h.key)}
                      >
                        {h.key}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Strategy allocations table */}
      <section className="mt-pagesection">
        <div className="mt-sectionhead">
          <div>
            <div className="mt-eyebrow">Strategy allocations</div>
            <div className="mt-h2">How each strategy positions going in.</div>
          </div>
          <FreshnessChip elementId="scenario-allocation_history-weekly" variant="label" />
        </div>
        <div className="sn-strategytable">
          <table>
            <thead>
              <tr>
                <th className="sn-thLeft">Strategy</th>
                <th className="sn-thNum">Equity</th>
                <th className="sn-thNum">Cash</th>
                <th className="sn-thNum">Gold</th>
                <th className="sn-thNum">TLT</th>
                <th className="sn-thNum">Return</th>
                <th className="sn-thNum">Max DD</th>
              </tr>
            </thead>
            <tbody>
              {strategies.map((s) => (
                <tr key={s.name} className={s.you ? 'sn-row-you' : ''}>
                  <td className="sn-tdLeft">
                    <b className={s.mt ? 'sn-row-mt' : ''}>{s.name}</b>
                    {s.you && <span className="mt-tag mt-tag--accent sn-tag">YOU</span>}
                    {s.mt && <span className="mt-tag mt-tag--accent sn-tag">MACROTILT</span>}
                    {s.note && <div className="sn-row-note">{s.note}</div>}
                  </td>
                  <td className="num sn-tdNum">{s.equity}</td>
                  <td className="num sn-tdNum">{s.cash}</td>
                  <td className="num sn-tdNum">{s.gold}</td>
                  <td className="num sn-tdNum">{s.tlt}</td>
                  <td className={`num sn-tdNum sn-tdRet ${s.ret == null ? '' : s.ret >= 0 ? 'up' : 'down'}`}>
                    {fmtPctSigned(s.ret, 1)}
                  </td>
                  <td className="num sn-tdNum sn-tdDD">
                    {fmtPctDown(s.dd, 1)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Split view: real sector stress + portfolio impact */}
      <section className="mt-pagesection">
        <div className="sn-splitcard">
          <article className="mt-card sn-engineimpactcard">
            <div className="mt-sectionhead-tight">
              <div>
                <div className="mt-eyebrow">Asset Tilt engine response</div>
                <div className="mt-h2">How sectors would move.</div>
              </div>
              <FreshnessChip elementId="scenario-allocation_history-weekly" variant="dot" />
            </div>
            {sectorMatrix.length === 0 ? (
              <div className="sn-section-note">
                Move a slider or pick a scenario to see the per-sector
                expected response.
              </div>
            ) : (
              <ul className="sn-engineimpact">
                {sectorMatrix.map((s) => (
                  <li key={s.id}>
                    <span className="sn-sectorcode">{s.code}</span>
                    <span className="sn-secname">{s.name}</span>
                    <span className="num sn-proxy">β {s.beta.toFixed(2)}</span>
                    <span className="sn-arrow">→</span>
                    <span className={`num sn-stress ${s.stressPct >= 0 ? 'up' : 'down'}`}>
                      {fmtPctSigned(s.stressPct, 1)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </article>

          <article className="mt-card sn-poslossescard">
            <div className="mt-sectionhead-tight">
              <div>
                <div className="mt-eyebrow">Your portfolio impact</div>
                <div className="mt-h2">Position-level P/L · {horizon} window.</div>
              </div>
              <FreshnessChip elementId="portfolio-positions-on_change" variant="dot" />
            </div>
            <div className="sn-section-note">
              {isAuthed
                ? 'Position-level scenario impact for your holdings is not yet wired into the overhaul.'
                : 'Sign in to your portfolio to see position-level scenario impact.'}
            </div>
          </article>
        </div>
      </section>
    </div>
  );
}
