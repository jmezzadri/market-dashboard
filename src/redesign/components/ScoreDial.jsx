/**
 * ScoreDial — donut + center number used on scanner rows, IG ticker lists,
 * ticker page header. Stroke is var(--mt-accent); track is var(--mt-line-1).
 */
import React from "react";

export default function ScoreDial({ score = 0, max = 10, size = 44 }) {
  const pct = Math.max(0, Math.min(1, score / max));
  const r = (size - 8) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div className="lm-dialwrap" style={{ width: size, height: size, position: "relative", display: "inline-grid", placeItems: "center" }}>
      <svg viewBox={`0 0 ${size} ${size}`} className="lm-dial" style={{ width: size, height: size, transform: "none" }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--mt-line-1)" strokeWidth="3" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--mt-accent)"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: "stroke-dashoffset 600ms cubic-bezier(0.2,0.8,0.2,1)" }}
        />
      </svg>
      <span
        className="lm-dialnum num"
        style={{
          position: "absolute",
          fontSize: size * 0.34,
          fontFamily: "var(--mt-font-display)",
          fontWeight: 500,
          color: "var(--mt-ink-0)",
        }}
      >
        {score.toFixed(1)}
      </span>
    </div>
  );
}
