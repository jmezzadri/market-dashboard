// Lazy-loaded html2canvas-based page screenshot capture.
//
// We avoid adding html2canvas to package.json (keeps bundle lean + sidesteps
// the lock-file workaround in this repo) by loading it from a CDN on first
// use. The load is cached so subsequent captures skip the round trip.
//
// Returns a PNG Blob (or null if capture fails — the caller falls back to
// "no screenshot").

const HTML2CANVAS_CDN =
  "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js";

let loadPromise = null;

function loadHtml2Canvas() {
  if (window.html2canvas) return Promise.resolve(window.html2canvas);
  if (loadPromise) return loadPromise;
  loadPromise = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = HTML2CANVAS_CDN;
    s.async = true;
    s.onload = () => resolve(window.html2canvas);
    s.onerror = () => {
      loadPromise = null;
      reject(new Error("Failed to load html2canvas from CDN"));
    };
    document.head.appendChild(s);
  });
  return loadPromise;
}

/**
 * Capture the current viewport as a PNG Blob.
 * Returns null on any failure (CDN blocked, CORS taint, etc.).
 */
export async function captureScreenshot() {
  try {
    const html2canvas = await loadHtml2Canvas();
    const canvas = await html2canvas(document.body, {
      useCORS: true,
      allowTaint: false,
      logging: false,
      scale: Math.min(window.devicePixelRatio || 1, 2), // cap @2x to keep file size reasonable
      backgroundColor: null,
      // Only capture what's currently in the viewport (not the full scrollable page)
      // — this makes the screenshot a reliable "what the user is seeing right now"
      // instead of a 20,000-pixel-tall page.
      width: window.innerWidth,
      height: window.innerHeight,
      x: window.scrollX,
      y: window.scrollY,
    });
    return new Promise((resolve) => {
      canvas.toBlob((blob) => resolve(blob), "image/png", 0.92);
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[reportbug] screenshot capture failed:", err);
    return null;
  }
}

/**
 * Collect recent console.error messages. Installs a one-time hook on first
 * import; keeps a ring buffer of the last 20 errors.
 */
const ERROR_BUFFER = [];
const ERROR_BUFFER_MAX = 20;

if (typeof window !== "undefined" && !window.__mt_error_hook_installed) {
  window.__mt_error_hook_installed = true;
  const origError = console.error.bind(console);
  console.error = (...args) => {
    try {
      ERROR_BUFFER.push({
        t: new Date().toISOString(),
        msg: args.map((a) => {
          if (a instanceof Error) return `${a.name}: ${a.message}`;
          if (typeof a === "object") {
            try { return JSON.stringify(a).slice(0, 500); } catch { return String(a); }
          }
          return String(a);
        }).join(" "),
      });
      if (ERROR_BUFFER.length > ERROR_BUFFER_MAX) ERROR_BUFFER.shift();
    } catch { /* noop */ }
    origError(...args);
  };
  // Also capture uncaught window errors.
  window.addEventListener("error", (e) => {
    try {
      ERROR_BUFFER.push({
        t: new Date().toISOString(),
        msg: `window.onerror: ${e.message} @ ${e.filename}:${e.lineno}:${e.colno}`,
      });
      if (ERROR_BUFFER.length > ERROR_BUFFER_MAX) ERROR_BUFFER.shift();
    } catch { /* noop */ }
  });
  window.addEventListener("unhandledrejection", (e) => {
    try {
      const reason = e.reason instanceof Error ? `${e.reason.name}: ${e.reason.message}` : String(e.reason);
      ERROR_BUFFER.push({ t: new Date().toISOString(), msg: `unhandledrejection: ${reason}` });
      if (ERROR_BUFFER.length > ERROR_BUFFER_MAX) ERROR_BUFFER.shift();
    } catch { /* noop */ }
  });
}

export function getRecentConsoleErrors() {
  return [...ERROR_BUFFER];
}
