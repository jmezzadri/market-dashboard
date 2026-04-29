# UX Designer brief — pivot MacroTilt to Marquee Market View aesthetic

**Filed by Joe 2026-04-29.** Read this end-to-end before starting Phase 1.

## Mission
Redesign MacroTilt's visual language to match the Goldman Sachs Marquee Market View aesthetic — institutional, restrained, dense-but-readable, instantly responsive. Move away from the current parchment + Coutts-heritage feel. The brand pivot is intentional: this is no longer "premium private bank," it's "professional desktop terminal."

## Reference targets
1. **Goldman Sachs Marquee Market View** — primary aesthetic anchor.
2. Bloomberg Terminal (web) — color discipline + density.
3. Stripe Dashboard — animation restraint + typography.
4. Linear app — hover-state quality + transition timing.

You are NOT copying any of these. You are extracting principles and translating them into MacroTilt's specifics.

## Visual principles (binding)
1. **Restraint as premium.** Minimal accent color use. One brand accent, deployed only for active state and direction (green up / red down). No multi-color decoration.
2. **Density inside, breathing outside.** Data tables tight; surrounding whitespace generous. The eye should rest on whitespace, then drink in the data.
3. **Instant interactions.** Hover states are crisp and immediate (≤120ms). No 400ms bounce-fades. Premium = fast, not flashy.
4. **Crisp 1px lines over heavy shadows.** Borders communicate structure; shadows are the exception, not the rule.
5. **Typography does the work.** Modern sans-serif for everything (Inter / system stack). Retire the Fraunces editorial display serif from data surfaces — keep it (if at all) for one hero per page max. Mono for numbers.
6. **Light AND dark mode as equals.** Marquee is dark-default; MacroTilt should ship dark + light parity from day one with the new palette.

## Current state to retire
- Parchment background gradient (`--mt-accent-warm`, `--mt-oxblood`) on data surfaces.
- Fraunces serif on every panel header — over-deployed.
- Mixed shadow weights across panels — inconsistent.
- Hover states are mostly absent or use generic browser defaults.
- No motion vocabulary — everything is static.

## Scope of work — in this order

### Phase 1: Audit (use `design:design-critique` skill)
Critique the live `TickerDetailModal` on macrotilt.com. Specifically:
- Hero block + KPI strip
- Signal Intelligence rail (7 tiles)
- Chart customize panel
- Bottom tabs (About / Dividend history / Splits)
- Action row
- Modal layout overall

Output: 10-bullet critique grouped by usability / hierarchy / consistency, with specific evidence per bullet.

### Phase 2: Design system update (use `design:design-system` skill)
Define the new Marquee-inspired token set:
- **Color**: 1 neutral palette (10 steps), 1 accent, 2 directional (up/down). Document HSL values and accessibility contrast for each on dark + light.
- **Typography**: 1 sans-serif family (Inter recommended), 1 mono. Define the type scale (5-7 sizes), weights used, letter-spacing per size.
- **Spacing**: 4px base, 8-step scale.
- **Radius**: 3 levels max.
- **Elevation**: 3 shadow tokens max (none / subtle / pronounced). Most components use `none` + a 1px border.
- **Motion**: 3 timing tokens (`fast` 80ms / `medium` 160ms / `slow` 240ms). Single easing function (`cubic-bezier(0.16, 1, 0.3, 1)` Apple-style ease-out). Document which transitions use which.

Output: token spec doc + Figma library, plus a side-by-side of current vs proposed for one surface (the modal hero).

### Phase 3: Component motion vocabulary
Define the specific interactions for these primitives:
- Card hover: 1px border darkens, 80ms.
- Row hover (tables): subtle background tint, 80ms, cursor pointer.
- Button hover: bg saturates one step, 120ms.
- Tab switch: underline slides between tabs, 160ms.
- Tile expand/collapse (Signal Intelligence rail): height transitions, 160ms.
- Modal open: 160ms fade + 4px translate-up. No scale.
- Loading state: 1.4s linear shimmer skeleton.

**NO parallax on data surfaces.** Parallax fights data legibility. Use parallax (if at all) only on marketing/landing pages, not the modal.

### Phase 4: Handoff (use `design:design-handoff` skill)
Generate dev specs for the modal redesign — Figma frames + the spec sheet covering layout, tokens, component props, interaction states, responsive breakpoints, edge cases, and animation details. Lead Developer ships against the spec.

## Anti-patterns (do NOT introduce)
- No glassmorphism / frosted blur on cards.
- No gradient backgrounds on data surfaces.
- No emoji icons.
- No bouncy spring animations.
- No hover lift with shadow growth ("card jumps up").
- No rotating logos, no decorative SVG flourishes.
- No serif typography on dense data tiles.
- No multi-color tags. All tags are neutral; only direction (up/down) gets color.

## Quality bar
Every screen must pass this single test: **shown side by side with Marquee Market View, would a portfolio manager call them peers?** If the answer is "MacroTilt looks more decorative," go back.

## Deliverables
1. Critique doc (Phase 1 output).
2. Design tokens doc + Figma library (Phase 2).
3. Motion spec sheet (Phase 3).
4. Modal redesign spec (Phase 4) — frame-by-frame, every interaction state, every breakpoint.
5. One short Loom (or written) walkthrough explaining the brand pivot rationale to the rest of the team.

## Constraints
- Light + dark mode parity, both shipping in the same PR cycle.
- WCAG 2.1 AA on all color/contrast combinations (use `design:accessibility-review` skill before handoff).
- Follow the existing CSS-token plumbing (`var(--*)` everywhere, no hardcoded hex except in the token file).
