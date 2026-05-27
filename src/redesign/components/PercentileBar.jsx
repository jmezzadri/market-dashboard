/**
 * PercentileBar — 20-bin distribution visualisation with a needle marker.
 */
import React from "react";

export default function PercentileBar({ value, accent }) {
  return (
    <div className="lm-pctile">
      <svg viewBox="0 0 200 40" width="100%" height="40">
        {Array.from({ length: 20 }, (_, i) => {
          const distFromCenter = Math.abs(i - 10);
          const h = 4 + Math.max(0, 30 - distFromCenter * 3) + Math.sin(i * 7.31) * 2;
          const isYou = value / 5 >= i && value / 5 < i + 1;
          return (
            <rect
              key={i}
              x={i * 10 + 1}
              y={36 - h}
              width="8"
              height={h}
              fill={isYou ? accent : "color-mix(in oklab, currentColor 10%, transparent)"}
              rx="1.5"
            />
          );
        })}
      </svg>
      <div className="lm-pctilelabels">
        <span>0</span><span>25</span><span>50</span><span>75</span><span>100</span>
      </div>
      <div className="lm-pctilemarker">
        <span style={{ left: `${value}%`, background: accent }} />
        <span
          className="lm-pctilebadge"
          style={{ left: `${value}%`, color: accent, borderColor: accent }}
        >
          today · {value}ᵗʰ
        </span>
      </div>
    </div>
  );
}
