/* OverhaulApp — root shell for the May 2026 site overhaul.

   Renders:
     - TweaksProvider (theme/accent/etc. persisted to localStorage)
     - BrowserRouter with the 9 page routes from the brief
     - Sidebar (rail / collapsed-rail) + TopNav (top) chrome variants
     - PageHeader with date / search / freshness pill / theme / tweaks
     - TweaksPanel slide-over

   Activated by appending ?v=3 to any URL in the live app (legacy gate
   lives in src/App.jsx). When the overhaul is feature-complete, the
   default render will flip to this shell.

   2026-05-27 (Joe): the /admin/data and /admin/bugs routes used to
   render a placeholder Stub saying "operational, not redesigned." That
   made both pages look blank in the new shell. Wire them through to the
   real AdminDataHealth and AdminBugs surfaces (legacy components, but
   they read the same CSS tokens — text/surface/border/accent — that the
   overhaul tokens.css defines, so they render in-brand without
   restyling). Wrapped each in <div className="mt-pagebody mt-fade"> so
   the page-level fade-in + horizontal padding match the rest of the
   shell. The legacy components use their own <main> wrapper; that's OK
   inside the overhaul shell because the outer <main className="mt-main">
   is the chrome container, not a content slot. */

import React from 'react';
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
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

// Real admin surfaces (legacy components, mounted into the overhaul
// shell so the sidebar links don't open a placeholder card).
import AdminBugs from '../AdminBugs';
import AdminDataHealth from '../AdminDataHealth';

function Shell() {
  return (
    <div className="mt-overhaul">
      <div className="mt-app">
        <Sidebar />
        <main className="mt-main">
          <TopNav />
          <PageHeader />
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/macro" element={<MacroPage />} />
            <Route path="/tilt" element={<TiltPage />} />
            <Route path="/scanner" element={<ScannerPage />} />
            <Route path="/portfolio" element={<PortfolioPage />} />
            <Route path="/scenarios" element={<ScenariosPage />} />
            <Route path="/indicators" element={<IndicatorsPage />} />
            <Route path="/methodology" element={<MethodologyPage />} />
            <Route path="/ticker/:symbol" element={<TickerPage />} />
            <Route
              path="/admin/data"
              element={
                <div className="mt-pagebody mt-fade">
                  <AdminDataHealth />
                </div>
              }
            />
            <Route
              path="/admin/bugs"
              element={
                <div className="mt-pagebody mt-fade">
                  <AdminBugs />
                </div>
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
