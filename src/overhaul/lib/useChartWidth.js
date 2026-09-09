import { useEffect, useRef, useState } from 'react';

/* Draw charts in REAL PIXELS — one SVG user unit = one CSS pixel.
 *
 * Joe, 2026-09-09, on Portfolio Lab: "all the different sized fonts we're
 * using?! It looks like a fucking kindergardener designed the page."
 *
 * Every chart on the site drew onto a fixed user-unit canvas (640 units for the
 * frontier, 940 for growth, 620 for the indicator charts) and was then stretched
 * with `width: 100%`. A viewBox scales EVERYTHING inside it, text included, so
 * one blameless small-label token rendered a fifth larger on one chart than on
 * the next — two sizes that appear nowhere on the six-step scale, on the same
 * page, from the same CSS class. Stroke weights and dot radii were inflated by
 * the same factors, which is the other half of why it read as crude.
 *
 * `check_fonts.mjs` could not see it: SVG elements have no offsetParent, so its
 * scan skipped them, and the DECLARED size was on the scale anyway. It now
 * measures the rendered size, and this hook is how a chart passes it: put the
 * ref on the chart's wrapper and use the returned width as the viewBox width.
 */
export default function useChartWidth(fallback = 940) {
  const ref = useRef(null);
  const [w, setW] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const set = (next) => { if (next > 0) setW(Math.round(next)); };
    set(el.getBoundingClientRect().width);
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(([e]) => set(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}
