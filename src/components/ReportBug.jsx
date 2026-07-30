/* ReportBug — the site-wide "Report a bug" widget.

   Mounted once by the overhaul Shell, so it is present on every route. The
   server side of this has existed since migration 004 (bug_reports table,
   private bug-screenshots bucket, submit_bug_report RPC, acknowledgment email,
   the /admin/bugs triage board) — everything except the surface a reporter
   actually touches. This is that surface.

   The flow, from the reporter's side:
     click "Report a bug"  ->  the page is photographed silently
                           ->  drag a box over the broken thing (optional)
                           ->  say what went wrong
                           ->  send; a numbered acknowledgment lands by email

   Design decisions worth keeping:
     - The button only renders for signed-in users, so name and email are
       already known and there is nothing to type but the problem itself.
     - The capture happens BEFORE the dialog opens, so the dialog is never in
       the picture. The whole widget also carries data-bug-ignore, which the
       rasteriser skips, as a second line of defence.
     - A failed capture never blocks the report. The dialog opens either way
       and just says the screenshot could not be taken.
     - The highlight is drawn onto the image at send time, not stored as
       coordinates, so the triage board needs no changes to show it.
*/

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from 'react-router-dom';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { useSession } from '../auth/useSession';
import { getClientErrors } from '../lib/clientErrorLog';
import { captureViewport, drawHighlight, canvasToBlob } from '../lib/captureScreenshot';
import './report-bug.css';

const MIN_DESCRIPTION = 8;

function extensionFor(blob) {
  if (!blob?.type) return 'png';
  if (blob.type.includes('jpeg')) return 'jpg';
  if (blob.type.includes('webp')) return 'webp';
  return 'png';
}

function titleFrom(description) {
  const first = String(description || '').trim().split(/\r?\n/)[0] || '';
  return first.length > 90 ? `${first.slice(0, 87)}…` : first;
}

export default function ReportBug() {
  const { session, user } = useSession();
  const location = useLocation();

  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState('idle'); // idle | capturing | form | sending | done
  const [description, setDescription] = useState('');
  const [shot, setShot] = useState(null);       // HTMLCanvasElement | null
  const [shotUrl, setShotUrl] = useState(null); // preview data URL
  const [box, setBox] = useState(null);         // highlight, in canvas pixels
  const [drag, setDrag] = useState(null);
  const [error, setError] = useState(null);
  const [filedNumber, setFiledNumber] = useState(null);
  const [capturedPath, setCapturedPath] = useState('');

  const previewRef = useRef(null);
  const textareaRef = useRef(null);

  // ── open: photograph the page first, then show the dialog ────────────────
  const start = useCallback(async () => {
    setError(null);
    setBox(null);
    setDescription('');
    setFiledNumber(null);
    setCapturedPath(`${window.location.pathname}${window.location.search}`);
    setPhase('capturing');
    setOpen(true);

    const canvas = await captureViewport();
    setShot(canvas);
    try {
      setShotUrl(canvas ? canvas.toDataURL('image/png') : null);
    } catch {
      setShotUrl(null);
    }
    setPhase('form');
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    setPhase('idle');
    setShot(null);
    setShotUrl(null);
    setBox(null);
    setDrag(null);
    setError(null);
  }, []);

  // Escape closes; the dialog owns the key only while it is open.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape' && phase !== 'sending') close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, phase, close]);

  // Focus the one field that matters as soon as the dialog is usable.
  useEffect(() => {
    if (phase === 'form') textareaRef.current?.focus();
  }, [phase]);

  // ── highlight drag, in canvas pixel space ────────────────────────────────
  const toCanvasPoint = (e) => {
    const el = previewRef.current;
    if (!el || !shot) return null;
    const r = el.getBoundingClientRect();
    const scaleX = shot.width / r.width;
    const scaleY = shot.height / r.height;
    const x = Math.max(0, Math.min(shot.width, (e.clientX - r.left) * scaleX));
    const y = Math.max(0, Math.min(shot.height, (e.clientY - r.top) * scaleY));
    return { x, y };
  };

  const onPointerDown = (e) => {
    if (!shot || phase === 'sending') return;
    const p = toCanvasPoint(e);
    if (!p) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setDrag({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
    setBox(null);
  };
  const onPointerMove = (e) => {
    if (!drag) return;
    const p = toCanvasPoint(e);
    if (!p) return;
    setDrag((d) => ({ ...d, x1: p.x, y1: p.y }));
  };
  const onPointerUp = () => {
    if (!drag) return;
    const x = Math.min(drag.x0, drag.x1);
    const y = Math.min(drag.y0, drag.y1);
    const w = Math.abs(drag.x1 - drag.x0);
    const h = Math.abs(drag.y1 - drag.y0);
    setDrag(null);
    setBox(w > 6 && h > 6 ? { x, y, w, h } : null);
  };

  // The live box, in preview-element percentages, so it tracks any resize.
  const liveBox = (() => {
    const b = drag
      ? {
        x: Math.min(drag.x0, drag.x1),
        y: Math.min(drag.y0, drag.y1),
        w: Math.abs(drag.x1 - drag.x0),
        h: Math.abs(drag.y1 - drag.y0),
      }
      : box;
    if (!b || !shot || b.w < 2 || b.h < 2) return null;
    return {
      left: `${(b.x / shot.width) * 100}%`,
      top: `${(b.y / shot.height) * 100}%`,
      width: `${(b.w / shot.width) * 100}%`,
      height: `${(b.h / shot.height) * 100}%`,
    };
  })();

  // ── send ─────────────────────────────────────────────────────────────────
  const send = async () => {
    if (description.trim().length < MIN_DESCRIPTION) {
      setError('Tell us a little more about what went wrong.');
      return;
    }
    if (!isSupabaseConfigured) {
      setError('The site is not connected to its database right now, so the report cannot be filed.');
      return;
    }
    setError(null);
    setPhase('sending');

    let screenshotPath = null;
    try {
      if (shot) {
        const blob = await canvasToBlob(drawHighlight(shot, box));
        if (blob) {
          const path = `${crypto.randomUUID()}/${Date.now()}.${extensionFor(blob)}`;
          const { error: upErr } = await supabase.storage
            .from('bug-screenshots')
            .upload(path, blob, { contentType: blob.type, upsert: false });
          // An upload failure is logged, not fatal — the words matter more
          // than the picture.
          if (upErr) console.warn('[report-a-bug] screenshot upload failed:', upErr.message);
          else screenshotPath = path;
        }
      }

      const { data, error: rpcErr } = await supabase.rpc('submit_bug_report', {
        p_reporter_email: user?.email || '',
        p_description: description.trim(),
        p_title: titleFrom(description),
        p_url_hash: capturedPath,
        p_url_full: window.location.href,
        p_user_agent: navigator.userAgent,
        p_viewport: `${window.innerWidth}x${window.innerHeight}`,
        p_build_sha: import.meta.env.VITE_BUILD_SHA || '',
        p_console_errors: getClientErrors(),
        p_reporter_name: user?.user_metadata?.full_name || null,
        p_screenshot_path: screenshotPath,
      });

      if (rpcErr) throw rpcErr;

      const row = Array.isArray(data) ? data[0] : data;
      setFiledNumber(row?.report_number ?? null);
      setPhase('done');

      // Acknowledgment email. Fire and forget — a mail hiccup must not make a
      // filed report look unfiled.
      if (row?.id) {
        supabase.functions
          .invoke('submit-bug-report', { body: { report_id: row.id } })
          .catch((e) => console.warn('[report-a-bug] ack email failed:', e?.message || e));
      }
    } catch (e) {
      console.warn('[report-a-bug] submit failed:', e?.message || e);
      setError(e?.message || 'The report could not be sent. Please try again.');
      setPhase('form');
    }
  };

  // Signed-in only, and never on the sign-in screen itself.
  if (!session || location.pathname === '/signin') return null;

  const errorCount = getClientErrors().length;

  // Rendered into <body>, not into the shell. The shell chrome uses
  // backdrop-filter, and any ancestor with a filter or transform becomes the
  // containing block for `position: fixed` descendants — which pinned this
  // widget to the shell's box instead of the viewport, visibly offsetting the
  // whole dialog once the page overflowed horizontally at 390px. Escaping to
  // <body> is the fix; the widget carries its own theme tokens (report-bug.css)
  // because it no longer sits inside .mt-overhaul.
  return createPortal(
    <div className="rb-root" data-bug-ignore="">
      {!open && (
        <button type="button" className="rb-launch" onClick={start} title="Report a problem on this page">
          <svg viewBox="0 0 20 20" aria-hidden="true" className="rb-launch-icon">
            <path
              d="M10 2.6a3 3 0 0 1 2.7 1.7l.5.1a4 4 0 0 1 2.6 3.1h1.3a.8.8 0 0 1 0 1.6h-1.2v1.3h1.2a.8.8 0 0 1 0 1.6h-1.3a5.6 5.6 0 0 1-11 0H3.5a.8.8 0 0 1 0-1.6h1.2V9.1H3.5a.8.8 0 0 1 0-1.6h1.3a4 4 0 0 1 2.6-3.1l.5-.1A3 3 0 0 1 10 2.6Zm0 3.6a4 4 0 0 0-4 4v1.4a4 4 0 1 0 8 0V10.2a4 4 0 0 0-4-4Z"
              fill="currentColor"
            />
          </svg>
          Report a bug
        </button>
      )}

      {open && (
        <div className="rb-veil" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget && phase !== 'sending') close(); }}>
          <div className="rb-dialog" role="dialog" aria-modal="true" aria-label="Report a bug">
            <div className="rb-head">
              <h2 className="rb-title">Report a bug</h2>
              <button type="button" className="rb-x" onClick={close} disabled={phase === 'sending'} aria-label="Close">×</button>
            </div>

            {phase === 'capturing' && (
              <div className="rb-body">
                <div className="rb-capturing">Taking a picture of this page…</div>
              </div>
            )}

            {(phase === 'form' || phase === 'sending') && (
              <div className="rb-body">
                {shotUrl ? (
                  <>
                    <div className="rb-shotlabel">
                      <span>Drag on the picture to point at the problem.</span>
                      {box && (
                        <button type="button" className="rb-clear" onClick={() => setBox(null)}>Clear</button>
                      )}
                    </div>
                    <div
                      className="rb-preview"
                      ref={previewRef}
                      onPointerDown={onPointerDown}
                      onPointerMove={onPointerMove}
                      onPointerUp={onPointerUp}
                      onPointerCancel={onPointerUp}
                    >
                      <img src={shotUrl} alt="Screenshot of the page you are reporting" draggable="false" />
                      {liveBox && <div className="rb-box" style={liveBox} />}
                    </div>
                  </>
                ) : (
                  <div className="rb-noshot">
                    The screenshot could not be taken on this page. Describe what you see and we will
                    take it from there.
                  </div>
                )}

                <label className="rb-label" htmlFor="rb-desc">What went wrong?</label>
                <textarea
                  id="rb-desc"
                  ref={textareaRef}
                  className="rb-textarea"
                  rows={4}
                  value={description}
                  disabled={phase === 'sending'}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="What did you expect to see, and what did you see instead?"
                />

                <div className="rb-meta">
                  {errorCount > 0
                    ? `Sent with this report: the picture above, the page address, your screen size, and ${errorCount} browser error${errorCount === 1 ? '' : 's'}.`
                    : 'Sent with this report: the picture above, the page address, and your screen size.'}
                </div>

                {error && <div className="rb-error">{error}</div>}
              </div>
            )}

            {(phase === 'form' || phase === 'sending') && (
              <div className="rb-foot">
                <button type="button" className="rb-cancel" onClick={close} disabled={phase === 'sending'}>Cancel</button>
                <button type="button" className="rb-send" onClick={send} disabled={phase === 'sending'}>
                  {phase === 'sending' ? 'Sending…' : 'Send report'}
                </button>
              </div>
            )}

            {phase === 'done' && (
              <div className="rb-body">
                <div className="rb-done">
                  <div className="rb-done-num">{filedNumber ? `Bug #${filedNumber}` : 'Report filed'}</div>
                  <p className="rb-done-copy">
                    Thanks — it is in the queue. A confirmation is on its way to {user?.email}, and you
                    will get another note when it is fixed.
                  </p>
                  <button type="button" className="rb-send" onClick={close}>Done</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
}
