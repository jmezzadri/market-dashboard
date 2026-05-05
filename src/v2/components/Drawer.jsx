import React, { useEffect } from 'react';

export default function Drawer({ open, onClose, onBack, backLabel, children }) {
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose && onClose(); }
    if (open) {
      document.addEventListener('keydown', onKey);
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);
  return (
    <>
      <div className={`v2-scrim ${open ? 'open' : ''}`} onClick={onClose} aria-hidden={!open} />
      <aside className={`v2-drawer ${open ? 'open' : ''}`} role="dialog" aria-modal="true">
        <button className="v2-drawer-close" onClick={onClose} aria-label="Close">×</button>
        {onBack && (
          <button className="v2-back-btn" onClick={onBack}>← Back to {backLabel || 'previous'}</button>
        )}
        {children}
      </aside>
    </>
  );
}
