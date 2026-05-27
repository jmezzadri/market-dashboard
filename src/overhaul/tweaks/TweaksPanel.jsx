/* TweaksPanel — minimal foundation version (PR-O1).
   Full ship version with grouped controls + reset comes in PR-O10.
   For PR-O1 the panel renders the essential six knobs so the foundation
   can be demoed end-to-end and Joe can flip theme/sidebar from day one. */

import React from 'react';
import { useTweaks } from './TweaksContext';

const OPTIONS = {
  theme: [
    ['light', 'Light · paper'],
    ['dark', 'Dark · cool gray'],
    ['navy', 'Navy · Copilot-inspired'],
  ],
  accent: [
    ['blue', 'Blue'],
    ['teal', 'Teal'],
    ['violet', 'Violet'],
    ['ink', 'Ink'],
  ],
  density: [
    ['spacious', 'Spacious'],
    ['balanced', 'Balanced'],
    ['dense', 'Dense'],
  ],
  sidebar: [
    ['rail', 'Sidebar'],
    ['rail-collapsed', 'Collapsed rail'],
    ['top', 'Top nav'],
  ],
  fonts: [
    ['fraunces-inter', 'Fraunces + Inter'],
    ['inter-only', 'Inter only'],
    ['ibm-mix', 'IBM Plex Serif + Inter'],
  ],
  typeScale: [
    ['editorial', 'Editorial'],
    ['monumental', 'Monumental'],
  ],
};

const LABELS = {
  theme: 'Theme',
  accent: 'Accent',
  density: 'Density',
  sidebar: 'Navigation',
  fonts: 'Type pairing',
  typeScale: 'Headline scale',
};

export default function TweaksPanel() {
  const { tweaks, setTweak, panelOpen, closePanel, resetTweaks } = useTweaks();
  if (!panelOpen) return null;

  return (
    <>
      <div
        onClick={closePanel}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.32)',
          zIndex: 200000,
          animation: 'mt-fade 160ms var(--mt-ease) forwards',
        }}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Tweaks"
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          width: 'min(380px, 100vw)',
          height: '100vh',
          background: 'var(--mt-surface)',
          borderLeft: '1px solid var(--mt-line-1)',
          color: 'var(--mt-ink-0)',
          fontFamily: 'var(--mt-font-ui)',
          padding: '24px 22px',
          overflowY: 'auto',
          zIndex: 200001,
          boxShadow: '-12px 0 32px rgba(0,0,0,0.18)',
        }}
      >
        <header
          style={{
            display: 'flex',
            alignItems: 'baseline',
            justifyContent: 'space-between',
            paddingBottom: 12,
            borderBottom: '1px solid var(--mt-line-0)',
            marginBottom: 16,
          }}
        >
          <div>
            <div className="mt-eyebrow">Tweaks</div>
            <h2 className="mt-h2" style={{ margin: '4px 0 0' }}>Customize the look</h2>
          </div>
          <button
            type="button"
            onClick={closePanel}
            className="mt-iconbtn"
            aria-label="Close tweaks"
          >
            ×
          </button>
        </header>

        {Object.entries(OPTIONS).map(([key, opts]) => (
          <div key={key} style={{ marginBottom: 18 }}>
            <div
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: 'var(--mt-ink-2)',
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                marginBottom: 8,
              }}
            >
              {LABELS[key]}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {opts.map(([val, label]) => {
                const isOn = tweaks[key] === val;
                return (
                  <button
                    key={val}
                    type="button"
                    onClick={() => setTweak(key, val)}
                    className={`mt-btn ${isOn ? 'mt-btn--primary' : ''}`}
                    style={{ fontSize: 12 }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
        ))}

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            paddingTop: 14,
            borderTop: '1px solid var(--mt-line-0)',
            marginTop: 10,
            fontSize: 11,
            color: 'var(--mt-ink-2)',
          }}
        >
          <span>Choices persist on this device.</span>
          <button type="button" className="mt-btn mt-btn--ghost" onClick={resetTweaks}>
            Reset
          </button>
        </div>
      </aside>
    </>
  );
}
