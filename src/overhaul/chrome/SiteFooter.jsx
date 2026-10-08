/* SiteFooter — site-wide footer. Styling lives in styles/footer-v12.css.

   The footer is where the reference pages live (Joe, 2026-10-08): the top
   bar carries only Home and the three main areas, so Methodology, Data and
   Bugs are listed here. Page names come from chrome/siteNav.js. */

import React from 'react';
import { Link } from 'react-router-dom';
import { useSession } from '../../auth/useSession';
import { PRIMARY_NAV, REFERENCE_NAV } from './siteNav';

const CONTACT_EMAIL = 'admin@macrotilt.com';

export default function SiteFooter() {
  const year = new Date().getFullYear();
  const { user } = useSession();
  const reference = REFERENCE_NAV.filter((p) => !p.signedInOnly || !!user);
  return (
    <footer className="mt-footer">
      <div className="mt-footer-grid">
        <div>
          <Link to="/" className="mt-footer-wordmark" aria-label="MacroTilt — home">
            Macro<em>Tilt</em>
          </Link>
          <p className="mt-footer-tag">
            Quantitative macro signals and qualitative market analysis for
            portfolio managers, risk managers, and market professionals.
          </p>
          <p className="mt-footer-loc">
            New York, NY&nbsp;&nbsp;·&nbsp;&nbsp;
            <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
          </p>
        </div>

        <div className="mt-footer-col">
          <h4>Platform</h4>
          <ul>
            {PRIMARY_NAV.filter((p) => p.to !== '/').map((p) => (
              <li key={p.to}><Link to={p.to}>{p.label}</Link></li>
            ))}
          </ul>
        </div>

        <div className="mt-footer-col">
          <h4>Reference</h4>
          <ul>
            {reference.map((p) => (
              <li key={p.to}><Link to={p.to}>{p.label}</Link></li>
            ))}
          </ul>
        </div>

        <div className="mt-footer-col">
          <h4>Company</h4>
          <ul>
            <li><Link to="/about">About Us</Link></li>
            <li><a href={`mailto:${CONTACT_EMAIL}`}>Contact</a></li>
          </ul>
        </div>

        <div className="mt-footer-col">
          <h4>Legal</h4>
          <ul>
            <li><Link to="/terms">Terms of Use</Link></li>
            <li><Link to="/privacy">Privacy Policy</Link></li>
            <li><Link to="/disclaimer">Disclaimer</Link></li>
          </ul>
        </div>
      </div>

      <div className="mt-footer-legalband">
        <div className="inner">
          <p className="mt-footer-disclaimer">
            MacroTilt provides market data and analysis for informational and
            educational purposes only. Nothing on this site constitutes
            investment advice, a recommendation, or an offer to buy or sell any
            security. Data may be delayed. Past performance does not guarantee
            future results.
          </p>
        </div>
        <div className="mt-footer-bottom">
          <span className="mt-footer-copy">© {year} MacroTilt. All rights reserved.</span>
          <span className="mt-footer-bottomlinks">
            <Link to="/terms">Terms</Link>
            <Link to="/privacy">Privacy</Link>
            <Link to="/disclaimer">Disclaimer</Link>
          </span>
        </div>
      </div>
    </footer>
  );
}
