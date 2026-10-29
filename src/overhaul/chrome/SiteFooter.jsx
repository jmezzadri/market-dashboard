/* SiteFooter — one compact band on every page (2026-10-28 redesign): the
   wordmark, a one-line disclaimer, and the reference links inline —
   Methodology, Data, (Bugs when signed in), About, Contact, Terms, Privacy.
   Replaces the five-column footer and the empty gap above it (Joe's
   approved Home board). Page names come from chrome/siteNav.js.
   Styling lives in styles/redesign.css. */

import React from 'react';
import { Link } from 'react-router-dom';
import { useSession } from '../../auth/useSession';
import { REFERENCE_NAV } from './siteNav';

const CONTACT_EMAIL = 'admin@macrotilt.com';

export default function SiteFooter() {
  const year = new Date().getFullYear();
  const { user } = useSession();
  const reference = REFERENCE_NAV.filter((p) => !p.signedInOnly || !!user);
  return (
    <footer className="rd-foot">
      <div className="rd-foot-in">
        <div className="rd-foot-left">
          <Link to="/" className="rd-foot-logo" aria-label="MacroTilt — home">
            Macro<em>Tilt</em>
          </Link>
          <p className="rd-foot-disc">
            Market data and analysis for informational purposes only. Not investment advice or an offer
            to buy or sell any security. Data may be delayed. © {year} MacroTilt.
          </p>
        </div>
        <nav className="rd-foot-nav" aria-label="Reference">
          {reference.map((p) => <Link key={p.to} to={p.to}>{p.label}</Link>)}
          <Link to="/about">About</Link>
          <a href={`mailto:${CONTACT_EMAIL}`}>Contact</a>
          <Link to="/terms">Terms</Link>
          <Link to="/privacy">Privacy</Link>
          <Link to="/disclaimer">Disclaimer</Link>
        </nav>
      </div>
    </footer>
  );
}
