/* PercentileBar — shows where today's reading sits in the 5-year (or full)
   distribution of values. Decile bar with a marker at the current rank. */

import React from 'react';

export default function PercentileBar({ pct, direction = 'hw', height = 14 }) {
  const safePct = pct == null ? null : Math.max(0, Math.min(100, pct));

  // Stripe coloring depends on direction.
  // hw (high warns): low = green, high = red.
  // lw (low warns):  low = red,   high = green.
  // bw:              tails red, middle green.
  function colorAt(p) {
    if (direction === 'bw') {
      if (p >= 85 || p <= 15) return 'var(--mt-down)';
      if (p >= 75 || p <= 25) return 'var(--mt-warn)';
      return 'var(--mt-up)';
    }
    if (direction === 'lw') {
      if (p <= 15) return 'var(--mt-down)';
      if (p <= 25) return 'var(--mt-warn)';
      if (p >= 75) return 'var(--mt-up)';
      return 'var(--mt-ink-3)';
    }
    if (p >= 85) return 'var(--mt-down)';
    if (p >= 75) return 'var(--mt-warn)';
    if (p <= 25) return 'var(--mt-up)';
    return 'var(--mt-ink-3)';
  }

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height,
        borderRadius: 999,
        overflow: 'visible',
        background: 'transparent',
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: 999,
          background:
            direction === 'bw'
              ? 'linear-gradient(90deg, var(--mt-down), var(--mt-warn) 20%, var(--mt-up) 50%, var(--mt-warn) 80%, var(--mt-down))'
              : direction === 'lw'
                ? 'linear-gradient(90deg, var(--mt-down), var(--mt-warn) 25%, var(--mt-ink-3) 50%, var(--mt-up) 100%)'
                : 'linear-gradient(90deg, var(--mt-up), var(--mt-ink-3) 50%, var(--mt-warn) 75%, var(--mt-down))',
          opacity: 0.45,
        }}
      />
      {safePct != null && (
        <div
          style={{
            position: 'absolute',
            left: `${safePct}%`,
            top: -4,
            bottom: -4,
            width: 3,
            background: colorAt(safePct),
            borderRadius: 2,
            transform: 'translateX(-50%)',
            boxShadow: '0 0 0 2px var(--mt-surface)',
          }}
          aria-label={`${safePct}th percentile`}
        />
      )}
      <div
        style={{
          position: 'absolute',
          top: '100%',
          left: 0,
          right: 0,
          display: 'flex',
          justifyContent: 'space-between',
          marginTop: 4,
          fontSize: 10.5,
          color: 'var(--mt-ink-3)',
        }}
        className="num"
      >
        <span>0</span>
        <span>25</span>
        <span>50</span>
        <span>75</span>
        <span>100</span>
      </div>
    </div>
  );
}
