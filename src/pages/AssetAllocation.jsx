// AssetAllocation — v11 Cycle Mechanism Board (Sprint 1).
//
// Reads from public/methodology_calibration_v11.json. Layout follows the
// Editorial / magazine hero design (round-2 mockup A, approved 2026-04-29):
//   1. Eyebrow date + big sentence headline
//   2. Numbered 6-tile strip across the page (top-border accent in state color)
//   3. Detail block per live tile (rule + indicator rows with quartile bars)
//
// 4-state lexicon: Normal / Cautionary / Stressed / Distressed.
// Sprint 1 ships 3 live tiles: Valuation, Credit, Growth. The other three
// (Funding, Liquidity & Policy, Positioning & Breadth) render as greyed
// placeholders labeled with their target sprint.
//
// Full methodology lives at /#methodology (v11 doc, in same PR).

import React, { useEffect, useState } from "react";

const STATE_COLORS = {
  Normal: "#4a7c4a",
  Cautionary: "#b8860b",
  Stressed: "#a04518",
  Distressed: "#7a1414",
};

const STATE_TOOLTIPS = {
  Normal: "The mechanism's rule is not met. Reading is constructive or neutral.",
  Cautionary: "Rule partially met. Watch but do not act.",
  Stressed: "Rule fully met. Mechanism is signaling its concerning regime.",
  Distressed: "Rule fully met AND deteriorating over the last 60 trading days.",
};

function formatDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function QuartileBar({ percentile, label }) {
  // 4-segment colored bar with current-reading dot
  const pos = Math.max(0, Math.min(100, Number(percentile) || 0));
  return (
    <div title={label || `${pos}th percentile`} style={{ display: "inline-block", verticalAlign: "middle" }}>
      <div style={{ position: "relative", display: "flex", height: 7, width: 140, borderRadius: 3, overflow: "hidden" }}>
        <div style={{ flex: 1, background: "#eef0e8" }} />
        <div style={{ flex: 1, background: "#f5efde" }} />
        <div style={{ flex: 1, background: "#f5e1ce" }} />
        <div style={{ flex: 1, background: "#f0d4d4" }} />
        <div style={{
          position: "absolute",
          left: `calc(${pos}% - 6px)`,
          top: -3,
          width: 13,
          height: 13,
          borderRadius: "50%",
          background: "#1a1a1a",
          border: "2px solid #fff",
          boxShadow: "0 0 0 0.5px #cdc9bf",
        }} />
      </div>
    </div>
  );
}

function TileStrip({ tiles }) {
  const ordered = [...tiles].sort((a, b) => (a.order || 99) - (b.order || 99));
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "repeat(6, 1fr)",
      gap: 14,
      marginTop: 30,
    }}>
      {ordered.map((t, i) => {
        const live = t.live;
        const state = t.current_state;
        const color = STATE_COLORS[state] || "#1a1a1a";
        const isElevated = state && state !== "Normal" && state !== "—";
        return (
          <div
            key={t.id}
            title={live ? STATE_TOOLTIPS[state] : `Ships in ${t.ships_in}`}
            style={{
              padding: "14px 0 0",
              borderTop: live
                ? `${isElevated ? 3 : 1.5}px solid ${color}`
                : "1px dashed #cdc9bf",
              opacity: live ? 1 : 0.45,
            }}
          >
            <div style={{ fontFamily: "var(--font-display, Fraunces, Georgia, serif)", fontSize: 11, color: "#7a7a72", letterSpacing: "0.04em" }}>
              {String(i + 1).padStart(2, "0")}
            </div>
            <div style={{
              fontFamily: "var(--font-display, Fraunces, Georgia, serif)",
              fontSize: 16,
              fontWeight: 400,
              lineHeight: 1.2,
              margin: "6px 0 8px",
              minHeight: 36,
              fontStyle: live ? "normal" : "italic",
            }}>
              {t.name}
            </div>
            <div style={{
              fontSize: 11,
              letterSpacing: "0.04em",
              color: live ? color : "#7a7a72",
            }}>
              {live ? state : t.ships_in}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function IndicatorRow({ indicator }) {
  const value = indicator?.current?.value;
  const unit = indicator?.unit;
  const formattedVal = (() => {
    if (value === undefined || value === null) return "—";
    if (unit === "bp") return `${Math.round(value)} bp`;
    if (unit === "% of GDP") return `${value.toFixed(1)}%`;
    if (unit === "ratio") return `${value.toFixed(2)}×`;
    if (typeof value === "number") return value.toFixed(2);
    return String(value);
  })();
  const z = indicator.z_score;
  const trend = indicator.trend_60d;
  const trendText = (z !== undefined && z !== null && trend)
    ? `z = ${z >= 0 ? "+" : ""}${z.toFixed(2)}, ${trend}`
    : null;
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "1.4fr 160px 1fr",
      gap: 18,
      alignItems: "center",
      padding: "10px 0",
      borderBottom: "0.5px dashed var(--border, #e0ddd5)",
    }}>
      <div>
        <div style={{ fontSize: 13, color: "var(--text, #1a1a1a)", fontWeight: 500 }}>
          {indicator.name}
        </div>
        <div style={{ fontSize: 11, color: "var(--text-muted, #7a7a72)", marginTop: 2 }}>
          {indicator.description}
        </div>
      </div>
      <div>
        <QuartileBar percentile={indicator.percentile} label={`${indicator.percentile}th percentile`} />
      </div>
      <div style={{ fontSize: 12, color: "var(--text-2, #3a3a32)", textAlign: "right" }}>
        <div style={{ fontWeight: 500 }}>{formattedVal}</div>
        <div style={{ fontSize: 11, color: "var(--text-muted, #7a7a72)" }}>
          {indicator.percentile}th percentile · {indicator.sample_window || ""}
        </div>
        {trendText && (
          <div style={{ fontSize: 11, color: "var(--text-muted, #7a7a72)", marginTop: 2 }}>
            {trendText}
          </div>
        )}
      </div>
    </div>
  );
}

function TileDetail({ tile }) {
  if (!tile.live) return null;
  const color = STATE_COLORS[tile.current_state] || "#1a1a1a";
  return (
    <section style={{
      padding: "26px 0 22px",
      borderTop: `2px solid ${color}`,
      marginTop: 20,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
        <h2 style={{
          fontFamily: "var(--font-display, Fraunces, Georgia, serif)",
          fontSize: 26,
          fontWeight: 400,
          margin: 0,
          letterSpacing: "-0.008em",
        }}>
          {tile.name}
        </h2>
        <div style={{ fontSize: 12, letterSpacing: "0.04em", color, fontWeight: 600 }}>
          {tile.current_state}
        </div>
      </div>
      <p style={{ fontSize: 13, color: "var(--text-muted, #7a7a72)", margin: "0 0 6px", maxWidth: 720 }}>
        {tile.description_long || tile.description_short}
      </p>
      <p style={{ fontSize: 12, color: "var(--text-2, #3a3a32)", margin: "0 0 16px", fontStyle: "italic" }}>
        Rule status: {tile.rule_status}
      </p>
      <div>
        {(tile.indicators || []).map((ind) => (
          <IndicatorRow key={ind.id} indicator={ind} />
        ))}
      </div>
    </section>
  );
}

export default function AssetAllocation() {
  const [calib, setCalib] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/methodology_calibration_v11.json?v=${Date.now()}`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => {
        if (!cancelled) setCalib(data);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      });
    return () => { cancelled = true; };
  }, []);

  if (error) {
    return (
      <main style={{ maxWidth: 880, margin: "0 auto", padding: "var(--space-12, 48px) var(--space-8, 24px)" }}>
        <div style={{ padding: 24, border: "1px solid var(--border)", borderRadius: 8 }}>
          <div style={{ fontSize: 12, color: "#7a1414", marginBottom: 6 }}>Calibration data didn't load</div>
          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{error}</div>
        </div>
      </main>
    );
  }

  if (!calib) {
    return (
      <main style={{ maxWidth: 1100, margin: "0 auto", padding: "var(--space-12, 48px) var(--space-8, 24px)" }}>
        <div style={{ fontSize: 12, color: "var(--text-muted, #7a7a72)" }}>Loading…</div>
      </main>
    );
  }

  const tiles = calib.tiles || [];
  const liveTiles = tiles.filter((t) => t.live);
  const gauge = calib.headline_gauge || {};

  return (
    <main style={{ maxWidth: 1100, margin: "0 auto", padding: "var(--space-12, 48px) var(--space-8, 28px) 64px" }}>

      {/* Editorial hero */}
      <section style={{ paddingBottom: 24, borderBottom: "1px solid var(--text, #1a1a1a)", marginBottom: 28 }}>
        <div style={{
          fontSize: 11,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          color: "var(--text-muted, #7a7a72)",
          marginBottom: 14,
          fontWeight: 600,
        }}>
          Cycle Mechanism Board · {formatDate(calib.as_of)}
        </div>
        <h1 style={{
          fontFamily: "var(--font-display, Fraunces, Georgia, serif)",
          fontSize: 42,
          fontWeight: 300,
          lineHeight: 1.12,
          letterSpacing: "-0.018em",
          color: "var(--text, #1a1a1a)",
          margin: "0 0 16px",
          maxWidth: 940,
        }}>
          {gauge.headline_sentence}
        </h1>
        <div style={{
          fontSize: 14,
          color: "var(--text-2, #3a3a32)",
          maxWidth: 760,
          lineHeight: 1.55,
        }}>
          {gauge.verdict}. Recovery Watch hidden — page activates if a fourth tile elevates
          or the S&amp;P enters a 15% drawdown. Read more in
          {" "}<a href="#methodology" style={{ color: "var(--accent, #1a1a1a)", textDecoration: "underline" }}>full methodology</a>.
        </div>
      </section>

      {/* 6-tile strip */}
      <TileStrip tiles={tiles} />

      {/* Detail blocks per live tile */}
      <div style={{ marginTop: 36 }}>
        {liveTiles
          .sort((a, b) => (a.order || 99) - (b.order || 99))
          .map((t) => <TileDetail key={t.id} tile={t} />)}
      </div>

      {/* Sprint 1 footer */}
      <div style={{
        marginTop: 48,
        paddingTop: 18,
        borderTop: "0.5px dashed var(--border)",
        fontSize: 11,
        color: "var(--text-muted, #7a7a72)",
        lineHeight: 1.6,
      }}>
        Sprint 1 ships three of six tiles. Funding (Sprint 2), Liquidity &amp; Policy (Sprint 4),
        and Positioning &amp; Breadth (Sprint 4) render as greyed placeholders above.
        Forward Warning tile and Recovery Watch ship in Sprint 3 and Sprint 5.
        Calibration source: <code>{calib.build_meta?.script || "v11 build script"}</code> · framework {calib.version || "v11"}.
      </div>
    </main>
  );
}
