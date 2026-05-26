/**
 * IndicatorCard — used on the Macro grid view and in summary contexts.
 * Click → opens IndicatorDetail inline below the section.
 */
import React from "react";
import { Sparkline, FreshnessChip } from "../atoms";

export default function IndicatorCard({ ind, onClick, compact = false }) {
  const accent =
    ind.state === "extreme"
      ? "var(--mt-down)"
      : ind.state === "elevated"
      ? "var(--mt-warn)"
      : "var(--mt-up)";
  return (
    <button className={`lm-indcard lm-indcard--${ind.state}`} onClick={onClick}>
      <div className="lm-indtop">
        <span className="lm-indcat">{ind.domain}</span>
        <FreshnessChip state={ind.fresh} asOf={ind.asOf} />
      </div>
      <div className="lm-indname">{ind.name}</div>
      {!compact && (
        <Sparkline
          data={ind.trend}
          width={220}
          height={32}
          stroke={accent}
          fill={accent}
          area
          showDot={false}
        />
      )}
      <div className="lm-indvalrow">
        <span className="lm-indval num">
          {ind.value > 1000
            ? ind.value.toLocaleString()
            : ind.value.toFixed(ind.value > 100 ? 0 : 2)}
          <span className="lm-indunit">{ind.unit}</span>
        </span>
        <span className={`lm-indchg num ${ind.dir === "up" ? "up" : "down"}`}>
          {ind.dir === "up" ? "▲" : "▼"} {Math.abs(ind.delta).toFixed(2)}
        </span>
      </div>
      <div className="lm-indfoot">
        <span className="num">5Y</span>
        <span className={`lm-indfbar lm-indfbar--${ind.state}`}>
          <span style={{ width: `${ind.pct}%` }} />
        </span>
        <span className={`num lm-indpct--${ind.state}`}>{ind.pct}ᵗʰ</span>
      </div>
    </button>
  );
}
