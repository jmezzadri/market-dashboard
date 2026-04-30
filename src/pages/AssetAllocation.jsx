// AssetAllocation — page is offline behind a calibration banner pending
// Senior Quant sign-off on bugs #1122 + #1125. The full allocation surface
// (KPI strip, IG-25 ranking, drill-downs) lives in the working tree but
// will not return to main until the threshold + R&L-staleness fixes have
// been backtested 1985–2026 and approved.
//
// Three open calibration items, summarized in the banner below:
//   1. HY OAS threshold (#1125, P0). The Risk Scenarios narrative says
//      "HY OAS > 250bp activates the defensive sleeve." HY OAS has never
//      been below 259bp in 812 days; real stress is 500–700bp (Joe's read:
//      4-6%). The 250bp number is narrative only — the model actually
//      keys defensive activation off the R&L composite. Fix is either
//      raise the threshold to ~500bp armed / 600bp active OR rewrite the
//      narrative to describe what the model does. Either path needs
//      Senior Quant backtest before merge.
//   2. v9 reads month-end R&L (#1122 family). v9_allocation.json shows
//      regime.risk_liquidity from end-of-March; daily R&L today is the
//      different number visible on Today's Macro. Production lag is ~1mo
//      under the lookahead-safety rule.
//   3. Risk Scenarios narrative does not match model behavior. Defensive
//      sleeve is keyed off R&L composite — not direct factor wiring on
//      HY OAS, VIX, real rates as copy currently implies.
//
// Until the Senior Quant signs off, the page renders this banner. The
// design here is v11-aligned (Fraunces 28 header, Inter 14 body, mono 11
// metadata, darkblood-subtle pill, single off-white surface) so the
// brand stays consistent with Macro Overview.

export default function AssetAllocation() {
  return (
    <main style={{
      maxWidth: 920,
      margin: "0 auto",
      padding: "60px 32px 80px",
      fontFamily: "var(--font-body, Inter, sans-serif)",
    }}>
      <section style={{
        padding: "44px 40px",
        background: "var(--surface-solid, var(--surface))",
        border: "0.5px solid var(--border-strong, var(--border))",
        borderRadius: 12,
        textAlign: "center",
      }}>
        {/* Status pill — v11 darkblood-subtle bg, darkblood-active text */}
        <div style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          padding: "5px 12px",
          borderRadius: 999,
          background: "var(--darkblood-subtle, rgba(122,20,20,0.14))",
          color: "var(--darkblood-active, #7a1414)",
          fontFamily: "var(--font-mono, JetBrains Mono, monospace)",
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: "0.10em",
          textTransform: "uppercase",
          marginBottom: 22,
        }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--darkblood-active, #7a1414)" }}/>
          Asset Tilt · under quant calibration review
        </div>

        {/* Headline — v11 Fraunces 28 */}
        <h1 style={{
          fontFamily: "var(--font-display, Fraunces, Georgia, serif)",
          fontSize: 28,
          fontWeight: 400,
          margin: "0 0 14px",
          letterSpacing: "-0.012em",
          lineHeight: 1.22,
          color: "var(--text)",
        }}>
          Senior Quant is re-validating this page front to back.
        </h1>

        {/* Lede — v11 14 body */}
        <p style={{
          fontSize: 14,
          lineHeight: 1.6,
          color: "var(--text-2, var(--text-muted))",
          maxWidth: 620,
          margin: "0 auto 18px",
        }}>
          Three Senior Quant calibration issues surfaced 2026-04-28 that can't be fixed at the display layer.
          Each requires a re-validation pass against historical distributions and a back-test before the page returns.
        </p>

        {/* Issue list — v11 surface treatment */}
        <div style={{
          textAlign: "left",
          maxWidth: 660,
          margin: "0 auto 22px",
          padding: "18px 22px",
          background: "var(--bg)",
          border: "0.5px solid var(--border)",
          borderRadius: 12,
          fontSize: 14,
          lineHeight: 1.65,
          color: "var(--text-2, var(--text-muted))",
        }}>
          <ol style={{ margin: 0, paddingLeft: 20 }}>
            <li style={{ marginBottom: 10 }}>
              <strong style={{ color: "var(--text)" }}>HY OAS threshold sits below the historical floor (#1125).</strong>{" "}
              The narrative promises "HY OAS &gt; 250bp activates the defensive sleeve," but HY OAS has never been below 259bp in the 812-day sample.
              Real stress is 500–700bp+; the model itself keys defensive activation off the R&amp;L composite, not HY OAS directly.
              Fix is either re-thresholding (with backtest) or rewriting the copy to describe what the model actually does.
            </li>
            <li style={{ marginBottom: 10 }}>
              <strong style={{ color: "var(--text)" }}>R&amp;L composite read by v9 is month-end-stale (#1122).</strong>{" "}
              v9_allocation.json holds end-of-March R&amp;L (30.9); today's daily composite reads −20.7.
              Lookahead-safety rule means production recommendations lag the visible composite by ~1 month.
              Decision pending: month-end-stale vs daily-fresh.
            </li>
            <li>
              <strong style={{ color: "var(--text)" }}>Risk Scenarios narrative doesn't describe model behavior.</strong>{" "}
              Defensive sleeve activates on the R&amp;L composite score — not directly on HY OAS, real rates, or VIX as the current copy implies.
              Trigger-narrative will be rewritten to match actual model logic.
            </li>
          </ol>
        </div>

        {/* Tail copy */}
        <p style={{
          fontSize: 14,
          lineHeight: 1.6,
          color: "var(--text-muted)",
          maxWidth: 580,
          margin: "0 auto 24px",
          fontStyle: "italic",
        }}>
          Macro Overview, scanners, watchlist, and the composite gauges are unaffected.
          Asset Tilt returns once each threshold is re-validated against historical distributions and back-tested.
        </p>

        {/* CTA */}
        <a href="#overview" style={{
          display: "inline-block",
          padding: "11px 20px",
          background: "var(--accent)",
          color: "#fff",
          borderRadius: 6,
          textDecoration: "none",
          fontFamily: "var(--font-mono, JetBrains Mono, monospace)",
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: "0.10em",
          textTransform: "uppercase",
        }}>
          Go to Macro Overview →
        </a>

        {/* Status footer — v11 mono 11 */}
        <div style={{
          marginTop: 28,
          paddingTop: 16,
          borderTop: "0.5px dashed var(--border)",
          fontFamily: "var(--font-mono, JetBrains Mono, monospace)",
          fontSize: 11,
          fontWeight: 500,
          color: "var(--text-muted)",
          lineHeight: 1.7,
          letterSpacing: "0.04em",
        }}>
          Status: under quant calibration review · Senior Quant lead · 2026-04-28 evening<br/>
          Tracking: bugs <strong>#1122</strong> · <strong>#1125</strong>
        </div>
      </section>
    </main>
  );
}
