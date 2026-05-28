/* OverhaulApp — root shell for the May 2026 site overhaul.

   2026-05-27 (Joe):
     /admin/data routes through AdminDataPage — a thin wrapper that
     renders AdminLanding (3-tile home: Polygon Massive · Unusual Whales
     · Data Health) by default, and hash-routes to the matching vendor
     detail page when a tile is clicked. /admin/bugs renders AdminBugs
     directly (no tile landing for it). legacy-bridge.css aliases the
     legacy --text/--surface/--border tokens to the overhaul --mt-*
     tokens so all four mounted admin surfaces follow the active theme
     (light/dark/navy) instead of rendering a transplant palette. */

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

import './styles/proto-lm-components.css';
import './styles/proto-pages.css';
import './styles/proto-methodology.css';

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
import PaperPage from './pages/PaperPage';
import TickerPage from './pages/TickerPage';

import AdminDataPage from './pages/AdminDataPage';
import AdminBugs from '../AdminBugs';

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
            <Route path="/paper" element={<PaperPage />} />
            <Route path="/scenarios" element={<ScenariosPage />} />
            <Route path="/indicators" element={<IndicatorsPage />} />
            <Route path="/methodology" element={<MethodologyPage />} />
            <Route path="/ticker/:symbol" element={<TickerPage />} />
            <Route path="/admin/data" element={<AdminDataPage />} />
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
