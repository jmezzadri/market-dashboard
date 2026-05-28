/* Sidebar — rail / collapsed-rail layout. Top-nav layout is rendered
   separately by TopNav.jsx and shown when data-mt-sidebar="top".
   Every nav item wrapped in a Tip so collapsed-rail still gets the label
   as a hover-tooltip.
   Ported from site-overhaul prototype lm-core.jsx. */

import React from 'react';
import { NavLink } from 'react-router-dom';
import Tip from '../components/Tip';
import NavIcon from '../components/NavIcon';
import { useSession } from '../../auth/useSession';
import { supabase } from '../../lib/supabase';

const NAV = [
  { to: '/', label: 'Home', icon: 'home', end: true },
  { to: '/macro', label: 'Macro overview', icon: 'macro' },
  { to: '/tilt', label: 'Asset Tilt', icon: 'tilt' },
  { to: '/scanner', label: 'Trading scanner', icon: 'scanner' },
  { to: '/portfolio', label: 'Portfolio insights', icon: 'portfolio' },
  { to: '/paper', label: 'Paper Portfolio', icon: 'portfolio' },
  { to: '/scenarios', label: 'Scenario analysis', icon: 'scenarios' },
  { to: '/indicators', label: 'All indicators', icon: 'indicators' },
  { to: '/methodology', label: 'Methodology', icon: 'methodology' },
];

const ADMIN = [
  { to: '/admin/data', label: 'Admin · Data', icon: 'admin' },
  { to: '/admin/bugs', label: 'Admin · Bugs', icon: 'bugs' },
];

export default function Sidebar() {
  const { user, loading } = useSession();
  const signedIn = !!user;
  const email = user?.email || null;

  async function handleSignOut() {
    try { await supabase.auth.signOut(); } catch (e) { /* best effort */ }
    /* Reload to clear any cached state from authed components. */
    if (typeof window !== 'undefined') window.location.assign('/');
  }

  return (
    <aside className="mt-sidebar">
      <div className="mt-sidebar-brand">
        <div className="mt-mark" aria-hidden>
          <svg viewBox="0 0 32 32">
            <circle cx="16" cy="16" r="14" fill="none" stroke="currentColor" strokeWidth="1.5" />
            <path
              d="M 8 22 L 16 12 L 24 22"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </div>
        <div>
          <div className="mt-sidebar-name">
            Macro<i>Tilt</i>
          </div>
          <div className="mt-sidebar-sub">v2</div>
        </div>
      </div>
      <nav className="mt-sidebar-nav" aria-label="Primary">
        {NAV.map((item) => (
          <Tip key={item.to || item.external} content={item.label} side="right" bare block>
            {item.external ? (
              <a
                href={item.external}
                className="mt-navitem"
                aria-label={item.label}
              >
                <span className="mt-navicon"><NavIcon k={item.icon} /></span>
                <span className="mt-navlbl">{item.label}</span>
              </a>
            ) : (
              <NavLink
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `mt-navitem ${isActive ? 'mt-navitem--active' : ''}`
                }
                aria-label={item.label}
              >
                <span className="mt-navicon"><NavIcon k={item.icon} /></span>
                <span className="mt-navlbl">{item.label}</span>
              </NavLink>
            )}
          </Tip>
        ))}
        <div className="mt-navsep" role="separator" aria-hidden>
          <span className="mt-navsep-lbl">Admin</span>
        </div>
        {ADMIN.map((item) => (
          <Tip key={item.to} content={item.label} side="right" bare block>
            <NavLink
              to={item.to}
              className={({ isActive }) =>
                `mt-navitem ${isActive ? 'mt-navitem--active' : ''}`
              }
              aria-label={item.label}
            >
              <span className="mt-navicon"><NavIcon k={item.icon} /></span>
              <span className="mt-navlbl">{item.label}</span>
            </NavLink>
          </Tip>
        ))}
      </nav>
      {/* Real session identity — replaces the hardcoded 'joe@macrotilt'
          placeholder. Shows the actual signed-in email + a Sign out button,
          or a Sign in CTA when the user has no session. */}
      <div className="mt-sidebar-foot">
        {loading ? (
          <span style={{ opacity: 0.6 }}>…</span>
        ) : signedIn ? (
          <>
            <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {email}
            </div>
            <button
              type="button"
              onClick={handleSignOut}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--mt-ink-2)',
                fontSize: 11,
                marginTop: 2,
                padding: 0,
                cursor: 'pointer',
                textDecoration: 'underline',
              }}
            >
              Sign out
            </button>
          </>
        ) : (
          <a
            href="/?v=2"
            style={{ color: 'var(--mt-accent)', fontWeight: 500, textDecoration: 'none' }}
          >
            Sign in →
          </a>
        )}
      </div>
    </aside>
  );
}
