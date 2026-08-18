/* DetailModal — the glass overlay every indicator / positioning drill opens in.

   Moved out of MacroPage.jsx 2026-08-18 so the home page can open the same
   drill without navigating to Macro. One implementation, so the two surfaces
   can never drift on escape handling, scroll locking, or the close affordance.

   Portals into `.mt-overhaul` (falling back to body) so the overlay escapes
   any transformed / overflow-hidden ancestor — the Reveal wrappers on Home
   are exactly that. */

import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';

export default function DetailModal({ onClose, children }) {
  useEffect(() => {
    const k = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', k); document.body.style.overflow = prev; };
  }, [onClose]);
  const target = (typeof document !== 'undefined' && (document.querySelector('.mt-overhaul') || document.body)) || null;
  if (!target) return null;
  return createPortal(
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(20,23,28,.55)', zIndex: 5000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', overflowY: 'auto', padding: '32px 16px 64px' }}>
      <div onClick={(e) => e.stopPropagation()} className="mt-glassmodal" style={{ position: 'relative', width: 'min(1080px, 95vw)' }}>
        <button onClick={onClose} aria-label="Close" style={{ position: 'absolute', top: 14, right: 16, border: 'none', background: 'none', fontSize: 26, lineHeight: 1, color: 'var(--mt-ink-3)', cursor: 'pointer', zIndex: 2 }}>×</button>
        {children}
      </div>
    </div>,
    target,
  );
}
