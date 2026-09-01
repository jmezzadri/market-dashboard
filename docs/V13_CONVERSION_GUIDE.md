# v13 conversion guide

How to move a page from the cream v12 system to v13. Written 2026-09-01 after
converting Macro (#1593) and the shell (#1594), so the next eight pages do not
rediscover the same four traps.

Read `src/overhaul/styles/v13.css` first. It is the whole system and it is
deliberately closed: six type steps, six spacing steps, one radius, one row
height, one card, one table, one chip. **If a page needs a size that is not in
that file, the answer is the nearest step, not a new one.**

## The two rules Joe set, which override any aesthetic judgement

1. **Motion stays.** *"I don't want to lose the dynamic feel — when you scroll
   over things they move and highlight, clicking and all that."* Row hover tint
   plus a 2px accent rail, chevron nudge, card lift, scroll reveal. All of it
   dies under `prefers-reduced-motion`, which `v13.css` handles globally.
2. **Tiles in a row are identical.** *"If a page is 4 tiles, they should be the
   same size."* This inverts normal CSS instinct: **the grid track owns the
   height** and long content scrolls inside the tile. Use
   `grid-auto-rows: var(--v13-tile)`. A tile that sizes itself to its content is
   the bug, not the feature — that is what made the v12 pages ragged.

## Steps

1. **Grep the page for `var(--` before writing any CSS.**
   ```
   grep -o "var(--[a-z0-9-]*)" src/overhaul/pages/<Page>.jsx | sort -u
   ```
   Pages pass colour tokens **inline** from helpers like `stateColor()` and the
   regime-history colour map. Macro passes `--up`, `--down`, `--amber` and
   `--track`. Every one of them must be re-aliased to a v13 token at the top of
   the page's stylesheet. Miss one and the state dots and history strips render
   transparent — with no error.

2. **Write `<page>-v13.css`, scoped `.v13.<page>-v13`.** Two classes (0,2,0)
   beats cream's `.home-v12 .x` (0,2,0) on order alone, and beats it outright
   for element-level rules. Scoping to `.v13` only (0,1,0) ties with
   `.home-v12` and loses or wins depending on bundle order.

3. **Put `background`, `color` and `font-family` on the `.v13.<page>-v13` pair**,
   not on `.v13`. Relying on source order is how a page ends up half-converted —
   v13 type on a cream ground.

4. **Wire the page.** Swap the `<page>-v12.css` import for `v13.css` +
   `<page>-v13.css`; change the root class from `home-v12 <page>-v12` to
   `home-v12 v13 <page>-v13`. **Keep `home-v12`** — the shared chrome bridges
   off it (`#root:has(.home-v12)` in cream-system.css).

5. **Delete `<page>-v12.css` in the same PR**, after confirming nothing else
   imports it. Leaving it is how a stylesheet gets resurrected by the next
   person.

## Traps found so far

- **`display: contents` rows.** `.mac-irow` is `display: contents`, so it has no
  box. The hover rail has to live on the row's **first cell**, not the row.
- **Never `table-layout: fixed` with `text-overflow: ellipsis`.** It turned
  `10y yield` into `10y …` in the prototype. Numeric cells take `width: 1%`;
  the name column takes the slack.
- **The `.rv` scroll reveal can hide content forever.** It starts at
  `opacity: 0` and is only un-hidden when an IntersectionObserver adds `.in`.
  On a phone, content far below the fold never reveals if the observer does not
  fire — the six Macro tiles rendered as a blank column at 390px. `v13.css`
  now carries a zero-duration, 3s-delayed keyframe failsafe. **A reveal is a
  flourish, never a gate on readability.**
- **Never render a symbol the file does not import or define** (LESSONS 4.62).
  Run the undefined-component scan on any page whose render tree you touch.

## Verification — required before a page is called done

Build and serve the real production bundle, then drive it headless:

```
# .env.local must carry VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY,
# or the Supabase client falls back to placeholders and auth silently fails.
npm run build
npx serve -s dist -l 4321
# headless Chromium lives at /opt/pw-browsers/chromium
```

Assert, at **1440 light, 1440 dark and 390 phone**:

- zero page errors
- `document.documentElement.scrollWidth <= window.innerWidth`
- every tile in a row reports the **same** height
- computed page ground, row height and font family are the v13 values
- spot-check that a real value still reads correctly (not `—`, not truncated)

Signed-in pages: only `/portfolio-lab` is gated. Use the UAT account in
`ops_secrets` (`uat_account_email` / `uat_account_password`) — sign in through
the app's own form, or `POST /auth/v1/token?grant_type=password` with the anon
key and write the session to `localStorage` under
`sb-yqaqqzseepebrocgibcw-auth-token`. See LESSONS 4.63.

## Shipping from a cloud session

`git push` is refused by the git proxy. Use the `ops-code-commit` edge function
with `ops_secrets.gh_push_token` as the bearer token:

```
{ branch, commit_message, pr_title, pr_body, merge: true,
  files: [{ path, content_b64 } | { path, delete: true }] }
```

## Order

Macro and the shell are done. Remaining: Home, Paper, Scanner, Scorecard,
Ticker, Portfolio Lab, Methodology, Data. One PR per page so any regression is
one revert.
