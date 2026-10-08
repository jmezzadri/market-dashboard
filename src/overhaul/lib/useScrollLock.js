/* useScrollLock — the ONE place the site freezes page scrolling.

   Why it exists (Joe, 2026-10-08: "why does the page scroll break sometimes.
   I'm not able to scroll down unless I close and reopen the page"): five
   components each saved document.body.style.overflow, set 'hidden', and put
   the saved value back on close. That only works when locks never overlap.
   Open the release calendar, pick a release (the detail sheet saves 'hidden'),
   the calendar closes (page unlocked), then the detail sheet closes and puts
   'hidden' BACK — the page stays frozen until it is reloaded.

   A lock is a count, not a saved value: the page is frozen while at least one
   holder is active and released when the last one lets go, in any order. */

import { useEffect } from 'react';

let holders = 0;
let restore = '';

export default function useScrollLock(active) {
  useEffect(() => {
    if (!active || typeof document === 'undefined') return undefined;
    if (holders === 0) {
      restore = document.body.style.overflow === 'hidden' ? '' : document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }
    holders += 1;
    return () => {
      holders -= 1;
      if (holders <= 0) {
        holders = 0;
        document.body.style.overflow = restore;
      }
    };
  }, [active]);
}
