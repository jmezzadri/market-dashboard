import React, { useEffect, useRef, useState } from 'react';

/**
 * CountUp — animates a numeric counter when it first comes into view.
 *
 * Design after the bug-#1168 / theme #12 race fix: when `to` is null/undefined
 * we render an em-dash, NEVER 0. When `to` arrives as a real number, we set
 * the visible value to that number on first paint (no 0→target animation
 * starting before data hydrates). Subsequent target changes (data refresh)
 * animate from the previous value to the new one.
 */
export default function CountUp({ to, duration = 700, format }) {
  const reduceMotion = typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  // Initial value: if `to` is already a real number on mount, use it (no 0 flash).
  const initialVal = (typeof to === 'number' && isFinite(to)) ? to : 0;
  const [val, setVal] = useState(initialVal);
  const ref = useRef(null);
  const lastRendered = useRef(initialVal);

  useEffect(() => {
    if (typeof to !== 'number' || !isFinite(to)) {
      // No data yet — keep last rendered value (or 0 for first mount).
      return;
    }
    if (reduceMotion) {
      setVal(to);
      lastRendered.current = to;
      return;
    }
    // If the element isn't on screen yet, just snap to value.
    // Animation only fires when the user can SEE the change.
    const el = ref.current;
    if (!el) {
      setVal(to);
      lastRendered.current = to;
      return;
    }
    const rect = el.getBoundingClientRect();
    const onScreen = rect.top < window.innerHeight && rect.bottom > 0;
    if (!onScreen) {
      // Snap. The IntersectionObserver below will animate when it scrolls in.
      setVal(to);
      lastRendered.current = to;
      return;
    }
    // Animate from lastRendered to new target.
    const start = lastRendered.current;
    const delta = to - start;
    if (delta === 0) return;
    const t0 = performance.now();
    let raf = 0;
    const tick = (t) => {
      const k = Math.min(1, (t - t0) / duration);
      const eased = 1 - Math.pow(1 - k, 4);
      setVal(start + delta * eased);
      if (k < 1) raf = requestAnimationFrame(tick);
      else lastRendered.current = to;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [to, duration, reduceMotion]);

  const fmt = format || ((v) => Math.round(v).toString());
  if (typeof to !== 'number' || !isFinite(to)) {
    return <span ref={ref} style={{ color: 'var(--ink-3)' }}>—</span>;
  }
  return <span ref={ref}>{fmt(val)}</span>;
}
