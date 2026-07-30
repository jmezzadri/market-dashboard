/* clientErrorLog — a small ring buffer of everything the browser complained
   about during this page visit.

   Why it exists: the bug_reports table has a console_errors column that has
   been empty since the table was created, because nothing was ever collecting
   them. A screenshot shows what broke; the console shows why. When a reporter
   files a bug we attach the last few errors so triage starts with evidence
   instead of a repro hunt.

   Installed once from main.jsx, before the app renders, so it catches boot-time
   failures too. Deliberately tiny and dependency-free:
     - keeps the last MAX entries only (a render loop must not eat memory)
     - never throws; a logger that breaks the page is worse than no logger
     - re-entrancy guarded, so our own console use can't recurse

   Shape of each entry (matches what Admin - Bugs renders):
     { at: ISO string, level: 'error'|'warn'|'uncaught'|'unhandled-rejection',
       message: string }
*/

const MAX = 25;
const buffer = [];
let installed = false;
let inside = false;

function push(level, message) {
  if (inside) return;
  inside = true;
  try {
    const text = String(message ?? '').slice(0, 1000);
    if (!text) return;
    buffer.push({ at: new Date().toISOString(), level, message: text });
    if (buffer.length > MAX) buffer.splice(0, buffer.length - MAX);
  } catch {
    /* a logging failure is never worth surfacing */
  } finally {
    inside = false;
  }
}

function stringifyArgs(args) {
  try {
    return Array.from(args)
      .map((a) => {
        if (a instanceof Error) return `${a.name}: ${a.message}`;
        if (typeof a === 'string') return a;
        if (typeof a === 'object' && a !== null) {
          try { return JSON.stringify(a); } catch { return Object.prototype.toString.call(a); }
        }
        return String(a);
      })
      .join(' ');
  } catch {
    return '';
  }
}

export function installClientErrorLog() {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  const origError = console.error;
  const origWarn = console.warn;

  console.error = function (...args) {
    push('error', stringifyArgs(args));
    return origError.apply(console, args);
  };
  console.warn = function (...args) {
    push('warn', stringifyArgs(args));
    return origWarn.apply(console, args);
  };

  window.addEventListener('error', (e) => {
    // Resource errors (a failed <img>/<script>) carry no message; name the target.
    if (e?.target && e.target !== window && e.target.tagName) {
      push('error', `Failed to load ${e.target.tagName.toLowerCase()}: ${e.target.src || e.target.href || '(no url)'}`);
      return;
    }
    const where = e?.filename ? ` (${e.filename}:${e.lineno ?? '?'})` : '';
    push('uncaught', `${e?.message || 'Uncaught error'}${where}`);
  }, true);

  window.addEventListener('unhandledrejection', (e) => {
    const r = e?.reason;
    push('unhandled-rejection', r instanceof Error ? `${r.name}: ${r.message}` : stringifyArgs([r]));
  });
}

/** Snapshot of the buffer, oldest first. Safe to call any time. */
export function getClientErrors() {
  return buffer.slice();
}
