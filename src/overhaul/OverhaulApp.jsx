/* OverhaulApp — root shell for the May 2026 site overhaul.

   Renders:
     - TweaksProvider (theme/accent/etc. persisted to localStorage)
     - BrowserRouter with the 9 page routes from the brief
     - Sidebar (rail / collapsed-rail) + TopNav (top) chrome variants
     - PageHeader with date / search / freshness pill / theme toggle

   Activated by appending ?v=3 to any URL in the live app (legacy gate
   lives in src/App.jsx). When the overhaul is feature-complete, the
   default render will flip to this shell. */

import React, { useEffect } from 'react';
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  useLocation,
  useNavigate,
} from 'react-router-dom';

import './styles/tokens.css';
import './styles/chrome.css';
import './styles/pages.css';

// Prototype CSS files ported VERBATIM from Claude Design's handoff,
// scoped under .mt-overhaul. These are the design vocabulary the pages
// are written against — without them, every page renders inline styles
// that approximate the look badly. Joe directive 2026-05-27.
import './styles/proto-lm-components.css';
import './styles/proto-pages.css';
import './styles/proto-methodology.css';
import './styles/responsive.css';

// Legacy-token bridge — re-maps the old V2 token families (--text / --ink-* /
// --bg-* / --accent / --up / --down ...) onto the overhaul --mt-* tokens so the
// V2 pages still mounted inside this shell (Paper Portfolio at /paper, Admin
// Bugs, Admin Data Health) follow the active light / dark / navy theme.
// HISTORY: loaded by PR #882 (2026-05-28); silently dropped by the ticker-UX
// rewrite e11bbb85 (2026-06-01) — from then on /paper rendered light-palette
// cards and a near-invisible headline in dark/navy. Restored 2026-06-10.
// DO NOT REMOVE without checking every v2/* component mounted in this file.
import './styles/legacy-bridge.css';

// CREAM chrome — top nav + header (loaded LAST so it overrides the v11 glass
// chrome). Retires the sidebar + v11 glass shell. 2026-07-07.
import './styles/chrome-v12.css';

// Site-wide footer + static prose pages (About / Terms / Privacy /
// Disclaimer). 2026-07-29.
import './styles/footer-v12.css';

// Mobile layer — LAST, so it wins over every page's own v12 sheet. Joe
// 2026-08-25: "The site is not usable whatsoever if not on computer." Every
// rule inside is behind a media query; this file is inert on desktop.
import './styles/mobile-v12.css';

import { TweaksProvider } from './tweaks/TweaksContext';

import TopNav from './chrome/TopNav';
import PageHeader from './chrome/PageHeader';
import SiteFooter from './chrome/SiteFooter';
import LoginScreen from '../auth/LoginScreen';
import { useSession } from '../auth/useSession';

import HomePage from './pages/HomePage';
import MacroPage from './pages/MacroPage';
import PortfolioLabPage from './pages/PortfolioLabPage';
import MethodologyPage from './pages/MethodologyPage';
import TickerPage from './pages/TickerPage';
import DataFlowPage from './pages/DataFlowPage';
import ScorecardPage from './pages/ScorecardPage';
import { AboutPage, TermsPage, PrivacyPage, DisclaimerPage } from './pages/StaticPages';
// Real Admin · Bugs triage page. Restored 2026-06-01 — the same commit that
// dropped /paper also swapped this route to a placeholder, breaking the
// bugs page. The page itself lives at src/AdminBugs.jsx and still works.
import AdminBugs from '../AdminBugs';

// Paper Portfolio (Alpaca paper-trading page) lives in the v2 folder; mounted
// here so the sidebar /paper link resolves. Restored 2026-06-01 after an
// unrelated ticker-UX commit (e11bbb85) removed this route, which sent /paper
// to the catch-all -> home redirect.
import PaperPortfolioPage from '../v2/pages/PaperPortfolioPage';
import PageErrorBoundary from '../v2/components/ErrorBoundary';

// Site-wide "Report a bug" widget. Renders on every route for signed-in users
// and is the front door to the bug_reports table / /admin/bugs triage board
// that has existed server-side since migration 004. 2026-07-30.
import ReportBug from '../components/ReportBug';

// Small wrapper so the /paper route can navigate to a ticker without needing
// useNavigate at the top of Shell (keeps the route self-contained).

/* /indicators retired 2026-07-07 (Joe): Macro Overview carries every indicator
   row + the same detail modal. Old links redirect, preserving ?ind= deep links. */
function LegacyIndicatorsRedirect() {
  const { search } = useLocation();
  return <Navigate to={`/macro${search}`} replace />;
}

function PaperRoute() {
  const navigate = useNavigate();
  return (
    <PageErrorBoundary>
      <PaperPortfolioPage
        onOpenTicker={(symbol) => {
          if (symbol && symbol !== 'CASH') navigate(`/ticker/${symbol}`);
        }}
      />
    </PageErrorBoundary>
  );
}

// Reset scroll to the top on every route change — otherwise clicking a ticker
// from a scrolled-down scanner opens the new page still scrolled to the bottom.
function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
    document.querySelector('.mt-main')?.scrollTo(0, 0);
    document.querySelector('.mt-overhaul')?.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

// Auto-update: when a new build has been deployed, reload the tab the next
// time it regains focus — so an open tab never shows a stale version and you
// never have to hard-refresh. Safe by design: it only reloads when it has read
// a real current build id AND later reads a DIFFERENT one; any fetch failure
// is ignored (so it can never loop or reload spuriously).
function VersionWatch() {
  useEffect(() => {
    let current = null, cancelled = false;
    const readBuildId = () =>
      fetch('/', { cache: 'no-store' })
        .then((r) => r.text())
        .then((h) => (h.match(/\/assets\/index-[\w-]+\.js/) || [null])[0])
        .catch(() => null);
    readBuildId().then((id) => { if (!cancelled) current = id; });
    const onVisible = async () => {
      if (document.visibilityState !== 'visible' || !current) return;
      const id = await readBuildId();
      if (!cancelled && id && id !== current) window.location.reload();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => { cancelled = true; document.removeEventListener('visibilitychange', onVisible); };
  }, []);
  return null;
}

// SignInRoute — mounts the shared LoginScreen INSIDE the modern app so phone
// users get the responsive sign-in card instead of being bounced to the old
// (non-responsive) app. Signing in flips the Supabase session via
// onAuthStateChange; once signed in we send the user to the dashboard home.
function SignInRoute() {
  const { session } = useSession();
  if (session) return <Navigate to="/" replace />;
  return (
    <main className="mt-main-wrap">
      <LoginScreen />
    </main>
  );
}

// RequireAuth — login gate for routes that must not be public. Renders the
// shared LoginScreen in place (no redirect), so after signing in the user lands
// right back on the page they asked for.
//
// Who is behind it, as of 2026-08-17 (Joe): /admin/bugs, and nothing else.
// /paper was the original tenant (2026-08-06, pending a performance review)
// and is public again; /scorecard was gated for one commit and is public too.
function RequireAuth({ children }) {
  const { session, loading } = useSession();
  if (loading) return null;
  if (!session) {
    return (
      <main className="mt-main-wrap">
        <LoginScreen />
      </main>
    );
  }
  return children;
}

function Shell() {
  // The Home route is the full-bleed Daily-Brief design (its own header +
  // ribbon). Every other route keeps the standard sidebar + top chrome until
  // Phase 2 brings them onto the same system.
  return (
    <div className="mt-overhaul">
      <div className="mt-app">
        <main className="mt-main">
          <TopNav />
          <PageHeader />
          <ScrollToTop />
          <VersionWatch />
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/macro" element={<MacroPage />} />
            <Route path="/tilt" element={<Navigate to="/macro" replace />} />
            {/* /scanner RETIRED 2026-08-11 (Joe). The Conviction Events desk
                and the Paper page's event ledger were reading the same
                ce_events rows through the same hook — two surfaces, one feed.
                The book's page won, the public desk was killed. Redirect, not
                404: the page was linked from the homepage and was public, so
                bookmarks and search results still land somewhere real. */}
            <Route path="/scanner" element={<Navigate to="/" replace />} />
            <Route path="/signin" element={<SignInRoute />} />
            {/* /paper is PUBLIC again (Joe, 2026-08-17: "put the Paper Tab not
                behind the log in. I want it public. The only thing that should
                be behind log in is the Bugs page"). This reverses the
                2026-08-06 gate, which held the paper book back while its
                performance was under review. */}
            <Route path="/paper" element={<PaperRoute />} />
            {/* /scorecard is PUBLIC (Joe, 2026-08-17: "Public now is fine").
                It was briefly gated on the theory that three calls is not a
                track record. Publishing it instead puts the weight on the
                marker rather than on the door: score_trade_ideas.py still
                withholds a hit rate below 10 closed calls and says why, every
                call is listed win or lose, and the stop is honoured. Those
                rules matter MORE on a public page, not less — they are what
                stop a short sample reading as a record. */}
            <Route path="/scorecard" element={<ScorecardPage />} />
            <Route path="/portfolio-lab" element={<PortfolioLabPage />} />
            <Route path="/indicators" element={<LegacyIndicatorsRedirect />} />
            <Route path="/methodology" element={<MethodologyPage />} />
            <Route path="/ticker/:symbol" element={<TickerPage />} />
            <Route path="/admin/data" element={<DataFlowPage />} />
            <Route path="/admin/bugs" element={<RequireAuth><AdminBugs /></RequireAuth>} />
            <Route path="/about" element={<AboutPage />} />
            <Route path="/terms" element={<TermsPage />} />
            <Route path="/privacy" element={<PrivacyPage />} />
            <Route path="/disclaimer" element={<DisclaimerPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          <SiteFooter />
          <ReportBug />
        </main>
      </div>
    </div>
  );
}

export default function OverhaulApp() {
  return (
    <TweaksProvider>
      <BrowserRouter>
        <Shell />
      </BrowserRouter>
    </TweaksProvider>
  );
}
