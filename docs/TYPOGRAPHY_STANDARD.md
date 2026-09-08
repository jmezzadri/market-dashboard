# Typography Standard — MacroTilt

**Joe-approved 2026-09-08.** Binding on the UX Designer for every sign-off and
on the Lead Developer for every PR that touches `src/`.

Enforced by `scripts/check_fonts.mjs`, which runs on every PR touching `src/`
or `index.html` via `.github/workflows/UI-STANDARDS-CHECK.yml`. This document
explains the rule; the script is the rule.

---

## The rule

**Three roles. One family each. No fourth family, ever.**

| Role | Token | Face | Used for |
|---|---|---|---|
| sans | `--mt-type-sans` | IBM Plex Sans | Every control, label, eyebrow, chip, button, table cell, tile heading and body line. The default for everything. |
| serif | `--mt-type-serif` | IBM Plex Serif | Editorial prose and the wordmark. The morning brief, the trade-idea note, page H1s that carry a written headline. **Nothing else is serif.** |
| mono | `--mt-type-mono` | IBM Plex Mono | Numerals only — prices, percentages, levels, dates in tables, tickers, counts. Always `tabular-nums`. |

All three are IBM Plex. That is the point: one superfamily shares a skeleton,
widths and vertical rhythm, so a card holding a serif headline, a sans label
and a mono figure reads as one voice instead of three.

## The four hard lines

1. **A font family name is written in exactly one file** —
   `src/overhaul/styles/type.css`. Nowhere else in `src/`, and not in a JSX
   style object. Every other stylesheet references a token.
2. **Only three tokens exist.** `--mt-type-sans`, `--mt-type-serif`,
   `--mt-type-mono`. The old names (`--v13-f-*`, `--mt-font-*`, `--sans`,
   `--serif`, `--ch-serif`, `--font-*`) survive only as aliases onto these
   three, so old code keeps resolving. Do not add an alias — change the code.
3. **Declared means loaded.** Every family named in `type.css` is requested by
   the single Google Fonts `<link>` in `index.html`, and that link requests
   nothing else. A family we ask for but never load renders as the visitor's
   system face, which is a typeface nobody chose.
4. **Mono is for figures.** A monospace face on a sentence is a defect, not a
   style. If a value is prose, it is sans.

## Fallbacks

Each stack ends in a system fallback so the page is readable during
`font-display: swap`. Fallbacks are a loading state, never a design choice: a
bare `font-family: monospace` or `sans-serif` in a component is a failure, not
a shortcut.

## Adding a weight

Weights are cheap; families are not. To add a weight, extend the existing
`family=` parameter in `index.html`. Never add a `family=`.

## Why this document exists

The doctrine was already written down twice — `v13.css` says "three roles, no
more" and `tokens.css` said the display face had been unified in July. Both
were comments. Neither was a check, and by 2026-09-08 four token systems named
six families while the three the pages actually asked for were never loaded at
all. LESSONS 7.15: a design rule that lives only in a prompt is a rule you will
be told about again. So it is a script now.
