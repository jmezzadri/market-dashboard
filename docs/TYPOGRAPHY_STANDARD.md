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
| sans | `--mt-type-sans` | Inter | Every control, label, eyebrow, chip, button, table cell, tile heading and body line. The default for everything. |
| serif | `--mt-type-serif` | Newsreader | Editorial headlines and the wordmark. The morning brief headline, the trade-idea headline, the regime call on Home. **Nothing else is serif.** |
| mono | `--mt-type-mono` | IBM Plex Mono | Numerals — prices, percentages, levels, dates in tables, tickers, counts. Always `tabular-nums`. On the terminal pages (below) it also carries the capitalised labels. |

**2026-10-28 — the redesign changed the faces, not the rule.** Joe's approved
"MacroTilt Redesign" canvas sets Home as an editorial front page (Newsreader
headlines, Inter everything else) and Macro Landscape and Paper Portfolio as a
dark terminal (IBM Plex Mono figures and labels, IBM Plex Sans Condensed
headlines and indicator names). The three roles and three tokens are unchanged.
The one addition is a **scoped cut of the sans role**: inside a terminal page
root (`.mt-terminal`) `--mt-type-sans` resolves to IBM Plex Sans Condensed. It
is declared on one line in `type.css`, loaded by the one `<link>`, and
`check_fonts.mjs` allows exactly that one scoped line and nothing else. The
shared header sits outside the page root, so its menu stays Inter everywhere.

Before 2026-10-28 all three roles were IBM Plex (Sans / Serif / Mono).

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
   style. If a value is prose, it is sans. The terminal skin's exception is
   the **capitalised label** — a panel title, group heading, column head or
   marks line set in capitals, the way a terminal reads; the check treats a
   capitalised mono line inside `.mt-terminal` as a label. Sentence-case text
   on a terminal page (a note, a footnote, a description) is still prose and
   is still sans.

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

---

## The scale — added 2026-09-08 after round two

Joe, the same day, on the same page: *"The fonts are not fixed!!! They're all
different fucking sizes! Why all different sizes, some bold, others not."*

Round one fixed WHICH faces and left the sizes alone. Home was rendering 14
distinct sizes — 8 of them off the declared scale — and 4 weights with no rule
about which meant what.

### Six steps, plus two display steps. There is no ninth.

(`--v13-t7` 34px and `--v13-t8` 44px were added 2026-10-01 for the two
display sizes — the section headline and the regime call. The redesign of
2026-10-28 uses the same eight steps: Home's brief headline and regime call
are t8, its trade-idea headline t7; every terminal figure and label sits on
t1–t6.)

| Token | Size | Role |
|---|---|---|
| `--v13-t1` | 11px | label and eyebrow — uppercase, 700, letter-spaced |
| `--v13-t2` | 12px | meta, caption, the quiet line under a gauge or chart |
| `--v13-t3` | 13px | body, table cell, list row, the value half of a pair |
| `--v13-t4` | 15px | lead paragraph and editorial prose |
| `--v13-t5` | 18px | tile headline — one per tile, the largest thing in it |
| `--v13-t6` | 26px | the page hero, the one big figure, the regime line |

### Three weights. No fourth.

| Weight | Used for |
|---|---|
| 400 | body, prose, headlines. The default. |
| 600 | emphasis and values — the answer half of a labelled pair |
| 700 | uppercase labels only |

500 is gone. A number carries its emphasis through the mono face and tabular
figures, not through weight.

### Four hard lines on the scale

1. **No literal font-size anywhere in `src/`.** Only `var(--v13-t1..t6)`.
2. **No `clamp()` font-size, ever.** A viewport-derived size cannot land on a
   step, so two elements set that way cannot match at any window width. That
   is exactly why the two cockpit headlines were 19px and 18px.
3. **Same role, same type, declared together.** Sibling tiles doing the same
   job have their matching parts in ONE rule (see the ROLE PARITY block in
   `pages-v13.css`), not in two rules that happen to agree today.
4. **`<small>`, `<sub>`, `<sup>` are pinned.** A browser default shrink lands
   between steps — the tape's "close" rendered at 8.3px.

### The one opt-out

`data-mono="code"` on a formula or code block lets it keep the mono face for a
sentence. It goes in the markup, where a reviewer sees it — never as a quiet
exception inside the checker. `<code>` and `<pre>` count as declared.

### How this is verified

`node scripts/check_fonts.mjs` for the static half. For the rendered half,
build, serve `dist` on localhost, and run
`node scripts/check_fonts.mjs http://localhost:4321 / /macro /paper ...`.
It reports every element that renders off the scale, with its selector and its
numbers. That loop needs no browser extension and no approvals.

---

## Measure — added 2026-09-09

**No `max-width` on a text element.** Not `ch`, not `px`. The measure belongs to
the card or column — a box with an edge the reader can see — never to text
drawn inside a box it then refuses to fill. Joe has reported jammed text three
times (LESSONS 9.14, 7.15, 9.19); if a line feels too long, narrow the panel.

The one opt-out is a genuinely centred reading column: `data-measure="prose"`
plus real centring (`margin: 0 auto`), as on About / Terms / Privacy.

`scripts/check_layout.mjs` enforces it as the NARROW TEXT rule, alongside the
empty-grid-track and short-row rules. Run it the same way as the type check:

```
npm run build && npx serve -s dist -l 4321 &
node scripts/check_layout.mjs http://localhost:4321 / /macro /paper /scorecard /methodology
```
