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

import { TweaksProvider } from './tweaks/TweaksContext';
import TweaksPanel from './tweaks/TweaksPanel';

import Sidebar from './chrome/Sidebar';
import TopNav from './chrome/TopNav';
import PageHeader from './chrome/PageHeader';

import HomePage from './pages/HomePage';
import MacroPage from './pages/MacroPage';
import TiltPage from './pages/TiltPage';
import ScannerPage from './pages/ScannerPage';
import PortfolioPage from './pages/PortfolioPage';
import ScenariosPage from './pages/ScenariosPage';
import IndicatorsPage from './pages/IndicatorsPage';
import MethodologyPage from './pages/MethodologyPage';
import TickerPage from './pages/TickerPage';
import DataFlowPage from './pages/DataFlowPage';
import Stub from './pages/_Stub';

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

function Shell() {
  return (
    <div className="mt-overhaul">
      <div className="mt-app">
        <Sidebar />
        <main className="mt-main">
          <TopNav />
          <PageHeader />
          <ScrollToTop />
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/macro" element={<MacroPage />} />
            <Route path="/tilt" element={<TiltPage />} />
            <Route path="/scanner" element={<ScannerPage />} />
            <Route path="/portfolio" element={<PortfolioPage />} />
            <Route path="/paper" element={<PaperRoute />} />
            <Route path="/scenarios" element={<ScenariosPage />} />
            <Route path="/indicators" element={<IndicatorsPage />} />
            <Route path="/methodology" element={<MethodologyPage />} />
            <Route path="/ticker/:symbol" element={<TickerPage />} />
            <Route path="/admin/data" element={<DataFlowPage />} />
            <Route
              path="/admin/bugs"
              element={
                <Stub
                  eyebrow="Admin · Bugs"
                  title={{ before: 'Operational, ', after: '.' }}
                  accent="not redesigned"
                  deck="The bug-report tooling stays in the legacy admin shell for now."
                />
              }
            />
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
