/* captureScreenshot — draw what the reporter is looking at into a PNG.

   Used only by the Report-a-bug widget. html2canvas-pro is loaded with a
   dynamic import so the ~180 KB rasteriser is a separate chunk that never
   touches the first paint of the site — it downloads the moment someone
   clicks "Report a bug", and never otherwise.

   Three things this file exists to get right:

   1. VIEWPORT, NOT DOCUMENT. A reporter means "this screen", not "this
      20,000-pixel-tall page". We crop to the current scroll window.

   2. STICKY / FIXED CHROME. html2canvas re-renders the DOM from scratch, and
      in that render a `position: sticky` top nav sits at its *document*
      position — so on a scrolled page the nav vanishes from the crop and the
      shot looks nothing like the screen. Before capturing we measure every
      sticky/fixed element and, in the cloned document, pin it to the place the
      user actually sees it. The measurement attributes are removed from the
      live DOM in a finally block, always.

   3. NEVER BLOCK THE REPORT. Rasterising a heavy page can fail (a tainted
      canvas, an unsupported filter, a slow font). Every failure path here
      resolves to null, and the widget files the report without an image.
*/

const CAPTURE_TIMEOUT_MS = 12000;
const MAX_BYTES = 4.5 * 1024 * 1024; // bucket cap is 5 MB; leave headroom.

/* Resolve any CSS colour the browser understands (including `color-mix(...)`,
   which the rasteriser cannot parse) down to a plain opaque rgb, composited
   over the page background. Returns null for a fully transparent colour.

   This is what keeps a translucent sticky nav from turning into a see-through
   hole in the capture: the live nav is `color-mix(... 88%, transparent)` over a
   blurred backdrop, and neither the colour function nor the blur survives
   re-rendering — so the page content underneath used to bleed straight through
   it. We hand the rasteriser the flat colour the eye actually sees instead. */
function flattenColor(color, base) {
  try {
    const c = document.createElement('canvas');
    c.width = 1; c.height = 1;
    const ctx = c.getContext('2d', { willReadFrequently: true });

    // Alpha first, on a transparent canvas.
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 1, 1);
    const alpha = ctx.getImageData(0, 0, 1, 1).data[3];
    if (alpha === 0) return null;

    // Then the composite over the page background.
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, 1, 1);
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    return `rgb(${r}, ${g}, ${b})`;
  } catch {
    return null;
  }
}

/* Measure sticky/fixed elements and tag them so the clone can be corrected.

   Measuring the sticky DISPLACEMENT is the fiddly part. `offsetTop` is not a
   way out: Chrome reports the used position there, sticky offset included, so
   it reads identical to getBoundingClientRect and the displacement computes as
   zero. So we measure twice — once as the element is painted, then again with
   `position: static` forced, which is its place in the flow. Both passes are
   batched, so this costs two reflows for the whole page, not two per element.
   Un-sticking an element does not move anything else: a sticky box occupies its
   flow space either way. */
function pinStickyElements(base) {
  const pins = [];
  try {
    const all = document.body.querySelectorAll('*');
    const limit = Math.min(all.length, 6000);
    const found = [];

    for (let i = 0; i < limit; i++) {
      const el = all[i];
      let cs;
      try { cs = window.getComputedStyle(el); } catch { continue; }
      if (cs.position !== 'fixed' && cs.position !== 'sticky') continue;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const zRaw = parseInt(cs.zIndex, 10);
      found.push({
        el,
        id: `pin${i}`,
        sticky: cs.position === 'sticky',
        rect: r,
        zIndex: Number.isFinite(zRaw) ? Math.max(zRaw, 40) : 40,
        background: flattenColor(cs.backgroundColor, base),
        savedStyle: el.getAttribute('style'),
      });
    }
    if (!found.length) return pins;

    // Pass 2 — un-stick everything at once, then read the flow positions.
    found.forEach((f) => { if (f.sticky) f.el.style.setProperty('position', 'static', 'important'); });
    found.forEach((f) => { f.flow = f.sticky ? f.el.getBoundingClientRect() : f.rect; });
    found.forEach((f) => {
      if (!f.sticky) return;
      if (f.savedStyle === null) f.el.removeAttribute('style');
      else f.el.setAttribute('style', f.savedStyle);
    });

    found.forEach((f) => {
      f.el.setAttribute('data-bugshot-pin', f.id);
      pins.push({
        el: f.el,
        id: f.id,
        sticky: f.sticky,
        // Where it is painted, in document coordinates (used for `fixed`).
        top: f.rect.top + window.scrollY,
        left: f.rect.left + window.scrollX,
        // How far the sticky offset pushed it out of the flow.
        shiftY: f.rect.top - f.flow.top,
        shiftX: f.rect.left - f.flow.left,
        width: f.rect.width,
        height: f.rect.height,
        zIndex: f.zIndex,
        background: f.background,
      });
    });
  } catch {
    /* measurement is best-effort */
  }
  return pins;
}

function unpinStickyElements(pins) {
  pins.forEach((p) => { try { p.el.removeAttribute('data-bugshot-pin'); } catch { /* gone */ } });
}

function applyPinsToClone(doc, pins) {
  pins.forEach((p) => {
    const c = doc.querySelector(`[data-bugshot-pin="${p.id}"]`);
    if (!c) return;
    if (p.sticky) {
      // A sticky bar still occupies space in the flow. Pulling it out with
      // `absolute` would slide every following row up by the bar's height —
      // the capture would be correct-looking but shifted. `relative` keeps the
      // space and just paints it where the reader sees it.
      c.style.setProperty('position', 'relative', 'important');
      c.style.setProperty('top', `${p.shiftY}px`, 'important');
      c.style.setProperty('left', `${p.shiftX}px`, 'important');
    } else {
      c.style.setProperty('position', 'absolute', 'important');
      c.style.setProperty('top', `${p.top}px`, 'important');
      c.style.setProperty('left', `${p.left}px`, 'important');
      c.style.setProperty('width', `${p.width}px`, 'important');
      c.style.setProperty('right', 'auto', 'important');
      c.style.setProperty('bottom', 'auto', 'important');
    }
    c.style.setProperty('z-index', String(p.zIndex), 'important');
    // A pinned bar sits on top of page content, so it has to be opaque or the
    // content shows through it. The blur it normally leans on does not render.
    if (p.background) c.style.setProperty('background', p.background, 'important');
    c.style.setProperty('-webkit-backdrop-filter', 'none', 'important');
    c.style.setProperty('backdrop-filter', 'none', 'important');
  });
}

function pageBackground() {
  try {
    const scope = document.querySelector('.mt-overhaul') || document.body;
    const bg = window.getComputedStyle(scope).backgroundColor;
    if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') return bg;
  } catch { /* fall through */ }
  return '#ffffff';
}

/**
 * Rasterise the current viewport.
 * @returns {Promise<HTMLCanvasElement|null>} null when capture is not possible.
 */
export async function captureViewport() {
  if (typeof window === 'undefined' || !document.body) return null;

  let pins = [];
  try {
    const mod = await import('html2canvas-pro');
    const html2canvas = mod.default || mod;

    const base = pageBackground();
    pins = pinStickyElements(base);

    const shot = html2canvas(document.body, {
      backgroundColor: base,
      scale: 1,
      useCORS: true,
      logging: false,
      imageTimeout: 5000,
      removeContainer: true,
      // Anything the widget itself renders is excluded, so the report never
      // contains a picture of the report button.
      ignoreElements: (el) => el?.hasAttribute?.('data-bug-ignore'),
      x: window.scrollX,
      y: window.scrollY,
      width: window.innerWidth,
      height: window.innerHeight,
      onclone: (doc) => applyPinsToClone(doc, pins),
    });

    const timeout = new Promise((resolve) => setTimeout(() => resolve(null), CAPTURE_TIMEOUT_MS));
    const canvas = await Promise.race([shot, timeout]);
    return canvas || null;
  } catch (err) {
    console.warn('[report-a-bug] screenshot capture failed:', err?.message || err);
    return null;
  } finally {
    unpinStickyElements(pins);
  }
}

/**
 * Draw the reporter's highlight box onto a copy of the capture: everything
 * outside the box is dimmed, the box itself gets a 3px outline. Returns a new
 * canvas; the original is left untouched so the box can be redrawn or cleared.
 *
 * @param {HTMLCanvasElement} source
 * @param {{x:number,y:number,w:number,h:number}|null} box  in source-canvas pixels
 */
export function drawHighlight(source, box) {
  const out = document.createElement('canvas');
  out.width = source.width;
  out.height = source.height;
  const ctx = out.getContext('2d');
  ctx.drawImage(source, 0, 0);
  if (!box || box.w < 4 || box.h < 4) return out;

  // Dim everything except the box (four rectangles around it).
  ctx.fillStyle = 'rgba(12, 18, 24, 0.42)';
  ctx.fillRect(0, 0, out.width, box.y);
  ctx.fillRect(0, box.y + box.h, out.width, out.height - (box.y + box.h));
  ctx.fillRect(0, box.y, box.x, box.h);
  ctx.fillRect(box.x + box.w, box.y, out.width - (box.x + box.w), box.h);

  ctx.lineWidth = 3;
  ctx.strokeStyle = '#C1394F';
  ctx.strokeRect(box.x + 1.5, box.y + 1.5, box.w - 3, box.h - 3);
  return out;
}

/** Canvas -> PNG blob, falling back to JPEG if the PNG busts the bucket cap. */
export function canvasToBlob(canvas) {
  return new Promise((resolve) => {
    if (!canvas) { resolve(null); return; }
    try {
      canvas.toBlob((png) => {
        if (png && png.size <= MAX_BYTES) { resolve(png); return; }
        canvas.toBlob(
          (jpg) => resolve(jpg && jpg.size <= MAX_BYTES ? jpg : null),
          'image/jpeg',
          0.82,
        );
      }, 'image/png');
    } catch {
      resolve(null);
    }
  });
}
