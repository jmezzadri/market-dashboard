# CLAUDE.md — MacroTilt

Binding rules for any agent working in this repository. `LESSONS.md` is the
full rulebook (read its index first); the rules below are the ones Joe stated
in his own words and that every change must satisfy before it is opened.

## Styling — one tokens file

- **Visual feedback is systemic. When Joe flags one visual issue, change the
  token, not the component, and list every page affected. Never hard-code a
  style value in a component.**
- Every colour, font size, font weight, spacing, radius, shadow and duration
  lives in `src/overhaul/styles/tokens.css` and nowhere else. Every colour
  token has a value for light and for dark. Components, inline JSX styles and
  CSS-in-JSX use `var(--…)` only. (Typefaces are declared once in
  `src/overhaul/styles/type.css`; see `docs/TYPOGRAPHY_STANDARD.md`.)
- A custom property resolves on the element that declares it: a token that
  references a scoped token is declared on every scope root (see the
  "Scoped shadows" block in `tokens.css`), never only on `:root`.
- LESSONS 9.22.

## Verification — three widths, two themes

- **Every UI change is verified at 390, 820 and 1440 wide, in light and dark,
  before the PR is opened. A mobile failure blocks the PR.**
- At 390 wide, on every page: no horizontal scrolling, no clipped or
  overlapping text, no element wider than the screen, tap targets at least
  44px (`--mt-tap`), body text at least 14px, the nav reachable, and the Home
  tiles stacked engine · brief · trade idea · upcoming data.
- `scripts/check_rendered_dom.mjs` (RENDERED-DOM-SMOKE) renders every public
  page at 390 in both themes and fails on horizontal scroll or any element
  overflowing the viewport. Run it against a local build before opening a
  PR: `BASE_URL=http://localhost:4321 PW_CHROMIUM=<chrome> node scripts/check_rendered_dom.mjs`.
  It also runs in CI on every frontend PR against the PR's own build.
- Screenshot every page at the three widths in both themes before and after;
  diff them; any difference nobody intended is a bug.
- LESSONS 9.23, 9.17, 9.18, 7.15.

## Working with Joe

- Three sentences. Plain English, no file names, no PR numbers, no terminal
  words. Anything needed from him on its own bolded line.
- Joe never touches GitHub. The agent opens, verifies and (when authorised)
  merges its own work.
