/* MacroTilt — App shell + page routing + tweaks state.
   Entry point for the multi-page prototype.                                 */

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "theme": "light",
  "accent": "blue",
  "density": "balanced",
  "sidebar": "rail",
  "fonts": "fraunces-inter",
  "numfmt": "commas",
  "typeScale": "editorial",
  "showHints": true
}/*EDITMODE-END*/;

const App = () => {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const [page, setPage] = useState(() => (window.location.hash || "#home").slice(1));
  const [ticker, setTicker] = useState(null);
  const openTicker = (sym) => setTicker(sym);
  const closeTicker = () => setTicker(null);

  /* Apply tokens by setting data-attrs on <html> */
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-theme",    t.theme);
    root.setAttribute("data-accent",   t.accent);
    root.setAttribute("data-density",  t.density);
    root.setAttribute("data-sidebar",  t.sidebar);
    root.setAttribute("data-fonts",    t.fonts);
    root.setAttribute("data-numfmt",   t.numfmt);
    root.setAttribute("data-type",     t.typeScale || "editorial");
  }, [t.theme, t.accent, t.density, t.sidebar, t.fonts, t.numfmt, t.typeScale]);

  /* Persist current page in hash so refresh keeps you here */
  useEffect(() => {
    window.location.hash = page;
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [page]);

  const setTheme = (next) => setTweak("theme", next);

  const PageComp = {
    home:           PageHome,
    macro:          PageMacro,
    tilt:           PageTilt,
    scanner:        PageScanner,
    portfolio:      PagePortfolio,
    scenarios:      PageScenarios,
    indicators:     PageIndicators,
    methodology:    PageMethodology,
    "admin-data":   AdminStub,
    "admin-bugs":   AdminStub,
  }[page] || PageHome;

  return (
    <div className="mt-app">
      <Sidebar page={page} setPage={setPage} />
      <main className="mt-main">
        <TopNav page={page} setPage={setPage} />
        <PageHeader onOpenTweaks={() => { /* tweaks toggle handled by host */ }}
                    theme={t.theme} setTheme={setTheme} />
        {ticker
          ? <PageTicker symbol={ticker} onClose={closeTicker} openTicker={openTicker} />
          : <PageComp setPage={setPage} openTicker={openTicker} t={t} />}
      </main>

      <MacroTiltTweaks t={t} setTweak={setTweak} />
    </div>
  );
};

const AdminStub = () => (
  <div className="mt-pagebody">
    <section className="mt-pagehero">
      <div>
        <div className="mt-eyebrow">Admin</div>
        <h1 className="mt-h1">Admin views <i>not</i> in scope.</h1>
        <p className="mt-deck">
          Admin · Data and Admin · Bugs are operational tools — they're not redesign-relevant.
          Linked from the sidebar so the IA matches your live site.
        </p>
      </div>
    </section>
  </div>
);

/* Tweaks panel content — uses controls from tweaks-panel.jsx starter */
const MacroTiltTweaks = ({ t, setTweak }) => (
  <TweaksPanel title="Tweaks · MacroTilt">
    <TweakSection label="Appearance" />
    <TweakSelect label="Theme" value={t.theme}
                 options={[
                   { value: "light", label: "Light · paper" },
                   { value: "dark",  label: "Dark · cool gray" },
                   { value: "navy",  label: "Navy · Copilot-inspired" },
                 ]}
                 onChange={(v) => setTweak("theme", v)} />
    <TweakColor label="Accent" value={t.accent}
                options={["blue","teal","violet","ink"]}
                onChange={(v) => setTweak("accent", v)} />
    <TweakRadio label="Density" value={t.density}
                options={["spacious","balanced","dense"]}
                onChange={(v) => setTweak("density", v)} />
    <TweakRadio label="Headline scale" value={t.typeScale || "editorial"}
                options={["editorial","monumental"]}
                onChange={(v) => setTweak("typeScale", v)} />

    <TweakSection label="Layout" />
    <TweakRadio label="Navigation" value={t.sidebar}
                options={["rail","rail-collapsed","top"]}
                onChange={(v) => setTweak("sidebar", v)} />

    <TweakSection label="Typography" />
    <TweakSelect label="Font pairing" value={t.fonts}
                 options={[
                   { value: "fraunces-inter", label: "Fraunces + Inter (default)" },
                   { value: "inter-only",     label: "Inter only" },
                   { value: "ibm-mix",        label: "IBM Plex Serif + Inter" },
                 ]}
                 onChange={(v) => setTweak("fonts", v)} />

    <TweakSection label="Numbers" />
    <TweakRadio label="Format" value={t.numfmt}
                options={["commas","abbrev","raw"]}
                onChange={(v) => setTweak("numfmt", v)} />

    <TweakSection label="Helpers" />
    <TweakToggle label="Show coach marks" value={t.showHints}
                 onChange={(v) => setTweak("showHints", v)} />
  </TweaksPanel>
);

/* Override TweakColor to render named accent swatches (4 cool palettes) */
window.MTAccentSwatchOverride = true;

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(<App />);
