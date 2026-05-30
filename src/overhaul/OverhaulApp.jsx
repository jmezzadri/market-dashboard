/* OverhaulApp — root shell for the May 2026 site overhaul.

   Renders:
     - TweaksProvider (theme/accent/etc. persisted to localStorage)
     - BrowserRouter with the page routes from the brief
     - Sidebar (rail / collapsed-rail) + TopNav (top) chrome variants
     - PageHeader with date / search / freshness pill / theme / tweaks
     - TweaksPanel slide-over

   Activated by appending ?v=3 to any URL in the live app (legacy gate
   lives in src/App.jsx). When the overhaul is feature-complete, the
   default render will flip to this shell.

   2026-05-28 — Paper Portfolio + Admin · Bugs routes added (PR #880). The
   sidebar has linked /paper and /admin/bugs since the overhaul shell
   shipped, but the router never had a /paper route (catchall sent users
   home) and /admin/bugs was a stub placeholder. Both pages already exist
   on disk (src/v2/pages/PaperPortfolioPage.jsx and src/AdminBugs.jsx)
   and are wired in here.

   2026-05-28 — legacy-bridge.css imported here for the first time. The
   file existed in the repo since 2026-05-27 but was never loaded, so the
   token aliases it defines never applied — V2 pages mounted in the
   overhaul shell rendered with light-mode colors regardless of the
   active theme. v3 of the bridge also extends the alias set to cover
   the V2 page token family (--bg-1, --ink-0, --line-0, etc.). Import
   ORDER matters: the bridge must load AFTER tokens.css so the
   .mt-overhaul-scoped aliases override the legacy :root tokens. */

import React from 'react';
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
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

// Legacy-bridge — maps legacy theme tokens (--surface, --bg-1, --ink-0,
// --line-0, etc.) to the overhaul --mt-* tokens so V2 / AdminBugs pages
// mounted inside the overhaul shell pick up the active theme palette
// in light, dark, and navy modes. Must load AFTER tokens.css.
import './styles/legacy-bridge.css';

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

// Pages that live outside the overhaul folder. PaperPortfolioPage is the
// v2 Alpaca paper-trading page; AdminBugs is the legacy admin triage
// dashboard. Mounted here as-is — no redesign yet, but wired so the
// existing sidebar links actually resolve.
import PaperPortfolioPage from '../v2/pages/PaperPortfolioPage';
import AdminBugs from '../AdminBugs';

function Shell() {
  const navigate = useNavigate();
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
            <Route path="/paper" element={<PaperPortfolioPage onOpenTicker={(symbol) => { if (symbol && symbol !== 'CASH') navigate(`/ticker/${symbol}`); }} />} />
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

