// AssetAllocation — page temporarily disabled for repair (2026-04-28).
//
// Why this page is dark:
//   QA on 2026-04-28 surfaced multiple display issues that did not reflect the
//   underlying v9 model. Rather than show numbers we don't trust, we paused
//   this view while the team patches the math, the regime-driven copy, and
//   the live risk-trigger logic.
//
// What is being fixed (rebuild branch: feature/dev-asset-tilt-rebuild):
//   1. Margin formula was leverage − equity_share; correct is
//      max(0, leverage × equity_share − 1.0).
//   2. "Excess return target" KPI was rendering the gross-deployment field
//      (alpha = equity_share × leverage) as a monthly excess return.
//   3. The What / The Why / hero subtitle were hardcoded to a "benign /
//      risk-on" thesis regardless of the actual regime read.
//   4. Risk Scenarios tile listed static triggers; live HY spread, R&L, real
//      rates, and SLOOS prints were never compared against them.
//   5. Sector heatmap ratings were JSX literals, not model output.
//   6. Hero title and subtitle could contradict (e.g., "Defensive — defensive
//      posture" stacked above "Risk-on conditions support overweighting").
//   7. v9 itself uses a hard threshold at R&L = 20 that flips leverage from
//      1.28× to 1.0× in a single calculation cycle. Senior Quant is shipping
//      a smooth ramp 15→25 with 5pt hysteresis on a separate branch
//      (feature/quant-v9-threshold-smoothing) before this page returns.
//
// The model itself is unchanged — only this view is paused. The composites
// page, the indicator detail pages, the watchlist, and all scanner outputs
// are unaffected. v9_allocation.json continues to refresh on its weekly
// schedule.

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
          background: "rgba(184,134,11,0.14)",
          color: "#7a4a00",
          fontSize: 11,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          fontWeight: 600,
          marginBottom: 18,
        }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#B8860B" }}/>
          Asset Tilt — temporarily down for repair
        </div>

        <h1 style={{
          fontFamily: "var(--font-display, Fraunces, Georgia, serif)",
          fontSize: 32,
          fontWeight: 400,
          margin: "0 0 14px",
          letterSpacing: "-0.012em",
          lineHeight: 1.15,
        }}>
          We're rebuilding this page.
        </h1>

        <p style={{
          fontSize: 14.5,
          lineHeight: 1.65,
          color: "var(--text-2, var(--text-muted))",
          maxWidth: 560,
          margin: "0 auto 14px",
        }}>
          Quality control flagged several display errors that didn't reflect the
          underlying model. Rather than show numbers we don't trust, we've paused
          this view while we patch the math, the regime-driven commentary, and
          the live risk-trigger logic.
        </p>

        <p style={{
          fontSize: 13,
          lineHeight: 1.6,
          color: "var(--text-muted)",
          maxWidth: 540,
          margin: "0 auto 26px",
          fontStyle: "italic",
        }}>
          The model itself is unchanged. Composites, scanners, and watchlists are
          all unaffected. Estimated back online today.
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
          Status: under repair · 2026-04-28 · MacroTilt Lead Developer<br/>
          Tracking: rebuild branch <code style={{ fontFamily: "var(--font-mono)", fontSize: 10.5 }}>feature/dev-asset-tilt-rebuild</code> · quant fix <code style={{ fontFamily: "var(--font-mono)", fontSize: 10.5 }}>feature/quant-v9-threshold-smoothing</code>
        </div>
      </section>
    </main>
  );
}
