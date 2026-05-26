/**
 * TweaksPanel — the production design-knob panel.
 * Theme / accent / density / sidebar / fonts / type-scale.
 * State persists in localStorage under mt.* keys.
 */
import React from "react";

const FIELDS = [
  {
    key: "theme",
    label: "Theme",
    options: [
      ["light", "Light"],
      ["dark", "Dark"],
      ["navy", "Navy"],
    ],
  },
  {
    key: "accent",
    label: "Accent",
    options: [
      ["blue", "Blue"],
      ["teal", "Teal"],
      ["violet", "Violet"],
    ],
  },
  {
    key: "density",
    label: "Density",
    options: [
      ["spacious", "Spacious"],
      ["balanced", "Balanced"],
      ["dense", "Dense"],
    ],
  },
  {
    key: "sidebar",
    label: "Sidebar",
    options: [
      ["rail", "Rail"],
      ["rail-collapsed", "Collapsed"],
      ["top", "Top nav"],
    ],
  },
  {
    key: "fonts",
    label: "Fonts",
    options: [
      ["fraunces-inter", "Fraunces + Inter"],
      ["inter-only", "Inter only"],
      ["ibm-mix", "IBM Plex + Inter"],
    ],
  },
  {
    key: "type",
    label: "Headline scale",
    options: [
      ["editorial", "Editorial"],
      ["monumental", "Monumental"],
    ],
  },
];

export default function TweaksPanel({ open, onClose, prefs, setPrefs }) {
  if (!open) return null;
  const set = (k, v) => setPrefs({ ...prefs, [k]: v });

  return (
    <>
      <div
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.32)",
          zIndex: 9998,
        }}
      />
      <aside
        style={{
          position: "fixed",
          right: 0,
          top: 0,
          height: "100vh",
          width: 360,
          background: "var(--mt-surface)",
          borderLeft: "1px solid var(--mt-line-1)",
          padding: "24px 24px 32px",
          overflowY: "auto",
          zIndex: 9999,
          boxShadow: "-24px 0 64px rgba(0,0,0,0.2)",
        }}
      >
        <header
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 18,
          }}
        >
          <div>
            <div className="mt-eyebrow">Tweaks</div>
            <h3
              style={{
                fontFamily: "var(--mt-font-display)",
                fontSize: 22,
                fontWeight: 500,
                margin: "4px 0 0",
              }}
            >
              Make it yours
            </h3>
          </div>
          <button className="mt-iconbtn" onClick={onClose} aria-label="Close tweaks">
            ✕
          </button>
        </header>
        <p style={{ fontSize: 12.5, color: "var(--mt-ink-2)", lineHeight: 1.5, marginBottom: 22 }}>
          Choices persist for next visit. Reset by clearing the site's local
          storage in your browser.
        </p>

        {FIELDS.map((f) => (
          <section key={f.key} style={{ marginBottom: 20 }}>
            <div className="mt-eyebrow" style={{ marginBottom: 8 }}>{f.label}</div>
            <div className="mt-pillgroup" style={{ display: "flex", flexWrap: "wrap" }}>
              {f.options.map(([val, label]) => (
                <button
                  key={val}
                  className={`mt-pill ${prefs[f.key] === val ? "on" : ""}`}
                  onClick={() => set(f.key, val)}
                >
                  {label}
                </button>
              ))}
            </div>
          </section>
        ))}

        <div style={{ marginTop: 24, paddingTop: 18, borderTop: "1px solid var(--mt-line-0)" }}>
          <button
            className="mt-btn"
            onClick={() => {
              setPrefs({
                theme: "light",
                accent: "blue",
                density: "balanced",
                sidebar: "rail",
                fonts: "fraunces-inter",
                type: "editorial",
              });
            }}
          >
            Reset to defaults
          </button>
        </div>
      </aside>
    </>
  );
}
