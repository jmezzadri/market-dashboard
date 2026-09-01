/* StaticPages — About Us, Terms of Use, Privacy Policy, Disclaimer.
   Added 2026-07-29 with the site-wide footer. Copy approved by Joe from the
   legal-pages draft (2026-07-29). Plain prose pages on the cream (v12)
   system; styling lives in styles/footer-v12.css (.mt-static-page). */

import React from 'react';
import '../styles/v13.css';
import '../styles/pages-v13.css';

const CONTACT_EMAIL = 'admin@macrotilt.com';
const LAST_UPDATED = 'July 29, 2026';

function Contact() {
  return (
    <p>
      <strong>Contact:</strong>{' '}
      <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
    </p>
  );
}

export function AboutPage() {
  return (
    <div className="v13 mt-static-page">
      <h1>About Us</h1>
      <p>
        <strong>MacroTilt</strong> is a market intelligence dashboard built for
        people who make decisions with capital — portfolio managers, risk
        managers, and market professionals.
      </p>
      <p>
        We combine two things that usually live apart:{' '}
        <strong>quantitative signals</strong> — systematically computed
        indicators across macro, credit, positioning, and momentum, each
        documented and backtested — and <strong>qualitative context</strong> —
        a plain-English read on what the data actually means for markets right
        now.
      </p>
      <p>
        Every number on MacroTilt shows its work. Each data point carries a
        freshness stamp showing where it came from, how often it updates, and
        when it was last refreshed. Our full methodology — every formula, every
        data source, every scoring rule — is published openly on the{' '}
        <a href="/methodology">Methodology</a> page. No black boxes.
      </p>
      <p>
        MacroTilt is based in New York, NY. Reach us at{' '}
        <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
      </p>
    </div>
  );
}

export function TermsPage() {
  return (
    <div className="v13 mt-static-page">
      <h1>Terms of Use</h1>
      <p className="mt-static-updated">Last updated: {LAST_UPDATED}</p>
      <p>
        Welcome to MacroTilt. By accessing macrotilt.com (the “Site”), you
        agree to these Terms of Use. If you do not agree, please do not use the
        Site.
      </p>
      <h2>1. What MacroTilt is — and is not</h2>
      <p>
        MacroTilt provides market data, indicators, and analysis for
        informational and educational purposes only. Nothing on the Site is
        investment advice, a recommendation, an offer, or a solicitation to buy
        or sell any security or financial instrument. MacroTilt is not a
        registered investment adviser, broker-dealer, or fiduciary. You are
        solely responsible for your own investment decisions.
      </p>
      <h2>2. Accounts</h2>
      <p>
        Some features require an account. You are responsible for keeping your
        credentials confidential and for all activity under your account. We
        may suspend or terminate accounts that violate these Terms.
      </p>
      <h2>3. Acceptable use</h2>
      <p>
        You agree not to: scrape, harvest, or systematically extract data from
        the Site; resell or redistribute Site content without written
        permission; attempt to disrupt, overload, or gain unauthorized access
        to the Site; or use the Site for any unlawful purpose.
      </p>
      <h2>4. Intellectual property</h2>
      <p>
        The Site’s design, text, indicators, scoring methodologies, and
        original content are the property of MacroTilt. Underlying market data
        belongs to its respective providers. You may use the Site for personal
        or internal business purposes; you may not republish its content
        commercially without permission.
      </p>
      <h2>5. Third-party data</h2>
      <p>
        The Site displays data sourced from third-party providers and
        government agencies. We work to keep data accurate and fresh, but we do
        not guarantee its accuracy, completeness, or timeliness, and data may
        be delayed.
      </p>
      <h2>6. No warranty</h2>
      <p>
        The Site is provided “as is” and “as available,” without warranties of
        any kind, express or implied. We do not warrant that the Site will be
        uninterrupted, error-free, or that any data will be accurate.
      </p>
      <h2>7. Limitation of liability</h2>
      <p>
        To the maximum extent permitted by law, MacroTilt and its operators
        shall not be liable for any indirect, incidental, consequential, or
        special damages — including trading losses or lost profits — arising
        from your use of, or inability to use, the Site.
      </p>
      <h2>8. Changes</h2>
      <p>
        We may update the Site and these Terms at any time. Continued use after
        changes are posted constitutes acceptance. Material changes will be
        reflected in the “Last updated” date above.
      </p>
      <h2>9. Governing law</h2>
      <p>
        These Terms are governed by the laws of the State of New York, without
        regard to conflict-of-law principles.
      </p>
      <Contact />
    </div>
  );
}

export function PrivacyPage() {
  return (
    <div className="v13 mt-static-page">
      <h1>Privacy Policy</h1>
      <p className="mt-static-updated">Last updated: {LAST_UPDATED}</p>
      <p>
        This policy describes what information MacroTilt collects and how we
        use it.
      </p>
      <h2>What we collect</h2>
      <ul>
        <li>
          <strong>Account information.</strong> If you create an account, we
          collect your email address and authentication credentials.
        </li>
        <li>
          <strong>Usage information.</strong> Like most websites, we and our
          hosting providers collect standard technical logs — pages visited,
          browser type, IP address — used for security, debugging, and
          understanding aggregate site usage.
        </li>
      </ul>
      <h2>What we do not do</h2>
      <ul>
        <li>We do not sell your personal information.</li>
        <li>
          We do not share your personal information with third parties for
          their marketing.
        </li>
        <li>We do not display third-party advertising.</li>
      </ul>
      <h2>How we use information</h2>
      <p>
        To operate the Site, authenticate sign-ins, maintain saved features
        tied to your account (such as saved portfolios), diagnose problems, and
        communicate with you about the service.
      </p>
      <h2>Service providers</h2>
      <p>
        The Site runs on reputable third-party infrastructure for hosting,
        databases, and authentication. These providers process data on our
        behalf under their own security and privacy commitments.
      </p>
      <h2>Cookies</h2>
      <p>
        We use cookies and similar browser storage strictly to keep you signed
        in and remember your preferences (such as theme). We do not use
        tracking cookies for advertising.
      </p>
      <h2>Data retention &amp; deletion</h2>
      <p>
        We keep account data while your account is active. To delete your
        account and associated data, email{' '}
        <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> and we will
        process the request.
      </p>
      <h2>Security</h2>
      <p>
        We use industry-standard encryption in transit and access controls. No
        system is perfectly secure; please use a strong, unique password.
      </p>
      <h2>Children</h2>
      <p>
        The Site is not directed at children under 13 and we do not knowingly
        collect their information.
      </p>
      <h2>Changes</h2>
      <p>
        We may update this policy; the “Last updated” date will reflect any
        revision.
      </p>
      <Contact />
    </div>
  );
}

export function DisclaimerPage() {
  return (
    <div className="v13 mt-static-page">
      <h1>Disclaimer</h1>
      <h2>No investment advice</h2>
      <p>
        All content on MacroTilt — indicators, scores, signals, portfolios,
        scans, commentary, and any other material — is for informational and
        educational purposes only. It is not investment advice, is not tailored
        to any person’s circumstances, and should not be relied upon to make
        investment decisions. Consult a qualified financial adviser before
        making investment decisions.
      </p>
      <h2>Not a registered adviser</h2>
      <p>
        MacroTilt and its operators are not registered as investment advisers
        or broker-dealers with the SEC, FINRA, or any other regulatory
        authority.
      </p>
      <h2>Hypothetical performance</h2>
      <p>
        Backtested and model portfolio results shown on the Site are
        hypothetical. They are computed retroactively, do not represent actual
        trading, and do not account for all real-world costs and constraints.
        Hypothetical results have inherent limitations, and no representation
        is made that any account will achieve results similar to those shown.{' '}
        <strong>
          Past performance — actual or hypothetical — does not guarantee future
          results.
        </strong>
      </p>
      <h2>Data accuracy</h2>
      <p>
        Market data may be delayed, incomplete, or contain errors. Verify any
        figure independently before acting on it.
      </p>
      <h2>Risk</h2>
      <p>
        All investments involve risk, including possible loss of principal.
        Markets can move against any position, model, or signal.
      </p>
      <Contact />
    </div>
  );
}
