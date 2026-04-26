/**
 * AssetAllocation.jsx — Asset Allocation tab (v9, locked 2026-04-25).
 *
 * Reads /v9_allocation.json (refreshed nightly by INDICATOR-REFRESH workflow)
 * and renders the current monthly allocation: 5 industry/sector ETF picks at
 * equal weight, defensive bucket when active, leverage state, regime
 * snapshot, methodology summary, and back-test results.
 *
 * Brand pattern follows TodayMacro.jsx — page-scoped --aa-* tokens map to
 * the existing app theme tokens so light/dark toggle works automatically.
 */
import { useEffect, useState, useMemo } from "react";

const PAGE_VARS = {
  "--aa-bg":        "var(--bg)",
  "--aa-card":      "var(--surface-solid)",
  "--aa-inset":     "var(--surface-2)",
  "--aa-line":      "var(--border)",
  "--aa-ink-0":     "var(--text)",
  "--aa-ink-1":     "var(--text-2)",
  "--aa-ink-2":     "var(--text-muted)",
  "--aa-ink-3":     "var(--text-dim)",
  "--aa-accent":    "var(--accent)",
  "--aa-accent-soft":"var(--accent-soft)",
  "--aa-calm":      "#1f9d60",
  "--aa-quiet":     "#69b585",
  "--aa-elevated":  "#b8811c",
  "--aa-stressed":  "#d23040",
  "--aa-calm-soft": "rgba(31,157,96,0.14)",
  "--aa-stressed-soft":"rgba(210,48,64,0.14)",
  "--aa-elevated-soft":"rgba(184,129,28,0.16)",
  "--aa-fdisp":     "var(--font-display)",
  "--aa-fbody":     "var(--font-ui)",
  "--aa-fmono":     "var(--font-mono)",
};

const STYLES = `
.aa-page * { box-sizing: border-box; }
.aa-page { background: var(--aa-bg); color: var(--aa-ink-0); font-family: var(--aa-fbody); font-size: 14px; line-height: 1.55; padding: 8px 24px 60px; max-width: 1240px; margin: 0 auto; }

.aa-hero { padding: 18px 0 24px; border-bottom: 1px solid var(--aa-line); margin-bottom: 24px; }
.aa-eyebrow { font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--aa-ink-2); }
.aa-headline { font-family: var(--aa-fdisp); font-weight: 400; font-size: 30px; line-height: 1.25; margin: 8px 0 0; max-width: 920px; color: var(--aa-ink-0); }
.aa-headline em { font-style: italic; color: var(--aa-accent); }
.aa-subhead { color: var(--aa-ink-2); font-size: 14px; margin-top: 10px; max-width: 880px; }
.aa-asof { display: inline-block; padding: 3px 10px; background: var(--aa-accent-soft); color: var(--aa-accent); border-radius: 999px; font-size: 11px; margin-top: 14px; font-family: var(--aa-fmono); }

.aa-status-grid { display: grid; grid-template-columns: 1.2fr 1fr 1fr 1fr; gap: 16px; margin-bottom: 28px; }
.aa-stat-card { background: var(--aa-card); border: 1px solid var(--aa-line); border-radius: 6px; padding: 14px 18px; }
.aa-stat-label { font-size: 11px; color: var(--aa-ink-2); letter-spacing: 0.06em; text-transform: uppercase; margin-bottom: 6px; }
.aa-stat-value { font-family: var(--aa-fdisp); font-size: 26px; font-weight: 400; color: var(--aa-ink-0); line-height: 1.1; }
.aa-stat-value.dim { color: var(--aa-ink-2); font-size: 16px; }
.aa-stat-sub { font-size: 12px; color: var(--aa-ink-2); margin-top: 4px; }

.aa-regime-pill { display: inline-flex; align-items: center; gap: 6px; padding: 3px 10px; border-radius: 999px; font-size: 11.5px; font-weight: 500; font-family: var(--aa-fmono); margin-right: 6px; }
.aa-regime-pill.calm { background: var(--aa-calm-soft); color: var(--aa-calm); }
.aa-regime-pill.elevated { background: var(--aa-elevated-soft); color: var(--aa-elevated); }
.aa-regime-pill.stressed { background: var(--aa-stressed-soft); color: var(--aa-stressed); }

.aa-section { margin-top: 32px; }
.aa-section-h { font-family: var(--aa-fdisp); font-size: 18px; font-weight: 400; color: var(--aa-ink-0); margin-bottom: 4px; }
.aa-section-sub { color: var(--aa-ink-2); font-size: 13px; margin-bottom: 14px; }

.aa-table { width: 100%; border-collapse: collapse; background: var(--aa-card); border: 1px solid var(--aa-line); border-radius: 6px; overflow: hidden; font-size: 13px; }
.aa-table th { text-align: left; padding: 10px 14px; font-weight: 500; font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--aa-ink-2); background: var(--aa-inset); border-bottom: 1px solid var(--aa-line); }
.aa-table th.num { text-align: right; }
.aa-table td { padding: 11px 14px; border-bottom: 1px solid var(--aa-line); color: var(--aa-ink-0); }
.aa-table td.num { text-align: right; font-family: var(--aa-fmono); }
.aa-table tr:last-child td { border-bottom: none; }
.aa-ticker { font-family: var(--aa-fmono); font-weight: 600; color: var(--aa-accent); }
.aa-fund { font-size: 12px; color: var(--aa-ink-2); margin-top: 2px; }
.aa-rank-strong { color: var(--aa-calm); font-weight: 600; }
.aa-rank-mid { color: var(--aa-ink-1); }
.aa-rank-weak { color: var(--aa-ink-3); }

.aa-method { background: var(--aa-card); border: 1px solid var(--aa-line); border-radius: 6px; padding: 18px 22px; }
.aa-method p { margin: 0 0 12px; color: var(--aa-ink-1); font-size: 13px; }
.aa-method p:last-child { margin-bottom: 0; }
.aa-method .h { font-family: var(--aa-fdisp); font-size: 16px; color: var(--aa-ink-0); margin-bottom: 10px; }

.aa-back-test-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin-top: 14px; }
.aa-bt-cell { padding: 12px 14px; background: var(--aa-inset); border-radius: 4px; }
.aa-bt-label { font-size: 10.5px; color: var(--aa-ink-2); letter-spacing: 0.06em; text-transform: uppercase; margin-bottom: 4px; }
.aa-bt-value { font-family: var(--aa-fmono); font-size: 18px; font-weight: 600; color: var(--aa-ink-0); }
.aa-bt-vs { font-size: 10.5px; color: var(--aa-ink-2); margin-top: 2px; }

.aa-loading { padding: 40px; text-align: center; color: var(--aa-ink-2); }
.aa-error { padding: 30px; background: var(--aa-stressed-soft); color: var(--aa-stressed); border: 1px solid var(--aa-stressed); border-radius: 6px; }

.aa-disclaimer { margin-top: 32px; font-size: 11.5px; color: var(--aa-ink-3); padding: 12px 16px; background: var(--aa-inset); border-left: 3px solid var(--aa-accent); border-radius: 3px; line-height: 1.6; }

@media (max-width: 800px) {
  .aa-status-grid { grid-template-columns: 1fr 1fr; }
  .aa-back-test-grid { grid-template-columns: 1fr 1fr; }
}
`;

function classifyRegime(rl) {
  if (rl <= -10) return ["calm", "calm"];
  if (rl <= 20) return ["calm", "neutral"];
  if (rl <= 30) return ["elevated", "mild stress"];
  return ["stressed", "high stress"];
}

function pct(x, digits = 1) {
  if (x == null || isNaN(x)) return "—";
  return (x * 100).toFixed(digits) + "%";
}

function rankClass(rank) {
  if (rank == null) return "aa-rank-weak";
  if (rank <= 3) return "aa-rank-strong";
  if (rank <= 7) return "aa-rank-mid";
  return "aa-rank-weak";
}

export default function AssetAllocation() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    // Inject styles once
    if (!document.getElementById("aa-styles")) {
      const s = document.createElement("style");
      s.id = "aa-styles";
      s.textContent = STYLES;
      document.head.appendChild(s);
    }

    fetch("/v9_allocation.json", { cache: "no-store" })
      .then((r) => r.json())
      .then(setData)
      .catch((e) => setError(e.message));
  }, []);

  const headline = useMemo(() => {
    if (!data) return null;
    const alpha = data.alpha;
    const lev = data.leverage;
    const eq = data.equity_share;
    if (alpha > 1.05) return { line: `Strategy is at ${(alpha * 100).toFixed(0)}% equity exposure with ${lev.toFixed(2)}× leverage.`, mood: "Risk-on regime — composites supportive." };
    if (eq < 0.95) return { line: `Strategy is at ${(eq * 100).toFixed(0)}% equity, ${(100 - eq * 100).toFixed(0)}% defensive.`, mood: "Defensive overlay activated." };
    return { line: "Strategy is fully invested in equities. No leverage, no defensive bucket active.", mood: "Calm regime, no stress signals firing." };
  }, [data]);

  if (error) {
    return (
      <div className="aa-page" style={PAGE_VARS}>
        <div className="aa-error">Failed to load allocation: {error}</div>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="aa-page" style={PAGE_VARS}>
        <div className="aa-loading">Loading current allocation…</div>
      </div>
    );
  }

  const { regime } = data;
  const [rlMood, rlLabel] = classifyRegime(regime.risk_liquidity);
  const grLabel = regime.growth > 25 ? "stressed" : regime.growth < -10 ? "calm" : "neutral";
  const grMood = regime.growth > 25 ? "stressed" : regime.growth < -10 ? "calm" : "neutral";
  const irLabel = regime.inflation_rates > 25 ? "hot" : regime.inflation_rates < -10 ? "cool" : "neutral";
  const irMood = regime.inflation_rates > 25 ? "stressed" : regime.inflation_rates < -10 ? "calm" : "neutral";

  return (
    <div className="aa-page" style={PAGE_VARS}>

      {/* HERO */}
      <div className="aa-hero">
        <div className="aa-eyebrow">Asset Allocation · v9</div>
        <h1 className="aa-headline">{headline.line}</h1>
        <div className="aa-subhead">{headline.mood} Strategy is a monthly tactical sector rotation that picks 5 industry-group / sector ETFs based on macro factor regressions and 6-month price momentum, with leverage in calm regimes and a defensive overlay in stressed regimes.</div>
        <div className="aa-asof">As of {data.as_of} · refreshed {data.calculated_at.slice(0, 10)}</div>
      </div>

      {/* STATUS GRID */}
      <div className="aa-status-grid">
        <div className="aa-stat-card">
          <div className="aa-stat-label">Total Equity Exposure</div>
          <div className="aa-stat-value">{(data.alpha * 100).toFixed(1)}%</div>
          <div className="aa-stat-sub">
            {(data.equity_share * 100).toFixed(0)}% equity share
            {data.leverage > 1.005 ? ` × ${data.leverage.toFixed(2)}× leverage` : ""}
          </div>
        </div>

        <div className="aa-stat-card">
          <div className="aa-stat-label">Selection Confidence</div>
          <div className="aa-stat-value dim">{data.selection_confidence}</div>
          <div className="aa-stat-sub">
            {data.selection_confidence === "STRONG" && "Both indicators and momentum confirm all 5 picks."}
            {data.selection_confidence === "MIXED" && "Some picks fell back to indicator-only ranking."}
            {data.selection_confidence === "FLIP_OVERRIDE" && "Regime change detected — momentum overridden."}
            {data.selection_confidence === "PARTIAL" && "Fewer than 5 buckets met the bar."}
          </div>
        </div>

        <div className="aa-stat-card">
          <div className="aa-stat-label">Risk & Liquidity (3-mo)</div>
          <div className="aa-stat-value dim">{regime.risk_liquidity.toFixed(1)}</div>
          <div className="aa-stat-sub">
            <span className={`aa-regime-pill ${rlMood}`}>{rlLabel}</span>
            {regime.rl_3mo_change != null && (
              <span style={{ color: "var(--aa-ink-2)", fontSize: 11.5 }}>
                3-mo Δ {regime.rl_3mo_change > 0 ? "+" : ""}{regime.rl_3mo_change.toFixed(1)}
              </span>
            )}
          </div>
        </div>

        <div className="aa-stat-card">
          <div className="aa-stat-label">Inflation & Rates (18-mo)</div>
          <div className="aa-stat-value dim">{regime.inflation_rates.toFixed(1)}</div>
          <div className="aa-stat-sub">
            <span className={`aa-regime-pill ${irMood}`}>{irLabel}</span>
            <span style={{ color: "var(--aa-ink-2)", fontSize: 11.5 }}>drives leverage</span>
          </div>
        </div>
      </div>

      {/* EQUITY PICKS */}
      <div className="aa-section">
        <div className="aa-section-h">Current equity allocation — 5 picks at equal weight</div>
        <div className="aa-section-sub">Each industry-group or sector ETF is selected only when BOTH the regression's expected return AND the trailing 6-month momentum rank above the universe median. Equal-weighted at 20% each within the equity sleeve.</div>
        <table className="aa-table">
          <thead>
            <tr>
              <th style={{ width: "30%" }}>Bucket</th>
              <th className="num">Total weight</th>
              <th className="num">Indicator rank</th>
              <th className="num">Momentum rank</th>
              <th className="num">Forecast (1-mo)</th>
              <th className="num">Trailing 6-mo</th>
            </tr>
          </thead>
          <tbody>
            {data.picks.map((p) => (
              <tr key={p.ticker}>
                <td>
                  <div className="aa-ticker">{p.ticker}</div>
                  <div className="aa-fund">{p.fund}</div>
                </td>
                <td className="num">{pct(p.weight, 1)}</td>
                <td className={`num ${rankClass(p.indicator_rank)}`}>{p.indicator_rank ?? "—"}</td>
                <td className={`num ${rankClass(p.momentum_rank)}`}>{p.momentum_rank ?? "—"}</td>
                <td className="num">{pct(p.expected_return_monthly, 2)}</td>
                <td className="num">{pct(p.trailing_6mo_return, 1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* DEFENSIVE BUCKET (only when active) */}
      {data.defensive.some((d) => d.weight > 0.001) && (
        <div className="aa-section">
          <div className="aa-section-h">Defensive bucket — active</div>
          <div className="aa-section-sub">Activated because Risk &amp; Liquidity is elevated. Composition driven by composite signals: cash when risk is acute, long Treasuries when growth is weak, gold when inflation is hot, investment-grade bonds when growth is recovering.</div>
          <table className="aa-table">
            <thead>
              <tr>
                <th>Asset</th>
                <th className="num">Total weight</th>
                <th className="num">Within defensive</th>
              </tr>
            </thead>
            <tbody>
              {data.defensive.filter((d) => d.weight > 0.001).map((d) => (
                <tr key={d.ticker}>
                  <td>
                    <div className="aa-ticker">{d.ticker}</div>
                    <div className="aa-fund">{d.fund}</div>
                  </td>
                  <td className="num">{pct(d.weight, 1)}</td>
                  <td className="num">{pct(d.weight_within_defensive, 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* METHODOLOGY + BACK-TEST */}
      <div className="aa-section">
        <div className="aa-section-h">Methodology &amp; back-test</div>
        <div className="aa-section-sub">v{data.methodology.version} · locked {data.methodology.locked_at} · back-test window {data.methodology.back_test_window}</div>
        <div className="aa-method">
          <div className="h">How the strategy decides</div>
          <p>Each industry / sector / mega-cap-growth bucket has its own multivariate regression on a panel of macro factors (yield curve, credit spreads, real rates, jobless claims, inflation expectations, commercial paper risk, lending standards, capacity utilization, and sector-specific factors). The regression produces an expected next-month return for each bucket.</p>
          <p>Selection is confirmatory: a bucket is held only if BOTH its expected return AND its trailing 6-month price momentum rank in the top half of the universe. Top 5 by combined rank, equal-weighted at 20% each within the equity sleeve.</p>
          <p>The Risk &amp; Liquidity composite (3-month horizon) drives the equity-versus-defensive split: scaled from 100% equity at calm readings down to 60% in extreme stress. The Inflation &amp; Rates composite (18-month horizon) drives leverage between 1.0× and 1.5× in calm regimes. When R&amp;L drops sharply (regime change from stress to recovery), momentum is overridden and selection falls back to indicator-only ranking — addresses the documented "momentum crash" pattern at market V-bottoms.</p>
          <div className="aa-back-test-grid">
            <div className="aa-bt-cell">
              <div className="aa-bt-label">CAGR</div>
              <div className="aa-bt-value">{(data.methodology.back_test_cagr * 100).toFixed(2)}%</div>
              <div className="aa-bt-vs">vs S&amp;P 500 11.06%</div>
            </div>
            <div className="aa-bt-cell">
              <div className="aa-bt-label">Sharpe</div>
              <div className="aa-bt-value">{data.methodology.back_test_sharpe.toFixed(3)}</div>
              <div className="aa-bt-vs">vs S&amp;P 500 0.495</div>
            </div>
            <div className="aa-bt-cell">
              <div className="aa-bt-label">Max drawdown</div>
              <div className="aa-bt-value">{(data.methodology.back_test_max_drawdown * 100).toFixed(1)}%</div>
              <div className="aa-bt-vs">vs S&amp;P 500 -46.3%</div>
            </div>
            <div className="aa-bt-cell">
              <div className="aa-bt-label">vs S&amp;P CAGR</div>
              <div className="aa-bt-value" style={{ color: "var(--aa-calm)" }}>+{(data.methodology.vs_spy_cagr_diff * 100).toFixed(2)}pp</div>
              <div className="aa-bt-vs">per year compounded</div>
            </div>
          </div>
        </div>
      </div>

      <div className="aa-disclaimer">
        Allocation guidance only. Not investment advice. The strategy back-test covers Jan 2008 through Apr 2026 (18.3 years including the 2008 GFC). Past performance does not guarantee future results. The strategy structurally lags the cap-weighted S&amp;P 500 in mega-cap-concentration eras (2021, 2024) by 9-12 percentage points; it outperforms by similar or larger margins in regime-change years (2008 GFC: +22pp, 2013: +17pp, 2026 YTD: +18pp).
      </div>
    </div>
  );
}
