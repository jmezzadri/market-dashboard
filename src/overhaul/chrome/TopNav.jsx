/* TopNav — the shared header on every page (2026-10-28 redesign).

   One 64px row: the serif wordmark, the menu (Home and the three main areas,
   from chrome/siteNav.js), then on the right the ticker search, the theme
   toggle (every page) and Sign in.
   The active page carries a 2px accent underline. Styling lives in
   styles/redesign.css and reads the editorial tokens; under the terminal
   skin (data-skin on the shell) the same markup goes dark.

   PHONE (below MOBILE_NAV_PX): wordmark, the current page's name, a 44px
   search button and a 44px menu button. The menu is a plain drawer — full-
   width rows, closed by navigating, by the backdrop or by Escape, and it
   locks page scroll while open (Joe, 2026-08-25: a row of text links did
   not fit at 393px and the bar clipped it). The search button opens the
   same search box on its own row.

   Nothing here fetches anything; the session and the theme come from the
   same hooks as before. */

import React, { useCallback, useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useSession } from '../../auth/useSession';
import { supabase } from '../../lib/supabase';
import useScrollLock from '../lib/useScrollLock';
import { useTweaks } from '../tweaks/TweaksContext';
import { PRIMARY_NAV, REFERENCE_NAV } from './siteNav';
import TickerSearch from './TickerSearch';

// Kept in step with the breakpoint in redesign.css. Above this the inline
// links fit; below it they do not, at any gap.
const MOBILE_NAV_PX = 860;

function pageName(pathname) {
  const hit = PRIMARY_NAV.find((p) => (p.end ? pathname === p.to : pathname.startsWith(p.to)))
    || REFERENCE_NAV.find((p) => pathname.startsWith(p.to));
  if (hit) return hit.label;
  if (pathname.startsWith('/ticker/')) return decodeURIComponent(pathname.slice('/ticker/'.length)).toUpperCase();
  if (pathname.startsWith('/signin')) return 'Sign in';
  return '';
}

export default function TopNav() {
  const { user, loading } = useSession();
  const signedIn = !!user;
  const email = user?.email || '';
  const { pathname } = useLocation();
  const { tweaks, setTweak } = useTweaks();
  const [open, setOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  const close = useCallback(() => setOpen(false), []);

  // Navigating closes the drawer and the phone search row.
  useEffect(() => { setOpen(false); setSearchOpen(false); }, [pathname]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    const onResize = () => { if (window.innerWidth > MOBILE_NAV_PX) setOpen(false); };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onResize);
    };
  }, [open]);
  useScrollLock(open);

  async function handleSignOut() {
    try { await supabase.auth.signOut(); } catch (e) { /* best effort */ }
    if (typeof window !== 'undefined') window.location.assign('/');
  }

  /* Light and dark on every page (Joe, 2026-10-28). 'navy' is the site's dark. */
  const isDark = tweaks.theme !== 'light';
  const flipTheme = () => setTweak('theme', isDark ? 'light' : 'navy');
  const current = pageName(pathname);

  const auth = (cls) => (loading ? (
    <span className={`${cls}-dim`}>…</span>
  ) : signedIn ? (
    <>
      <span className={`${cls}-email`} title={email}>{email}</span>
      <button type="button" className={`${cls}-signout`} onClick={handleSignOut}>Sign out</button>
    </>
  ) : (
    <NavLink className={`${cls}-signin`} to="/signin">Sign in</NavLink>
  ));

  return (
    <>
      <header className="rd-head" role="banner">
        <div className="rd-head-in">
          <NavLink to="/" end className="rd-logo" aria-label="MacroTilt — home">
            Macro<em>Tilt</em>
          </NavLink>

          <nav className="rd-nav" aria-label="Primary">
            {PRIMARY_NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end || false}
                className={({ isActive }) => `rd-navlink${isActive ? ' on' : ''}`}
              >
                {item.label}
              </NavLink>
            ))}
          </nav>

          {/* phone: the page's name next to the wordmark */}
          {current && <span className="rd-pagename" aria-hidden="true">{current}</span>}

          <div className="rd-head-right">
            <TickerSearch className="rd-search rd-search--desk" />
            <button
              type="button"
              className="rd-theme"
              onClick={flipTheme}
              aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
            >
              {isDark ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" /></svg>
              )}
            </button>
            <div className="rd-auth">{auth('rd-auth')}</div>
          </div>

          <button
            type="button"
            className="rd-iconbtn rd-searchbtn"
            aria-label={searchOpen ? 'Close search' : 'Search'}
            aria-expanded={searchOpen}
            onClick={() => setSearchOpen((v) => !v)}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
          </button>
          <button
            type="button"
            className="rd-iconbtn rd-menubtn"
            aria-label={open ? 'Close menu' : 'Open menu'}
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? (
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
            ) : (
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
            )}
          </button>
        </div>

        {searchOpen && (
          <div className="rd-search-row">
            <TickerSearch className="rd-search rd-search--phone" autoFocus />
          </div>
        )}
      </header>

      {open && (
        <div className="rd-drawer-veil" onClick={close} role="presentation">
          <nav className="rd-drawer" aria-label="Primary" onClick={(e) => e.stopPropagation()}>
            {PRIMARY_NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end || false}
                className={({ isActive }) => `rd-drawer-link${isActive ? ' on' : ''}`}
              >
                {item.label}
              </NavLink>
            ))}
            {REFERENCE_NAV.filter((p) => !p.signedInOnly || signedIn).map((item) => (
              <NavLink key={item.to} to={item.to} className="rd-drawer-link rd-drawer-link--ref">
                {item.label}
              </NavLink>
            ))}
            <button type="button" className="rd-drawer-link rd-drawer-link--ref" onClick={flipTheme}>
              {isDark ? 'Switch to light theme' : 'Switch to dark theme'}
            </button>
            <div className="rd-drawer-auth">{auth('rd-drawer-auth')}</div>
          </nav>
        </div>
      )}
    </>
  );
}
