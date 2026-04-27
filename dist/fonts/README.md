# /public/fonts/

Self-hosted Phase 2 font assets. Shipped alongside the app bundle — no CDN, no external DNS lookups.

- `fraunces.woff2` — variable serif (opsz 9-144, wght 300-700) — used for H1/H2 display type
- `fraunces-italic.woff2` — variable serif italic (same ranges) — used for italic display accents
- `inter.woff2` — variable sans (wght 100-900) — used for body UI text
- `jetbrains-mono.woff2` — variable mono (wght 400-700) — used for all numeric tabular data

Declarations live in `src/theme.css` (Phase 2 self-hosted block). Do not re-introduce Google Fonts or rsms.me CDN imports.
