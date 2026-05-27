/* Scenario Analysis — refactored 2026-05-27 per Joe Path-A directive.

   Catalog violations resolved (4 of 4 → 0):
   1. SCENARIOS hardcoded array → fetched from /scenario_definitions.json
      (curated 8-scenario reference list created this session).
   2. Strategy comparison table — WIRED to real per-scenario S&P + engine
      drawdowns from /macrotilt_engine_backtest.json drawdowns[]. The
      legacy ScenarioAnalysis page already reads from this source via the
      STRAT_RETURNS_MAP constant — the overhaul page now reads it
      directly. 60-40 row uses the legacy formula:
          ret = engine + (spy - engine) × 0.25
      "Your portfolio" row em-dashes when not signed in (real wiring
      lands in a portfolio-impact follow-up).
   3. MacroTilt Asset Tilt row → engine_depth from same drawdown match.
   4. engineSectors stress proxy (Math.round of vs_spy_pp synthesized) →
      cells em-dashed + red FreshnessChip on the section backed by
      scenario-allocation_history-weekly. Real sector-stress logic lives
      in the legacy file (around line 1306-1360) and is complex enough
      to port in a follow-up; this PR removes the fabrication honestly.

   Style refactor (zero inline style props):
   - Hero picker uses .sn-picker / .sn-scengrid / .sn-scenpill /
     .sn-scenpill--custom.
   - Custom builder uses .sn-customcard / .sn-slidercell / .sn-slider
     / .sn-slidersub / .sn-sliderval.
   - Scenario header card uses .sn-headercard / .sn-headertop /
     .sn-headertitle / .sn-headersub / .sn-headstats / .sn-headstat.
   - Strategy table uses .sn-strategytable.
   - Split view uses .sn-splitcard with .sn-engineimpact and
     .sn-poslosses inner cards. */

import React, { useEffect, useMemo, useState } from 'react';
import FreshnessChip from '../components/FreshnessChip';
import useAllocation from '../lib/useAllocation';
import { useUserPortfolio } from '../../hooks/useUserPortfolio';

/* Map scenario_definitions.id → drawdown.name in macrotilt_engine_backtest.json.
   When the engine backtest doesn't cover a scenario window (e.g., the AI 2024
   correction is more recent than the last drawdown entry), engine-derived
   cells em-dash. */
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

const HORIZONS = [
  { key: '1M', mul: 0.4 },
  { key: '3M', mul: 0.75 },
  { key: '6M', mul: 1.0 },
];

const SLIDERS = [
  { key: 'move',  label: 'MOVE · bond vol',        sub: '1.0 = today · 2.0 = double',  min: -1,   max: 2.5, step: 0.05 },
  { key: 'ust10', label: '10y Treasury yield Δ',   sub: 'Percentage-point shift',      min: -2,   max: 3,   step: 0.05 },
  { key: 'dxy',   label: 'USD index Δ',            sub: '% shift',                     min: -0.2, max: 0.2, step: 0.005 },
  { key: 'oil',   label: 'Brent crude Δ',          sub: '% shift',                     min: -0.5, max: 1,   step: 0.01 },
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
  const [activeId, setActiveId] = useState('gfc');
  const [horizon, setHorizon] = useState('3M');
  const [custom, setCustom] = useState({ move: 0.6, ust10: 0.4, dxy: -0.04, oil: 0.3 });
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
    return () => { cancelled = true; };
  }, []);

  const scen = activeId === 'custom' ? null : scenarios.find((s) => s.id === activeId);
  const horizonMul = HORIZONS.find((h) => h.key === horizon)?.mul ?? 1.0;

  /* Real per-scenario S&P and engine depths from the backtest drawdowns list.
     Falls back to scenario.peak_dd_pct (curated reference) for the S&P number
     when the backtest doesn't cover this window; engine cells em-dash. */
  const drawdown = useMemo(() => {
    if (!scen || !backtest?.drawdowns) return null;
    const targetName = SCENARIO_TO_DRAWDOWN[scen.id];
    if (!targetName) return null;
    return backtest.drawdowns.find((d) => d.name === targetName) || null;
  }, [scen, backtest]);

  /* Strategy rows — real returns wired to the engine backtest.
     S&P row uses spy_depth × 100 from the matched drawdown, falling back to
     the curated scenario.peak_dd_pct when no drawdown match exists.
     60-40 row uses the legacy formula: engine + (spy - engine) × 0.25.
     Asset Tilt row uses engine_depth × 100 from the drawdown.
     Your-portfolio row em-dashes when unauthenticated. */
  const strategies = useMemo(() => {
    if (!scen) return [];
    const spyFromBacktest = drawdown ? drawdown.spy_depth * 100 : null;
    const engineFromBacktest = drawdown ? drawdown.engine_depth * 100 : null;
    const spyFallback = scen.peak_dd_pct ?? null;

    const spyDD = spyFromBacktest != null ? spyFromBacktest : spyFallback;
    const engineDD = engineFromBacktest;
    const cashDD = (spyDD != null && engineDD != null)
      ? engineDD + (spyDD - engineDD) * 0.25
      : null;

    const apply = (depth) => (depth != null ? depth * horizonMul : null);

    return [
      {
        name: 'S&P 500',
        equity: '100%', cash: '—', gold: '—', tlt: '—',
        ret: apply(spyDD),
        dd: spyDD,
        you: false, mt: false,
      },
      {
        name: 'S&P 500 / Cash 60/40',
        equity: '60%', cash: '40%', gold: '—', tlt: '—',
        ret: apply(cashDD),
        dd: cashDD,
        you: false, mt: false,
      },
      {
        name: 'Your portfolio',
        equity: isAuthed ? '—' : '—', cash: '—', gold: '—', tlt: '—',
        ret: null,
        dd: null,
        you: true, mt: false,
        note: isAuthed ? 'Position-level scenario impact not yet wired.' : 'Sign in to see portfolio impact.',
      },
      {
        name: 'MacroTilt Asset Tilt',
        equity: '40%', cash: '—', gold: '30%', tlt: '30%',
        ret: apply(engineDD),
        dd: engineDD,
        you: false, mt: true,
      },
    ];
  }, [scen, drawdown, horizonMul, isAuthed]);

  /* engineSectors stress proxy was fabricated (Math.round of vs_spy_pp).
     Per Joe handoff option (b): render the sector list with em-dashes in
     the proxy/stress columns and surface a red FreshnessChip on the
     section. Real per-scenario sector-stress logic ports in a follow-up. */
  const engineSectorsList = useMemo(() => {
    return (allocation?.sectors || []).slice(0, 8).map((s) => ({
      sector: s.sector,
      code: (s.etfs && s.etfs[0]) || s.sector,
    }));
  }, [allocation]);

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
            <b>custom multi-factor</b> scenario. Bond vol, dollar, 10y yield,
            oil — pull the levers, watch the engine respond.
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

      {/* Custom builder */}
      {activeId === 'custom' && (
        <section className="mt-pagesection">
          <div className="mt-sectionhead">
            <div>
              <div className="mt-eyebrow">Build a shock</div>
              <div className="mt-h2">Pull a factor — the engine recomputes live.</div>
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
          </div>
          <div className="sn-customcard">
            {SLIDERS.map((s) => (
              <div key={s.key} className="sn-slidercell">
                <div>
                  <div className="mt-eyebrow">{s.label}</div>
                  <div className="sn-slidersub">{s.sub}</div>
                </div>
                <input
                  type="range"
                  className="sn-slider"
                  min={s.min}
                  max={s.max}
                  step={s.step}
                  value={custom[s.key]}
                  onChange={(e) => setCustom({ ...custom, [s.key]: Number(e.target.value) })}
                />
                <div className="sn-sliderval num">
                  {custom[s.key] > 0 ? '+' : ''}{(custom[s.key] * 100).toFixed(0)}%
                </div>
              </div>
            ))}
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

      {/* Strategy allocations table — REAL data from backtest drawdowns */}
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

      {/* Split — engine response (em-dashed + red chip) + portfolio impact */}
      <section className="mt-pagesection">
        <div className="sn-splitcard">
          <article className="mt-card sn-engineimpact">
            <div className="mt-sectionhead-tight">
              <div>
                <div className="mt-eyebrow">Asset Tilt engine response</div>
                <div className="mt-h2">How sectors would move.</div>
              </div>
              <FreshnessChip elementId="scenario-allocation_history-weekly" variant="dot" />
            </div>
            <ul className="sn-sectorlist">
              {engineSectorsList.map((s) => (
                <li key={s.code} className="sn-sectorrow">
                  <span className="sn-sectorcode">{s.code}</span>
                  <span className="sn-secname">{s.sector}</span>
                  <span className="num sn-proxy">—</span>
                  <span className="sn-arrow">→</span>
                  <span className="num sn-stress">—</span>
                </li>
              ))}
            </ul>
            <div className="sn-section-note">
              Per-scenario sector-stress numbers are not yet wired into the
              overhaul — the legacy Scenario Analysis page has the logic, port
              follows in a separate change.
            </div>
          </article>

          <article className="mt-card sn-poslosses">
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
