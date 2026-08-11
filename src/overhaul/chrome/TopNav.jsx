/* TopNav — the shared cream (v12) top navigation. Replaces the retired
   sidebar as the site's primary chrome. Wordmark links Home; the primary
   routes are text links; auth sits on the right. Admin · Bugs is preserved
   as a low-emphasis link so retiring the sidebar loses no reachability.
   Cream styling lives in chrome-v12.css (theme-aware light / dark). */

import React from 'react';
import { NavLink } from 'react-router-dom';
import { useSession } from '../../auth/useSession';
import { supabase } from '../../lib/supabase';

const ITEMS = [
  { to: '/', label: 'Home', end: true },
  { to: '/macro', label: 'Macro' },
  { to: '/paper', label: 'Paper' },
  { to: '/portfolio-lab', label: 'Portfolio Lab' },
  { to: '/methodology', label: 'Methodology' },
  { to: '/admin/data', label: 'Data' },
];

export default function TopNav() {
  const { user, loading } = useSession();
  const signedIn = !!user;
  const email = user?.email || '';

  // Paper is login-gated while its performance is under review (Joe directive
  // 2026-08-06): hide the nav item from signed-out visitors. The /paper route
  // itself is wrapped in RequireAuth, so deep links land on the sign-in card.
  const items = ITEMS.filter((item) => item.to !== '/paper' || signedIn);

  async function handleSignOut() {
    try { await supabase.auth.signOut(); } catch (e) { /* best effort */ }
    if (typeof window !== 'undefined') window.location.assign('/');
  }

  return (
    <div className="mt-topnav">
      <NavLink to="/" end className="mt-wordmark" aria-label="MacroTilt — home">
        Macro<em>Tilt</em>
      </NavLink>

      <nav className="mt-topnav-links" aria-label="Primary">
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end || false}
            className={({ isActive }) => `mt-navlink ${isActive ? 'on' : ''}`}
          >
            {item.label}
          </NavLink>
        ))}
        <NavLink
          to="/admin/bugs"
          className={({ isActive }) => `mt-navlink mt-navlink--admin ${isActive ? 'on' : ''}`}
        >
          Bugs
        </NavLink>
      </nav>

      <div className="mt-topnav-auth">
        {loading ? (
          <span className="mt-topnav-dim">…</span>
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
