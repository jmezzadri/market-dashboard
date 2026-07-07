/* TopNav — alternate nav layout, shown when data-mt-sidebar="top" AND on
   small screens (responsive.css reveals it below 900px while hiding the
   sidebar). Ported from site-overhaul prototype lm-core.jsx.

   It now carries the auth control too: on mobile the sidebar (which is the
   only place the "Sign in" / "Sign out" control lived) is hidden, so without
   this slot a phone user had no way to sign in at all. */

import React from 'react';
import { NavLink } from 'react-router-dom';
import { useSession } from '../../auth/useSession';
import { supabase } from '../../lib/supabase';

const ITEMS = [
  { to: '/', label: 'Home', end: true },
  { to: '/macro', label: 'Macro' },
  { to: '/scanner', label: 'Scanner' },
  { to: '/paper', label: 'Paper' },
  { to: '/methodology', label: 'Methodology' },
  { to: '/admin/data', label: 'Data' },
];

export default function TopNav() {
  const { user, loading } = useSession();
  const signedIn = !!user;
  const email = user?.email || '';

  async function handleSignOut() {
    try { await supabase.auth.signOut(); } catch (e) { /* best effort */ }
    if (typeof window !== 'undefined') window.location.assign('/');
  }

  return (
    <div className="mt-topnav" aria-label="Primary">
      {ITEMS.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          className={({ isActive }) => `mt-pill ${isActive ? 'on' : ''}`}
        >
          {item.label}
        </NavLink>
      ))}

      {/* Auth slot — pushed to the right edge of the nav row. */}
      <div className="mt-topnav-auth">
        {loading ? (
          <span style={{ opacity: 0.6, fontSize: 12 }}>…</span>
        ) : signedIn ? (
          <>
            <span className="mt-topnav-email" title={email}>{email}</span>
            <button type="button" className="mt-topnav-signout" onClick={handleSignOut}>
              Sign out
            </button>
          </>
        ) : (
          <NavLink className="mt-topnav-signin" to="/signin">Sign in →</NavLink>
        )}
      </div>
    </div>
  );
}
