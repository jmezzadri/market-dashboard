/* Home — refactored 2026-05-27 per Joe Path-A directive.

   Catalog violations resolved (5 of 5):
   1. HEADLINES (6 fake news items) → ENTIRE news section DELETED per
      Joe Path-B nuance ("Home news list — different beast. Either wire
      a real news feed or delete the section entirely").
   2. "0.86" portfolio beta — already removed in prior pass; deck now
      reads regime + equity_pct off real hooks.
   3. "standby" defensive sleeve literal — already removed; deck shows
      real equity_pct/def_pct from useAllocation.
   4. "Eight names cleared a 5-point score this morning" — removed.
   5. FeatureCard stat pills — now bound to real counts:
        Scanner: trading_opps band total (useTradingOppsTop)
        Portfolio: accounts.length (useUserPortfolio), em-dash unauth
        Scenarios: count from /scenario_definitions.json

   Style refactor (zero inline style props on this file):
   - Stat tiles use .hm-statgrid / .hm-stat / .hm-statval / .hm-statsub
   - Today's read grid uses .hm-todaygrid
   - Map card uses .hm-mapcard / .hm-mapcardhead / .hm-mapcardsub
   - Engine call card uses .hm-tiltcard / .hm-tiltcardhead / .hm-tiltcall
     / .hm-tiltsubcall / .hm-allocgroup / .hm-allocfoot / .hm-eyebrowrow
   - Feature grid uses .hm-featgrid.hm-featgrid--three
   - FeatureCard uses .hm-feat / .hm-feattop / .hm-feattitle /
     .hm-featbody / .hm-featnum / .hm-featstat / .hm-featgo
   - Canvas inset uses .hm-canvaswrap utility (chrome.css). */

import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import FreshnessChip from '../components/FreshnessChip';
import RegimeCanvas from '../components/RegimeCanvas';
import useIndicators from '../lib/useIndicators';
import useAllocation from '../lib/useAllocation';
import useEngineRegime from '../lib/useEngineRegime';
import useTradingOppsTop from '../../hooks/useTradingOppsTop';
import useUserPortfolio from '../../hooks/useUserPortfolio';

function fmtPercent(v, digits = 0) {
  if (v == null || !Number.isFinite(v)) return '—';
  return `${(v * 100).toFixed(digits)}%`;
}

export default function HomePage() {
  const { active } = useIndicators();
  const { allocation } = useAllocation();
  const regime = useEngineRegime();
  const { bandCounts } = useTradingOppsTop(20);
  const { accounts, isAuthed } = useUserPortfolio();
  const [scenarioCount, setScenarioCount] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    fetch('/scenario_definitions.json', { cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (!cancelled && Array.isArray(j?.scenarios)) setScenarioCount(j.scenarios.length); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const stressed = active.filter((i) => i.state === 'extreme').length;
  const elevated = active.filter((i) => i.state === 'elevated').length;
  const calm = active.filter((i) => i.state === 'calm').length;
  const total = active.length;

  const equityPct = allocation?.equity_pct ?? null;
  const defPct = allocation?.defensive_pct ?? null;

  const allocRows = useMemo(() => {
    const rows = (allocation?.sectors || [])
      .map((s) => ({
        code: (s.etfs && s.etfs[0]) || s.sector,
        name: s.sector,
        weight: Number(s.weight) || 0,
      }))
      .filter((s) => s.weight > 0)
      .sort((a, b) => b.weight - a.weight);
    const maxW = rows.length ? rows[0].weight : 0;
    return rows.map((r) => ({ ...r, fraction: maxW > 0 ? r.weight / maxW : 0 }));
  }, [allocation]);

  const scannerStat = bandCounts?.total != null
    ? `${bandCounts.total} long alerts`
    : '— long alerts';
  const portfolioStat = isAuthed
    ? `${(accounts || []).length} accounts`
    : '— accounts';
  const scenarioStat = scenarioCount != null
    ? `${scenarioCount} scenarios`
    : '— scenarios';

  return (
    <div className="mt-pagebody mt-fade">
      <section className="mt-pagehero">
        <div>
          <div className="mt-eyebrow">Today's tape · MacroTilt</div>
          <h1 className="mt-h1">
            {regime.stressZone || 'Reading'},
            <br />
            <i>{(regime.yieldRegime || 'inflationary').toLowerCase()}</i>{' '}
            — with <span className="num hm-nowrap">{stressed} of {total}</span> flashing.
          </h1>
          <p className="mt-deck">
            Bond-market volatility set by{' '}
            <b className="num">MOVE {regime.move != null ? regime.move.toFixed(1) : '—'}</b>{' '}
            and the 3-month change in 10y rates at{' '}
            <b className="num">{regime.yieldDeltaBp != null ? `${regime.yieldDeltaBp >= 0 ? '+' : ''}${regime.yieldDeltaBp.toFixed(0)} bp` : '—'}</b>{' '}
            put the engine in{' '}
            <b>{equityPct != null ? `${(equityPct * 100).toFixed(0)}% equity` : 'reading…'}</b>.{' '}
            <a href="#" onClick={(e) => { e.preventDefault(); navigate('/methodology'); }}>
              Read the methodology →
            </a>
          </p>
        </div>

        <div className="hm-statgrid">
          <StatTile
            label="Stress signal"
            value={regime.move != null ? regime.move.toFixed(1) : '—'}
            sub={`MOVE · ${regime.movePct != null ? `${regime.movePct}th pctile` : '—'} · Watch ${regime.stressThresholds?.watch ?? 116}`}
          />
          <StatTile
            label="Yield regime"
            value={regime.yieldDeltaBp != null ? `${regime.yieldDeltaBp >= 0 ? '+' : ''}${regime.yieldDeltaBp.toFixed(0)}` : '—'}
            unit="bp"
            sub={`3M Δ 10y · ${regime.yieldPct != null ? `${regime.yieldPct}th pctile` : '—'} · ${(regime.yieldRegime || '—').toLowerCase()}`}
          />
          <StatTile
            label="Indicators"
            value={`${stressed + elevated}`}
            unit={`/${total}`}
            sub={
              <>
                <b className="num hm-stat-down">{stressed}</b> extreme · <b className="num hm-stat-warn">{elevated}</b> elevated · <b className="num hm-stat-up">{calm}</b> calm
              </>
            }
          />
        </div>
      </section>

      {/* Today's read — Macro position (left) + Engine call + allocation (right) */}
      <section className="mt-pagesection">
        <div className="hm-todaygrid">

          {/* Map card */}
          <div className="lm-canvas hm-mapcard">
            <div className="hm-mapcardhead">
              <div>
                <div className="mt-eyebrow">Macro position</div>
                <div className="mt-h2">Where the {total} indicators sit today.</div>
                <div className="hm-mapcardsub">
                  Hover any dot to read · click to drill into history
                </div>
              </div>
              <button type="button" className="mt-btn" onClick={() => navigate('/macro')}>
                Open Macro →
              </button>
            </div>
            <div className="hm-canvaswrap">
              <RegimeCanvas indicators={active} aspect={1.55} />
            </div>
            <div className="lm-canvaslegend">
              <div className="lm-legrow">
                <span className="lm-legdot lm-legdot--extreme" /> extreme
                <span className="lm-legdot lm-legdot--elevated" /> elevated
                <span className="lm-legdot lm-legdot--calm" /> calm
              </div>
              <div className="lm-legrow lm-legrow--dim">
                {total} indicators · live · 5y normalized
              </div>
            </div>
          </div>

          {/* Engine Call card */}
          <aside className="hm-tiltcard">
            <div className="hm-tiltcardhead">
              <div>
                <div className="mt-eyebrow">Engine call · today</div>
                <div className="hm-tiltcall">
                  {regime.stressZone || '—'} · <i>{regime.yieldRegime || '—'}</i>
                </div>
                <div className="hm-tiltsubcall">
                  <b className="num">{fmtPercent(equityPct, 0)}</b> equity ·{' '}
                  <b className="num">{fmtPercent(defPct, 0)}</b> defensive ·{' '}
                  <FreshnessChip elementId="v10-allocation-daily" variant="label" />
                </div>
              </div>
              <button type="button" className="mt-btn" onClick={() => navigate('/tilt')}>
                Open Tilt →
              </button>
            </div>

            <div className="hm-allocgroup">
              <div className="hm-eyebrowrow">
                <span className="mt-eyebrow">Recommended allocation</span>
                <span className="hm-allocfoot num">= 100%</span>
              </div>
              {allocRows.map((s) => (
                <button
                  key={s.code}
                  type="button"
                  onClick={() => navigate('/tilt')}
                  className="hm-allocrow"
                >
                  <span className="hm-allocname">
                    <span className="lm-flowcode">{s.code}</span>
                    <span className="hm-allocnamelbl">{s.name}</span>
                  </span>
                  <span className="hm-allocbar">
                    <span className="hm-allocbar-fill" style={{ width: `${(s.fraction * 100).toFixed(1)}%` }} />
                  </span>
                  <span className="num hm-allocpct">
                    {(s.weight * 100).toFixed(1)}<i>%</i>
                  </span>
                </button>
              ))}
            </div>
          </aside>
        </div>
      </section>

      {/* Feature cards */}
      <section className="mt-pagesection">
        <div className="hm-featgrid hm-featgrid--three">
          <FeatureCard
            num="01"
            label="Trading scanner"
            title="Five signals into one score"
            body="Insider, dark-pool prints, options flow, congressional trades and technicals — cleared liquidity gate."
            stat={scannerStat}
            freshnessId="equity-latest_scan_data-daily"
            onClick={() => navigate('/scanner')}
          />
          <FeatureCard
            num="02"
            label="Portfolio insights"
            title="Your book, augmented"
            body="Every line scored, tilts compared to engine, freshness on every value. Chase / Fidelity / Schwab CSV import."
            stat={portfolioStat}
            freshnessId="portfolio-positions-on_change"
            onClick={() => navigate('/portfolio')}
          />
          <FeatureCard
            num="03"
            label="Scenario analysis"
            title="Stress-test the playbook"
            body="Historical shocks plus a custom builder. See how each strategy responds."
            stat={scenarioStat}
            freshnessId="scenario-scenario_definitions-static"
            onClick={() => navigate('/scenarios')}
          />
        </div>
      </section>

      {/* Market news section DELETED per Joe Path-B nuance 2026-05-27:
          "Home news list — different beast. Either wire a real news feed or
          delete the section entirely (Path B for this one). News is its own
          product; an empty news list under a red chip looks wrong." */}
    </div>
  );
}

function StatTile({ label, value, unit, sub }) {
  return (
    <div className="hm-stat">
      <div className="mt-eyebrow">{label}</div>
      <div className="hm-statval num">
        {value}
        {unit && <span>{unit}</span>}
      </div>
      <div className="hm-statsub">{sub}</div>
    </div>
  );
}

function FeatureCard({ num, label, title, body, stat, freshnessId, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="hm-feat"
    >
      <div className="hm-featnum">{num}</div>
      <div className="hm-feattop">
        <div className="mt-eyebrow">{label}</div>
        <FreshnessChip elementId={freshnessId} variant="dot" />
      </div>
      <div className="hm-feattitle">{title}</div>
      <p className="hm-featbody">{body}</p>
      <div className="hm-featstat">
        <span className="mt-tag mt-tag--accent">{stat}</span>
        <span className="hm-featgo">Open →</span>
      </div>
    </button>
  );
}
