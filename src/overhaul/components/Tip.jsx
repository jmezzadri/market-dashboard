/* Tip — portal-rendered hover tooltip.
   Replaces every "static caption" use case across the redesign. Wrap a
   child; show floating tip with rich content on hover. Portal-rendered to
   body so card overflow can't clip it.
   Ported from site-overhaul prototype shared.jsx. */

import React, { useState, useRef } from 'react';
import { createPortal } from 'react-dom';

export default function Tip({
  children,
  content,
  side = 'top',
  bare = false,
  block = false,
}) {
  const [hover, setHover] = useState(false);
  const [xy, setXY] = useState(null);
  const ref = useRef(null);

  const enter = () => {
    setHover(true);
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    if (side === 'right') setXY({ x: r.right + 8, y: r.top + r.height / 2, side });
    else if (side === 'left') setXY({ x: r.left - 8, y: r.top + r.height / 2, side });
    else if (side === 'bottom') setXY({ x: r.left + r.width / 2, y: r.bottom + 6, side });
    else setXY({ x: r.left + r.width / 2, y: r.top - 6, side: 'top' });
  };

  const tr = {
    top: 'translate(-50%, -100%)',
    bottom: 'translate(-50%, 0)',
    right: 'translate(0, -50%)',
    left: 'translate(-100%, -50%)',
  };

  return (
    <>
      <span
        ref={ref}
        onMouseEnter={enter}
        onMouseLeave={() => setHover(false)}
        onFocus={enter}
        onBlur={() => setHover(false)}
        style={{
          display: block ? 'block' : 'inline-flex',
          cursor: 'help',
          borderBottom: bare
            ? 'none'
            : '1px dotted color-mix(in oklab, currentColor 35%, transparent)',
        }}
      >
        {children}
      </span>
      {hover && xy && content && createPortal(
        <div
          role="tooltip"
          style={{
            position: 'fixed',
            left: xy.x,
            top: xy.y,
            transform: tr[xy.side] || tr.top,
            background: 'var(--mt-surface)',
            color: 'var(--mt-ink-0)',
            border: '1px solid var(--mt-line-1)',
            borderRadius: 8,
            padding: '8px 10px',
            fontSize: 12,
            lineHeight: 1.5,
            maxWidth: 280,
            fontFamily: 'var(--mt-font-ui)',
            boxShadow: '0 12px 32px rgba(0,0,0,.18)',
            pointerEvents: 'none',
            zIndex: 100000,
          }}
        >
          {content}
        </div>,
        document.body,
      )}
    </>
  );
}
