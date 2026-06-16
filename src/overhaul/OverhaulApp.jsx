/* OverhaulApp — root shell for the May 2026 site overhaul.

   Renders:
     - TweaksProvider (theme/accent/etc. persisted to localStorage)
     - BrowserRouter with the 9 page routes from the brief
     - Sidebar (rail / collapsed-rail) + TopNav (top) chrome variants
     - PageHeader with date / search / freshness pill / theme / tweaks
     - TweaksPanel slide-over

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

import { TweaksProvider } from './tweaks/TweaksContext';
import TweaksPanel from './tweaks/TweaksPanel';

import Sidebar from './chrome/Sidebar';
import TopNav from './chrome/TopNav';
import PageHeader from './chrome/PageHeader';
import LoginScreen from '../auth/LoginScreen';
import { useSession } from '../auth/useSession';

import HomePage from './pages/HomePage';
import MacroPage from './pages/MacroPage';
import TiltPage from './pages/TiltPage';
import ScannerPage from './pages/ScannerPage';
import ScenariosPage from './pages/ScenariosPage';
import IndicatorsPage from './pages/IndicatorsPage';
import MethodologyPage from './pages/MethodologyPage';
import TickerPage from './pages/TickerPage';
import DataFlowPage from './pages/DataFlowPage';
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

// Small wrapper so the /paper route can navigate to a ticker without needing
// useNavigate at the top of Shell (keeps the route self-contained).
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

function Shell() {
  return (
    <div className="mt-overhaul">
      <div className="mt-app">
        <Sidebar />
        <main className="mt-main">
          <TopNav />
          <PageHeader />
          <ScrollToTop />
          <VersionWatch />
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/macro" element={<MacroPage />} />
            <Route path="/tilt" element={<TiltPage />} />
            <Route path="/scanner" element={<ScannerPage />} />
            <Route path="/signin" element={<SignInRoute />} />
            <Route path="/paper" element={<PaperRoute />} />
            <Route path="/scenarios" element={<ScenariosPage />} />
            <Route path="/indicators" element={<IndicatorsPage />} />
            <Route path="/methodology" element={<MethodologyPage />} />
            <Route path="/ticker/:symbol" element={<TickerPage />} />
            <Route path="/admin/data" element={<DataFlowPage />} />
            <Route path="/admin/bugs" element={<AdminBugs />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
      <TweaksPanel />
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
