/* AnimatedNumber — tweens between values with ease-out-cubic.
   Use everywhere a live value renders so updates fade through rather than
   snap. Tween is fast (~520ms) so users never see a misleading interim
   value for long.
   Ported from site-overhaul prototype shared.jsx. */

import React, { useState, useEffect, useRef } from 'react';

export default function AnimatedNumber({
  value,
  format = (v) => v.toFixed(2),
  duration = 520,
  className = '',
  style,
  prefix = '',
  suffix = '',
}) {
  const [shown, setShown] = useState(value);
  const fromRef = useRef(value);
  const startRef = useRef(typeof performance !== 'undefined' ? performance.now() : 0);

  useEffect(() => {
    // Respect prefers-reduced-motion — snap to the new value.
    if (
      typeof window !== 'undefined' &&
      window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      setShown(value);
      return undefined;
    }
    fromRef.current = shown;
    startRef.current = performance.now();
    let raf;
    const tick = (t) => {
      const k = Math.min(1, (t - startRef.current) / duration);
      const e = 1 - Math.pow(1 - k, 3); // ease-out-cubic
      setShown(fromRef.current + (value - fromRef.current) * e);
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, duration]);

  return (
    <span className={`num ${className}`} style={style}>
      {prefix}
      {format(shown)}
      {suffix}
    </span>
  );
}
