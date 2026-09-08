# /public/fonts

**Empty on purpose.** MacroTilt self-hosts no font files.

The site has three typefaces — IBM Plex Sans, IBM Plex Serif and IBM Plex
Mono — loaded from Google Fonts by the single `<link>` in `index.html` and
declared once in `src/overhaul/styles/type.css`.

2026-09-08: `fraunces.woff2`, `fraunces-italic.woff2`, `inter.woff2` and
`jetbrains-mono.woff2` were deleted. They were three families the site had
stopped choosing but had not stopped shipping.

Adding a font file here without adding it to `type.css` and
`scripts/check_fonts.mjs` fails the build. See `docs/TYPOGRAPHY_STANDARD.md`.
