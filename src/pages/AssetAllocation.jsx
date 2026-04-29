// AssetAllocation — Asset Tilt tab (#allocation).
//
// As of 2026-04-29, this page is intentionally banner-only. The previous
// v9 / v10 framework on this tab was retired during the v11 rebuild, and
// Joe has scoped Asset Tilt v2 (allocation across sectors, industry groups,
// and the defensive sleeve, driven by the v9 model that's already on disk)
// as a separate workstream.
//
// The macro state read that USED to live here has moved to the Macro
// Overview tab (#overview, src/pages/MacroOverview.jsx) — that's where the
// Cycle Mechanism Board lives now per Joe's three-stage funnel:
//   Macro Overview → Asset Tilt → Trading Opps.
//
// LESSONS rule 30: every user-visible string here derives from no live data
// (the page is a static banner — no model state to display). When Asset
// Tilt v2 ships, this file gets fully rewritten; the calibration JSON
// pipeline is unaffected because it's tab-agnostic.

import React from "react";

export default function AssetAllocation() {
  return (
    <main style={{
      maxWidth: 880, margin: "0 auto",
      padding: "var(--space-12, 64px) var(--space-8, 28px) var(--space-12, 64px)",
    }}>
      <section style={{ paddingBottom: 24, borderBottom: "1px solid #1a1a1a", marginBottom: 32 }}>
        <div style={{
          fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase",
          color: "#7a7a72", marginBottom: 16, fontWeight: 600,
        }}>
          Asset Tilt
        </div>
        <h1 style={{
          fontFamily: "var(--font-display, Fraunces, Georgia, serif)",
          fontSize: 38, fontWeight: 300, lineHeight: 1.15, letterSpacing: "-0.018em",
          color: "#1a1a1a", margin: "0 0 12px", maxWidth: 760,
        }}>
          Asset Tilt is being rebuilt.
        </h1>
        <p style={{
          fontSize: 15, color: "#3a3a32", maxWidth: 720, lineHeight: 1.6, margin: "0 0 16px",
        }}>
          Asset Tilt is the second stage of MacroTilt's three-stage funnel:
          given the macro regime, how should I allocate across sectors,
          industry groups, and the defensive sleeve. The previous v9 page
          on this tab is retired; v2 is in scope and will rebuild against
          the locked allocation framework.
        </p>
        <p style={{
          fontSize: 13, color: "#7a7a72", maxWidth: 720, lineHeight: 1.55, margin: 0,
        }}>
          For today's macro state — the regime read that used to sit at the
          top of this page — see the <a href="#overview" style={{ color: "#1a1a1a", fontWeight: 600 }}>Macro Overview</a> tab.
        </p>
      </section>

      <div style={{
        padding: "20px 22px", background: "var(--accent-parchment, #f5efde)",
        border: "0.5px dashed var(--border-strong, #cdc9bf)", borderRadius: 10,
      }}>
        <div style={{
          fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase",
          color: "#7a7a72", marginBottom: 8, fontWeight: 600,
        }}>
          What this tab will become
        </div>
        <p style={{ fontSize: 13, color: "#1a1a1a", lineHeight: 1.6, margin: "0 0 8px" }}>
          Asset Tilt v2 will translate the macro regime read on the Macro Overview
          tab into specific allocation guidance: sector weights, industry-group
          tilts, and how much of the book belongs in the defensive sleeve (cash,
          long-duration Treasuries, gold, IG credit) under today's conditions.
        </p>
        <p style={{ fontSize: 12, color: "#7a7a72", lineHeight: 1.55, margin: 0 }}>
          The downstream Trading Opportunities tab takes the allocation guidance
          and surfaces the specific tickers / contracts that execute it.
        </p>
      </div>
    </main>
  );
}
