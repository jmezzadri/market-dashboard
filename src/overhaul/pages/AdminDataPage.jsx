/* AdminDataPage — overhaul-shell wrapper for the legacy admin-data flow.

   Joe's expectation: /admin/data lands on the THREE-TILE landing page
   (Polygon Massive · Unusual Whales · Data Health). Clicking a tile
   drills into the relevant vendor or cross-vendor view.

   Legacy plumbing: AdminLanding sets window.location.hash to one of
     #admin?view=massive   → AdminMassive
     #admin?view=uw        → AdminUsage     (the UW chart / feed / broken-status page Joe wants)
     #admin?view=health    → AdminDataHealth (cross-vendor scorecard)
   and the legacy App.jsx watches hashchange to swap the rendered view.
   The Tweaks panel + page header don't interfere — they read different
   keys.

   This wrapper does exactly what App.jsx does for /admin: read the
   hash on mount + on every hashchange, render the matching component.
   AdminLanding's tile clicks then "just work" without modification.

   Wrapped in <div className="mt-pagebody mt-fade"> so the page fade-in
   + horizontal padding match the rest of the overhaul shell. */

import React, { useEffect, useState } from 'react';
import AdminLanding from '../../AdminLanding';
import AdminUsage from '../../AdminUsage';
import AdminMassive from '../../AdminMassive';
import AdminDataHealth from '../../AdminDataHealth';

function readView() {
  if (typeof window === 'undefined') return null;
  const qs = (window.location.hash || '').replace(/^#/, '').split('?')[1] || '';
  return new URLSearchParams(qs).get('view');
}

export default function AdminDataPage() {
  const [view, setView] = useState(readView);

  useEffect(() => {
    const onHashChange = () => {
      const next = readView();
      setView((cur) => (cur === next ? cur : next));
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  let Inner = AdminLanding;
  if (view === 'uw') Inner = AdminUsage;
  else if (view === 'massive') Inner = AdminMassive;
  else if (view === 'health') Inner = AdminDataHealth;

  return (
    <div className="mt-pagebody mt-fade">
      <Inner />
    </div>
  );
}
