import React, { useEffect, useRef, useState } from 'react';

export default function CountUp({ to, duration = 700, format }) {
  const reduceMotion = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const [val, setVal] = useState(reduceMotion ? to : 0);
  const ref = useRef(null);
  const started = useRef(false);
  useEffect(() => {
    if (reduceMotion || started.current) { setVal(to); return; }
    const obs = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting && !started.current) {
          started.current = true;
          const t0 = performance.now();
          const animate = (t) => {
            const k = Math.min(1, (t - t0) / duration);
            const eased = 1 - Math.pow(1 - k, 4);
            setVal(to * eased);
            if (k < 1) requestAnimationFrame(animate);
          };
          requestAnimationFrame(animate);
          obs.disconnect();
        }
      });
    }, { threshold: 0.4 });
    if (ref.current) obs.observe(ref.current);
    return () => obs.disconnect();
  }, [to, duration, reduceMotion]);
  const fmt = format || ((v) => Math.round(v).toString());
  return <span ref={ref}>{fmt(val)}</span>;
}
