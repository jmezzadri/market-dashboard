/**
 * V2Shell — entry point for the redesigned MacroTilt site.
 *
 * Mounts under hash `#v2/<page>` (e.g. #v2/home, #v2/macro, #v2/ticker/NVDA).
 * Does not interfere with the legacy hash routing — the legacy App.jsx
 * detects the `#v2/` prefix and renders this shell instead.
 *
 * Council:
 *  - UX Designer: tokens loaded via CSS imports; data-attrs set on <html>.
 *  - Senior Quant: score math + indicator positioning come from src/redesign/data/score.js.
 *  - Lead Developer: routing is dumb hash matching, no React Router dependency.
 *  - Data Steward: every FreshnessChip receives (state, asOf) from the page layer,
 *    which is the seam where real freshness data plugs in.
 */
import React, { useEffect, useMemo, useState } from "react";

import "./styles/tokens.css";
import "./styles/components.css";
import "./styles/pages.css";
import "./styles/methodology.css";

import Sidebar, { TopNav } from "./components/Sidebar";
import PageHeader from "./components/PageHeader";
import TweaksPanel from "./components/TweaksPanel";

import HomePage from "./pages/HomePage";
import MacroPage from "./pages/MacroPage";
import TiltPage from "./pages/TiltPage";
import ScannerPage from "./pages/ScannerPage";
import PortfolioPage from "./pages/PortfolioPage";
import ScenariosPage from "./pages/ScenariosPage";
import IndicatorsPage from "./pages/IndicatorsPage";
import MethodologyPage from "./pages/MethodologyPage";
import TickerPage from "./pages/TickerPage";
import BisectPage from "./pages/BisectPage";

const VALID_PAGES = new Set([
  "home",
  "macro",
  "tilt",
  "scanner",
  "portfolio",
  "scenarios",
  "indicators",
  "methodology",
  "bisect",
]);

const DEFAULT_PREFS = {
  theme: "light",
  accent: "blue",
  density: "balanced",
  sidebar: "rail",
  fonts: "fraunces-inter",
  type: "editorial",
};

function loadPrefs() {
  if (typeof window === "undefined") return DEFAULT_PREFS;
  const out = { ...DEFAULT_PREFS };
  for (const k of Object.keys(DEFAULT_PREFS)) {
    try {
      const v = window.localStorage.getItem(`mt.${k}`);
      if (v) out[k] = v;
    } catch (e) {
      /* localStorage unavailable */
    }
  }
  return out;
}

function savePrefs(p) {
  if (typeof window === "undefined") return;
  for (const [k, v] of Object.entries(p)) {
    try {
      window.localStorage.setItem(`mt.${k}`, v);
    } catch (e) {
      /* ignore */
    }
  }
}

function parseHash() {
  // Hash form: #v2/<page>[/...]
  if (typeof window === "undefined") return { page: "home", subpath: [] };
  const h = (window.location.hash || "").replace(/^#/, "");
  if (!h.startsWith("v2/")) return { page: "home", subpath: [] };
  const segs = h.slice(3).split("/").filter(Boolean);
  if (segs.length === 0) return { page: "home", subpath: [] };
  const [page, ...rest] = segs;
  return { page, subpath: rest };
}

export default function V2Shell({ onExit }) {
  const [prefs, setPrefs] = useState(loadPrefs);
  const [tweaksOpen, setTweaksOpen] = useState(false);
  const [{ page: routePage, subpath }, setRoute] = useState(parseHash);
  const [ticker, setTicker] = useState(null);

  // Apply prefs to <html>
  useEffect(() => {
    if (typeof document === "undefined") return;
    const html = document.documentElement;
    html.setAttribute("data-theme", prefs.theme);
    html.setAttribute("data-accent", prefs.accent);
    html.setAttribute("data-density", prefs.density);
    html.setAttribute("data-sidebar", prefs.sidebar);
    html.setAttribute("data-fonts", prefs.fonts);
    html.setAttribute("data-type", prefs.type);
    savePrefs(prefs);
  }, [prefs]);

  // Clean up data-attrs when shell unmounts (so legacy doesn't inherit them)
  useEffect(() => {
    return () => {
      if (typeof document === "undefined") return;
      const html = document.documentElement;
      ["data-theme", "data-accent", "data-density", "data-sidebar", "data-fonts", "data-type"].forEach((a) =>
        html.removeAttribute(a)
      );
    };
  }, []);

  // Listen to hash changes
  useEffect(() => {
    const onHash = () => setRoute(parseHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // Escape closes drill bodies / tweaks
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") {
        if (tweaksOpen) setTweaksOpen(false);
        else if (ticker) setTicker(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tweaksOpen, ticker]);

  // Route resolution
  let page = routePage;
  if (page === "ticker") {
    page = "ticker";
  } else if (!VALID_PAGES.has(page)) {
    page = "home";
  }

  const navigate = (p) => {
    setTicker(null);
    window.location.hash = `v2/${p}`;
  };

  const openTicker = (symbol) => {
    if (!symbol) return;
    setTicker(symbol);
    window.location.hash = `v2/ticker/${symbol}`;
  };

  // Ticker from subpath
  const activeTicker = page === "ticker" ? subpath[0] || ticker : null;
  // Bisect step from subpath — included in memo deps so navigation between
  // #v2/bisect/1 → /2 → /3 actually re-renders the page.
  const bisectStep = page === "bisect" ? subpath[0] || null : null;

  const currentPage = useMemo(() => {
    if (page === "ticker" && activeTicker) {
      return (
        <TickerPage
          symbol={activeTicker}
          onBack={() => navigate("scanner")}
          openTicker={openTicker}
        />
      );
    }
    switch (page) {
      case "macro":
        return <MacroPage openTicker={openTicker} setPage={navigate} />;
      case "tilt":
        return <TiltPage openTicker={openTicker} setPage={navigate} />;
      case "scanner":
        return <ScannerPage openTicker={openTicker} setPage={navigate} />;
      case "portfolio":
        return <PortfolioPage openTicker={openTicker} setPage={navigate} />;
      case "scenarios":
        return <ScenariosPage openTicker={openTicker} setPage={navigate} />;
      case "indicators":
        return <IndicatorsPage openTicker={openTicker} setPage={navigate} />;
      case "methodology":
        return <MethodologyPage setPage={navigate} />;
      case "bisect":
        return <BisectPage subpath={subpath} setPage={navigate} openTicker={openTicker} />;
      case "home":
      default:
        return <HomePage openTicker={openTicker} setPage={navigate} />;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, activeTicker, bisectStep]);

  const sidebarPage = page === "ticker" ? "scanner" : page === "bisect" ? "home" : page;

  return (
    <div className="mt-app">
      <Sidebar page={sidebarPage} setPage={navigate} onLegacy={onExit} />
      <main className="mt-main">
        {prefs.sidebar === "top" && <TopNav page={sidebarPage} setPage={navigate} />}
        <PageHeader
          theme={prefs.theme}
          setTheme={(t) => setPrefs({ ...prefs, theme: t })}
          onOpenTweaks={() => setTweaksOpen(true)}
        />
        <div className="mt-pagebody">{currentPage}</div>
      </main>
      <TweaksPanel
        open={tweaksOpen}
        onClose={() => setTweaksOpen(false)}
        prefs={prefs}
        setPrefs={setPrefs}
      />
    </div>
  );
}
