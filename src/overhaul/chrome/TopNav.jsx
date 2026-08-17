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

  // 2026-08-17 (Joe): Paper is public again — it shows for everyone, so no
  // filter on it. What IS signed-in-only now is Bugs and the Trade Idea
  // Scorecard; both are appended below only when there is a session, so a
  // signed-out visitor is never shown a link that will bounce them to a login
  // card. The routes themselves are wrapped in RequireAuth, so a deep link
  // still lands on the sign-in screen rather than leaking.
  const items = signedIn ? [...ITEMS, { to: '/scorecard', label: 'Scorecard' }] : ITEMS;

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
        {signedIn && (
          <NavLink
            to="/admin/bugs"
            className={({ isActive }) => `mt-navlink mt-navlink--admin ${isActive ? 'on' : ''}`}
          >
            Bugs
          </NavLink>
        )}
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
