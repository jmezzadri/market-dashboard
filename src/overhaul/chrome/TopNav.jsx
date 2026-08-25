/* TopNav — the shared cream (v12) top navigation.

   Wordmark links Home; the primary routes are text links; auth sits on the
   right. Cream styling lives in chrome-v12.css (theme-aware light / dark).

   MOBILE (2026-08-25, Joe: "The entire website looks absolutely atrocious on
   my mobile phone... The site is not usable whatsoever if not on computer"):
   the row of seven text links measured 634px wide inside a 393px viewport and
   the bar clipped it, so on a phone Methodology, Data, Scorecard, Bugs and the
   auth control were not merely cramped — they were unreachable. The site could
   not be navigated at all. Below MOBILE_NAV_PX the links collapse into a
   drawer behind a 44px hamburger, which is the one control that has to be
   reachable before anything else on the page matters.

   The drawer is deliberately plain: full-width rows, 52px tall, closed by
   navigating, by the backdrop, or by Escape, and it locks body scroll while
   open so the page behind cannot slide around under the sheet. */

import React, { useCallback, useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useSession } from '../../auth/useSession';
import { supabase } from '../../lib/supabase';

const ITEMS = [
  { to: '/', label: 'Home', end: true },
  { to: '/macro', label: 'Macro' },
  { to: '/paper', label: 'Paper' },
  { to: '/portfolio-lab', label: 'Portfolio Lab' },
  { to: '/methodology', label: 'Methodology' },
  { to: '/admin/data', label: 'Data' },
  { to: '/scorecard', label: 'Scorecard' },
];

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
    // Lock the page behind the sheet. iOS Safari will happily scroll the
    // document under a fixed overlay otherwise.
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    // Close on resize back to desktop, so rotating the phone or reopening on a
    // laptop never leaves an orphaned sheet over the page.
    const onResize = () => { if (window.innerWidth > MOBILE_NAV_PX) setOpen(false); };
    window.addEventListener('resize', onResize);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onResize);
    };
  }, [open]);

  async function handleSignOut() {
    try { await supabase.auth.signOut(); } catch (e) { /* best effort */ }
    if (typeof window !== 'undefined') window.location.assign('/');
  }

  // 2026-08-17 (Joe): Paper and the Trade Idea Scorecard are both public. Bugs
  // is the only signed-in-only link and is appended only when there is a
  // session, so a signed-out visitor is never shown a link that would bounce
  // them to a login card.
  const items = signedIn ? [...ITEMS, { to: '/admin/bugs', label: 'Bugs' }] : ITEMS;

  return (
    <>
      <div className="mt-topnav">
        <NavLink to="/" end className="mt-wordmark" aria-label="MacroTilt — home">
          Macro<em>Tilt</em>
        </NavLink>

        <nav className="mt-topnav-links" aria-label="Primary">
          {ITEMS.map((item) => (
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
            {items.map((item) => (
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
