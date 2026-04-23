// MacroTilt brand component — V8+V2 Coutts-inspired monogram + Fraunces wordmark
// LOCKED 2026-04-22 (see /mnt/macrotilt/design-lab/index.html § 03 and § 12)
//
// Two exports:
//   <Monogram size={N} color="currentColor" /> — circle + MT (italic T, +6°)
//   <Wordmark  italicTilt /> — Fraunces small-caps "MACRO*TILT*"
//
// Fonts assumed present: Fraunces (shipped in /public/fonts/ via Phase 2 Step 1).
// Both components fall through to `currentColor` so they inherit CSS color by default.

import React from "react";

// ── V8 + V2 monogram construction ──
//   V8 = single 1.1px hairline ring (no inner echo)
//   V2 = italic T, rotated +6° inside the MT pair
// Canvas 100×100, circle r=47, font-size 42, text baseline y=64.

export function Monogram({
  size = 36,
  color = "currentColor",
  strokeWidth = 1.1,
  title = "MacroTilt",
  ...rest
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label={title}
      {...rest}
    >
      <title>{title}</title>
      <circle cx="50" cy="50" r="47" fill="none" stroke={color} strokeWidth={strokeWidth} />
      <text
        x="50"
        y="64"
        fontFamily='"Fraunces", Georgia, serif'
        fontSize="42"
        fontWeight="500"
        textAnchor="middle"
        fill={color}
        letterSpacing="-1"
        style={{ fontVariationSettings: "'opsz' 144" }}
      >
        <tspan>M</tspan>
        <tspan fontStyle="italic" dx="-3" transform="rotate(6)">T</tspan>
      </text>
    </svg>
  );
}

// ── Wordmark: Fraunces small-caps "MACROTILT" with italic lowercase-style T ──
export function Wordmark({
  size = 15,
  color = "currentColor",
  italicTilt = true,
  ...rest
}) {
  return (
    <span
      style={{
        fontFamily: '"Fraunces", Georgia, serif',
        fontWeight: 500,
        fontSize: size,
        letterSpacing: "0.14em",
        textTransform: "uppercase",
        color,
        fontVariationSettings: "'opsz' 60",
        display: "inline-block",
        lineHeight: 1,
        ...rest.style,
      }}
      {...rest}
    >
      MACRO
      <span
        style={{
          fontStyle: italicTilt ? "italic" : "normal",
          color: "var(--mt-accent-warm, #d9b27a)",
        }}
      >
        TILT
      </span>
    </span>
  );
}

// Default export for convenience
export default Monogram;
