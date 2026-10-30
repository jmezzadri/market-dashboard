/* useModalEscape — Escape closes the TOP pop-up only.

   2026-10-29 audit: every pop-up added its own window keydown listener, so
   with the release calendar open and a release opened on top of it, one press
   of Escape closed both — while a click on the backdrop closed only the top
   one. Every pop-up now registers here while it is open; Escape is handled by
   whichever registered last, so Escape and the backdrop behave the same way:
   one press, one layer.

   Usage: useModalEscape(isOpen, onClose). The latest onClose is always the
   one called, so a parent can pass an inline arrow. */

import { useEffect, useRef } from 'react';

const stack = [];

export default function useModalEscape(open, onClose) {
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    if (!open) return undefined;
    const token = {};
    stack.push(token);
    const onKey = (e) => {
      if (e.key !== 'Escape' || stack[stack.length - 1] !== token) return;
      close.current?.();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      const i = stack.lastIndexOf(token);
      if (i >= 0) stack.splice(i, 1);
    };
  }, [open]);
}
