// PageHero — single canonical header used by every top-level MacroTilt page.
//
// Locked spec (2026-05-13, Joe directive — "every page's Header and Subheader
// looks EXACTLY THE SAME"):
//   - eyebrow:  Inter 11 / 600 / 0.16em tracking / uppercase / --ink-3
//   - title:    Fraunces 40 / 400 / line-height 1.15 / --ink-0
//   - bullets:  Inter 14.5 / 400 / line-height 1.55 / --ink-2 / disc list
//   - vertical: 32px top padding, 14px eyebrow→title gap, 22px title→bullets
//   - grid:     max-width 1440, padding-x 32, 1fr / 380px right slot
//   - italic-accent words inside title: wrap them as <em> (auto styled
//     via .mt-page-title em — italic + --accent + same weight).
//
// Right slot is optional — each page keeps its bespoke summary widget
// (regime card, key stats, funnel, scenario picker, etc.) on the right.
// The LEFT column is pixel-identical across every page on purpose.
//
// CSS lives in src/v2/components/PageHero.css (imported here) so the
// styles are scoped to the component and travel with it.

import './PageHero.css';

export default function PageHero({ eyebrow, title, bullets = [], right = null }) {
  return (
    <header className="mt-page-hero">
      <div className="mt-page-hero-inner">
        <div className="mt-page-hero-left">
          {eyebrow ? <div className="mt-page-eyebrow">{eyebrow}</div> : null}
          <h1 className="mt-page-title">{title}</h1>
          {bullets && bullets.length > 0 ? (
            <ul className="mt-page-bullets">
              {bullets.map((b, i) => (
                <li key={i}>{b}</li>
              ))}
            </ul>
          ) : null}
        </div>
        {right ? <div className="mt-page-hero-right">{right}</div> : null}
      </div>
    </header>
  );
}
