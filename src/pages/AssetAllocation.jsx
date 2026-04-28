// AssetAllocation — page taken down (v2) for Senior Quant calibration audit.
//
// 2026-04-28 evening: after the Phase B rebuild restored the page, Joe
// surfaced multiple Senior Quant calibration errors that the rebuild had
// preserved unchanged:
//
//   1. HY-IG / HY OAS threshold is below historical floor.
//      The Risk Scenarios narrative says "HY-IG > 250bp activates the
//      defensive sleeve". Pulled from FRED (BAMLH0A0HYM2 = HY OAS over
//      Treasuries) the indicator has NEVER been below 259bp in the 812-day
//      sample. Real stress is 500bp+ (Joe's intuition: 4-6%). The 250bp
//      threshold has been continuously breached for the entire dataset
//      yet the model has not had its defensive sleeve continuously on —
//      i.e. the threshold isn't actually wired to the model.
//
//   2. R&L composite read by v9 is month-end-stale.
//      v9_allocation.json regime.risk_liquidity = 30.9 (end of March
//      2026). composite_history_daily.json today shows R&L = -20.7. The
//      model uses `prior_dt = last_complete_month - MonthEnd(1)` for
//      lookahead-safety which means production recommendations always lag
//      the visible composite by ~1 month. User reads R&L = -20.7 (calm)
//      on the gauges, then sees "Model has de-risked" on Asset Tilt; the
//      two numbers are the same composite at different dates.
//
//   3. Risk Scenarios narrative does not describe what model actually
//      does. Defensive sleeve activation is keyed off the R&L composite
//      score, not directly off HY OAS, real rates, VIX, etc. The current
//      copy implies direct trigger wiring that doesn't exist.
//
// All three are calibration / Senior Quant issues, not display issues.
// They cannot be fixed by re-skinning the React. They require: (a) a
// re-validation pass on every threshold against historical distributions,
// (b) a decision on month-end-stale vs daily-fresh model output, (c) a
// rewrite of the trigger-narrative to match actual model behavior, and
// (d) backtest validation before any production change ships.
//
// Until that work is complete and the Senior Quant signs it off, the page
// renders this banner instead of misleading numbers.

export default function AssetAllocation() {
  return (
    <main style={{ maxWidth: 880, margin: "0 auto", padding: "var(--space-12) var(--space-8)" }}>
      <section style={{
        padding: "var(--space-10) var(--space-8)",
        background: "var(--surface-solid, var(--surface))",
        border: "1px solid var(--border-strong, var(--border))",
        borderRadius: "var(--radius-lg)",
        textAlign: "center",
      }}>
        <div style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          padding: "5px 12px",
          borderRadius: 999,
          background: "rgba(255,69,58,0.14)",
          color: "#7a1414",
          fontSize: 11,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          fontWeight: 600,
          marginBottom: 18,
        }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#a01818" }}/>
          Asset Tilt — under quant calibration review
        </div>

        <h1 style={{
          fontFamily: "var(--font-display, Fraunces, Georgia, serif)",
          fontSize: 32,
          fontWeight: 400,
          margin: "0 0 14px",
          letterSpacing: "-0.012em",
          lineHeight: 1.15,
        }}>
          Senior Quant is re-validating this page front to back.
        </h1>

        <p style={{
          fontSize: 14.5,
          lineHeight: 1.65,
          color: "var(--text-2, var(--text-muted))",
          maxWidth: 600,
          margin: "0 auto 14px",
        }}>
          On 2026-04-28 we surfaced three Senior Quant calibration issues that
          can't be fixed at the display layer:
        </p>

        <div style={{
          textAlign: "left",
          maxWidth: 640,
          margin: "0 auto 22px",
          padding: "16px 20px",
          background: "var(--bg, #fafaf7)",
          border: "0.5px solid var(--border)",
          borderRadius: 8,
          fontSize: 13,
          lineHeight: 1.65,
          color: "var(--text-2, var(--text-muted))",
        }}>
          <ol style={{ margin: 0, paddingLeft: 20 }}>
            <li style={{ marginBottom: 8 }}>
              <strong>HY OAS threshold of 250bp is below the historical floor.</strong>{" "}
              HY OAS has not been below 259bp in the dataset; real stress doesn't kick in until 500–700bp+.
            </li>
            <li style={{ marginBottom: 8 }}>
              <strong>The model reads month-end R&amp;L.</strong>{" "}
              v9 is using a value from end of March (R&amp;L = 30.9) while today's R&amp;L is −20.7. Recommendations lag the visible composite by ~1 month.
            </li>
            <li>
              <strong>Risk Scenario narrative doesn't match the model.</strong>{" "}
              The defensive sleeve activates on the R&amp;L composite score, not directly on HY, VIX, or real rates as the copy implies.
            </li>
          </ol>
        </div>

        <p style={{
          fontSize: 13,
          lineHeight: 1.6,
          color: "var(--text-muted)",
          maxWidth: 560,
          margin: "0 auto 24px",
          fontStyle: "italic",
        }}>
          The composite gauges, scanners, watchlist, and Macro Overview are unaffected. The page will return only after every threshold has been re-validated against historical distributions and back-tested.
        </p>

        <a href="#overview" style={{
          display: "inline-block",
          padding: "11px 20px",
          background: "var(--accent)",
          color: "#fff",
          borderRadius: 6,
          textDecoration: "none",
          fontSize: 13,
          fontWeight: 500,
          letterSpacing: "0.01em",
        }}>
          Go to Macro Overview →
        </a>

        <div style={{
          marginTop: 32,
          paddingTop: 18,
          borderTop: "0.5px dashed var(--border)",
          fontSize: 11,
          color: "var(--text-muted)",
          lineHeight: 1.6,
        }}>
          Status: under quant calibration review · 2026-04-28 evening · Senior Quant lead<br/>
          Tracking: bugs <strong>#1113</strong>, <strong>#1122</strong>, <strong>#1123</strong>, <strong>#1124</strong>, <strong>#1125</strong>
        </div>
      </section>
    </main>
  );
}
