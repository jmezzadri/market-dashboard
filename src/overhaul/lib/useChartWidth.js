import { useCallback, useEffect, useRef, useState } from 'react';

/* Draw charts in REAL PIXELS — one SVG user unit = one CSS pixel.
 *
 * Joe, 2026-09-09: "all the different sized fonts we're
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
 *
 * 2026-10-28: the ref is a CALLBACK ref. The old useRef + mount-time effect
 * measured once, at first render — and a chart that renders its empty state
 * first (the Trade Idea chart waits for its series) attached the wrapper only
 * later, so the effect had already run against nothing and the chart stayed at
 * its fallback width: 720 units squeezed into a 358px phone column, every label
 * at half size. The callback fires whenever the wrapper actually mounts. The
 * returned ref still exposes `.current` for the hover readouts that read the
 * wrapper's box.
 */
export default function useChartWidth(fallback = 940) {
  const nodeRef = useRef(null);
  const [node, setNode] = useState(null);
  const [w, setW] = useState(fallback);
  const attach = useCallback((el) => { nodeRef.current = el; setNode(el); }, []);
  if (!Object.prototype.hasOwnProperty.call(attach, 'current')) {
    Object.defineProperty(attach, 'current', { get: () => nodeRef.current });
  }
  useEffect(() => {
    if (!node) return undefined;
    const set = (next) => { if (next > 0) setW(Math.round(next)); };
    set(node.getBoundingClientRect().width);
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(([e]) => set(e.contentRect.width));
    ro.observe(node);
    return () => ro.disconnect();
  }, [node]);
  return [attach, w];
}
