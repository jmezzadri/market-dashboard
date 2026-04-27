// src/pages/ScenarioAnalysis.jsx
//
// Sprint 1 scaffold — admin-gated BETA route. The full interactive page
// follows the v2.3 design spec at design-lab/scenario-analysis-v2-interactive.html
// and is built out across Sprints 1-3:
//   Sprint 1 (now): page exists, route works, methodology memo signed off
//   Sprint 2: wire L1/L2/L3/L4 panels to live data + compute_v9_allocation via
//             the CCAR→v9 translation layer (translation-ccar-to-v9-v1.md)
//   Sprint 3: golden-output back-tests + Sector Lab retirement + production ship
//
// Methodology: scenario-analysis-methodology-v1.md (Joe-approved 2026-04-27).
// Translation:  translation-ccar-to-v9-v1.md (drafted 2026-04-27, awaiting sign-off).

import { useState } from "react";

export default function ScenarioAnalysis() {
  const [horizon, setHorizon] = useState("3mo");

  const cardStyle = {
    background: "var(--surface-solid)",
    border: "1px solid var(--border-strong)",
    borderRadius: "var(--radius-lg)",
    padding: "var(--space-8) var(--space-10)",
    marginBottom: "var(--space-6)",
  };

  const eyebrowStyle = {
    fontSize: 11,
    letterSpacing: "0.12em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
    fontWeight: 600,
    marginBottom: 6,
  };

  const titleStyle = {
    fontFamily: "var(--font-display, var(--font-ui))",
    fontWeight: 400,
    fontSize: 34,
    letterSpacing: "-0.015em",
    lineHeight: 1.1,
    color: "var(--text)",
    marginBottom: 8,
  };

  const ledeStyle = {
    fontSize: 14,
    color: "var(--text-2)",
    lineHeight: 1.55,
    maxWidth: 720,
  };

  return (
    <div style={{ padding: "var(--space-6) var(--space-8)" }}>
      <section style={cardStyle}>
        <div style={eyebrowStyle}>04 · Scenario Analysis · BETA</div>
        <h1 style={titleStyle}>Stress your book against history.</h1>
        <p style={ledeStyle}>
          Pick a historical episode (8 canned scenarios — GFC 2008, COVID 2020,
          2022 Inflation, 2018 Q4 Pivot, 2024 AI Concentration, 1987 Black Monday,
          2000 Slow Burn, 2002 Capitulation) or build a custom factor shock from
          the CCAR US-Domestic 16 variables. See impact across four output layers:
          composite indicators (L1), sector + Industry Group rankings (L2), your
          portfolio P&amp;L (L3), and what the AA engine would re-allocate to
          under that regime (L4).
        </p>
      </section>

      <section style={cardStyle}>
        <div style={eyebrowStyle}>Sprint 1 · BETA scaffold</div>
        <h2 style={{ ...titleStyle, fontSize: 22 }}>Page is wired up; engine wiring follows.</h2>
        <ul style={{ fontSize: 14, lineHeight: 1.75, color: "var(--text-2)", paddingLeft: 18, margin: 0 }}>
          <li><strong>Methodology memo</strong> (scenario-analysis-methodology-v1.md) signed off
              2026-04-27. CCAR US-16 variable universe locked. 8 historical scenarios re-anchored
              against CCAR.</li>
          <li><strong>Translation layer</strong> (translation-ccar-to-v9-v1.md) drafted; permanent
              CCAR→v9 mapping that lets Scenario Analysis stress the AA tool's existing optimizer.
              Awaiting sign-off.</li>
          <li><strong>Phase 1 calibration</strong> (scripts/calibrate_scenario_panel.py) ready
              to run; produces 7 artifacts including factor_covariance.json and
              scenario_anchors.json.</li>
          <li><strong>Visual reference</strong>: design-lab/scenario-analysis-v2-interactive.html
              has the full clickable demo with all 8 scenarios, 12-factor sliders, Realistic /
              Bespoke modes, and Coherence Score.</li>
          <li><strong>Sprint 2</strong> wires L1/L2/L3/L4 to live data + the AA engine.</li>
          <li><strong>Sprint 3</strong> golden-output back-tests + Sector Lab retirement + production ship.</li>
        </ul>
      </section>

      <section style={cardStyle}>
        <div style={eyebrowStyle}>Architectural Principle</div>
        <h2 style={{ ...titleStyle, fontSize: 22 }}>This is a stress-test viewer, not an allocation engine.</h2>
        <p style={ledeStyle}>
          The Asset Allocation tab is the calibrated prescription engine. Scenario Analysis
          re-runs that same engine with stressed CCAR factor inputs translated to v9's
          factor panel. Same optimizer, same 25 GICS Industry Groups, same 4-asset Defensive
          sleeve (BIL · TLT · GLD · LQD), same output schema. If a Scenario Analysis output
          ever disagrees with what AA would prescribe under the same translated inputs,
          that's a bug, not a feature.
        </p>
      </section>
    </div>
  );
}
