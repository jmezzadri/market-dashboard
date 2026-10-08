/* TopNav — the shared top bar.

   Wordmark links Home; then Home and the three main areas of the site, set
   large so a first-time visitor can see at a glance what the site is (Joe,
   2026-10-08). Reference pages — Methodology, Data, Bugs — are in the footer.
   Page names come from chrome/siteNav.js. Styling lives in glass.css
   (theme-aware light / dark).

   MOBILE: below MOBILE_NAV_PX the links collapse into a drawer behind a 44px
   hamburger — at 393px a row of text links does not fit and the bar clips it,
   which left pages unreachable (Joe, 2026-08-25). The drawer is deliberately
   plain: full-width rows, 52px tall, closed by navigating, by the backdrop,
   or by Escape, and it locks page scroll while open. */

import React, { useCallback, useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useSession } from '../../auth/useSession';
import { supabase } from '../../lib/supabase';
import useScrollLock from '../lib/useScrollLock';
import { PRIMARY_NAV } from './siteNav';

// Kept in step with the breakpoint in chrome-v12.css. Above this the inline
// links fit; below it they do not, at any gap.
const MOBILE_NAV_PX = 860;

export default function TopNav() {
  const { user, loading } = useSession();
  const signedIn = !!user;
  const email = user?.email || '';
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);

  const close = useCallback(() => setOpen(false), []);

  // Navigating closes the drawer. Without this a tap opens the new page with
  // the sheet still covering it.
  useEffect(() => { setOpen(false); }, [pathname]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    // Close on resize back to desktop, so rotating the phone or reopening on a
    // laptop never leaves an orphaned sheet over the page.
    const onResize = () => { if (window.innerWidth > MOBILE_NAV_PX) setOpen(false); };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onResize);
    };
  }, [open]);
  // Lock the page behind the sheet. iOS Safari will happily scroll the
  // document under a fixed overlay otherwise.
  useScrollLock(open);

  async function handleSignOut() {
    try { await supabase.auth.signOut(); } catch (e) { /* best effort */ }
    if (typeof window !== 'undefined') window.location.assign('/');
  }

  return (
    <>
      <div className="mt-topnav">
        <NavLink to="/" end className="mt-wordmark" aria-label="MacroTilt — home">
          Macro<em>Tilt</em>
        </NavLink>

        <nav className="mt-topnav-links" aria-label="Primary">
          {PRIMARY_NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end || false}
              className={({ isActive }) => `mt-navlink ${isActive ? 'on' : ''}`}
            >
              {item.label}
            </NavLink>
          ))}
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

        <button
          type="button"
          className="mt-navtoggle"
          aria-label={open ? 'Close menu' : 'Open menu'}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <span className={`mt-navtoggle-bars ${open ? 'is-open' : ''}`} aria-hidden="true">
            <i /><i /><i />
          </span>
        </button>
      </div>

      {open && (
        <div className="mt-navsheet-veil" onClick={close} role="presentation">
          <nav
            className="mt-navsheet"
            aria-label="Primary"
            onClick={(e) => e.stopPropagation()}
          >
            {PRIMARY_NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end || false}
                className={({ isActive }) => `mt-navsheet-link ${isActive ? 'on' : ''}`}
              >
                {item.label}
              </NavLink>
            ))}
            <div className="mt-navsheet-auth">
              {loading ? null : signedIn ? (
                <>
                  <span className="mt-navsheet-email">{email}</span>
                  <button type="button" className="mt-navsheet-signout" onClick={handleSignOut}>
                    Sign out
                  </button>
                </>
              ) : (
                <NavLink className="mt-navsheet-signin" to="/signin">Sign in →</NavLink>
              )}
            </div>
          </nav>
        </div>
      )}
    </>
  );
}
