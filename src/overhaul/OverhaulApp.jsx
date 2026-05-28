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
import DataFlowPage from './pages/DataFlowPage';
import Stub from './pages/_Stub';

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
