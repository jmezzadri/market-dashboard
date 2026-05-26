# Handoff · MacroTilt v2 site overhaul

**For:** the Cowork engineering session that will implement this in `market-dashboard-live/`
**Authored by:** Claude Design, May 26 2026
**Owner:** Joseph

---

## What this is — and what it isn't

The HTML/JSX/CSS in this folder is a **hi-fi clickable design reference**, not production code to lift verbatim.

- It runs in a browser via Babel-in-the-page (one-off prototype harness).
- It uses **inline JSX scripts** loaded with `<script type="text/babel">` and a `data-attr` token system — neither of which belongs in the production Vite/React app.
- Mock data is hand-authored in `lm-core.jsx` (`MT_INDICATORS`, `MT_SECTORS`, `MT_IG`, etc.). All of it must be replaced with the real Supabase/FRED/Polygon/UnusualWhales feeds the live app already exposes.

**Your job, Cowork:** recreate this design in `market-dashboard-live/` using its existing React + Vite + Supabase stack, its existing data hooks, the existing `FreshnessDot` / `DataFreshness` components, and the existing routing. The point is **pixel-and-interaction fidelity** to the prototype, with the project's actual data wired in.

---

## Fidelity

**High-fidelity.** Exact colors, type scale, spacing, motion durations, and interaction patterns are pinned. Reproduce them faithfully. Where the prototype shows a layout that conflicts with the existing app's chrome (e.g. the auth header), prefer the prototype's version — it's the redesign.

---

## Source of truth

The canonical demo is `macrotilt.html` — open it in a browser and click every page. Treat what you see and feel there as the spec. If this README ever disagrees with the running prototype, the prototype wins.

---

## Architecture · 30,000 ft

```
┌─ Sidebar (rail / collapsed-rail / top-nav)
└─ Main
   ├─ TopNav (only when sidebar = "top")
   ├─ PageHeader (date · search · freshness pill · theme · tweaks)
   └─ <PageX setPage openTicker /> — one of:
        Home, Macro, Tilt, Scanner, Portfolio,
        Scenarios, Indicators, Methodology, Ticker
```

- Page routing in the prototype is a single `useState("home")` + `window.location.hash`. In production, use the existing React Router setup — one route per page id below.
- `openTicker(symbol)` is a global "drill to a ticker detail page" action. In production it should push `/ticker/{symbol}` and a `Back` button returns.

---

## Pages

Eight pages plus a global ticker detail. Order matches the sidebar.

### 1. Home (`pages/home.jsx`)
- Editorial hero: eyebrow + Fraunces H1 with one italic accent word (the regime call) + one-paragraph deck with **hover-tip definitions**, never static captions.
- Three stat tiles (Stress signal · Yield regime · Indicators 9/27).
- **Two-column "today's read":**
  - Left, ~60%: regime map (`RegimeCanvas`) at 1.55:1 aspect. Indicator dots only — no sector overlay on Home. Click a dot → opens `IndicatorDetail` below the section.
  - Right, ~40%: "Engine call · today" card. Shows the regime label, equity/defensive split, then **all 11 sectors** as a single sorted bar chart of nominal allocation (`weight + tilt`), no SPY comparison.
- Three feature cards: Trading scanner, Portfolio insights, Scenario analysis. Each big numbered card opens its page.
- Market news list (time · headline · source) with hover.

### 2. Macro Overview (`pages/macro.jsx`)
- Hero + a right-column "On this page" stat card (27 indicators · vol triggers · cycle composite · reference).
- Domain strip: 5 clickable cards (Rates · Credit · Equities · Money · Economy) with state counts + a percentile dot row.
- Filter bar: state pills (All/Extreme/Elevated/Calm) + domain pills + Map ↔ Grid view toggle.
- **Map view:** the regime canvas with all indicators positioned. Click a dot → `IndicatorDetail`.
- **Grid view:** indicators grouped by domain, each domain section with state-count tags + a grid of `IndicatorCard`s. Click a card → `IndicatorDetail`.

### 3. Asset Tilt (`pages/tilt.jsx`)
- Hero headline is the **nominal allocation** in monumental display type: `100% equity · 0% defensive`. Deck explains the regime call.
- Small "Backtest 1986–2026" stats card (CAGR / Sharpe / Max DD / Validated) — not the headline.
- Engine read row: two `BigGauge`s (Stress signal · Yield regime) + a Stance card.
  - Each gauge has a three-zone arc (green / amber / red), a single black needle for the current value, and a **3-card legend** below labeling the zones with their numeric ranges (no labels inside the SVG).
- Sector flow: full `SectorFlow` with click-to-expand sectors → IGs → tickers (3-level drill).
- Regime history strip: 24 weekly cells colored by yield regime, with risk on/watch/off stripe under each.

### 4. Trading Scanner (`pages/scanner.jsx`)
- Hero + result-summary card with three score buckets (7+, 5–6, 3–4) as clickable filters.
- No Long/Short toggle (engine is long-only today). Inline note "Long signals only" with hover-tip explanation.
- Toolbar: score pills · `+ Filter` · `⚙ Columns 11/14` (opens an inline column picker, not a modal).
- A blue callout describing the scoring methodology change on 2026-05-21 (live: dark pool + options).
- `ScanList` — each card is a row with ticker (clickable → ticker page), score dial, price + change, sparkline, facet icons (insider/dark/options) with hover-tips, expand chevron.
- Drill body: two columns. Left = **score math table** that reconciles to the headline score (component / weight / score /5 / contribution /10). Right = 90-day chart with **event markers (A/B/C/N)** + an event list + three working buttons (Open detail → / + Watchlist / Copy ticker).

### 5. Portfolio Insights (`pages/portfolio.jsx`)
- Hero with key-stats card (Total wealth, TTM, Beta, Sharpe — small vs-SPY subline only).
- **Account grid:** 6 cards, each clickable. Clicking drills inline (no modal) into a per-account view showing performance chart + positions table with ticker · score · value · P/L.
- Allocation breakdown card with a 3-tab pill: By account · By sector · By asset class.
- Positions list: each row shows MT score, market value, **cost basis P/L $ and %**, last price, sparkline. Drill body shows scoring composition + cost basis / market value / P/L.

### 6. Scenario Analysis (`pages/scenarios.jsx`)
- Hero + scenario picker (8 historical + Custom).
- For canned scenarios: header card with title, blurb, peak drawdown, engine call.
- For Custom: 4 sliders (MOVE × multiplier, 10Y Δ, USD Δ, Brent Δ) + horizon pills (1M/3M/6M).
- Strategy comparison table (SPX, 60/40, Your portfolio, Asset Tilt).
- Side-by-side: engine sector response + per-position P/L for the chosen horizon.

### 7. All Indicators (`pages/indicators.jsx`)
- Hero + a small summary card (vol triggers / cycle composite / reference counts).
- Filter toolbar: Layer pills + Category pills + `+ Filter` + `⚙ Columns 11/14`.
- Full sortable table: indicator (name + id) · category · freq · type · last refresh (with `FreshnessChip`) · current · 3m / 6m / 12m historical · 5y sparkline.
- Click row → inline expand with `IndicatorDetail` below.

### 8. Methodology (`pages/methodology.jsx`)
- Editorial long-form. 8 numbered sections (Macro / Tilt / Scanner / Portfolio / Scenarios / Freshness / Sources / Changelog).
- TOC at top with deep-link `#id` anchors.
- Each section uses a `me-formula` block (mono font in a tinted card) for the actual math.
- A vendor table (FRED, Polygon, Unusual Whales, etc.) and a changelog list.

### 9. Ticker Detail (`pages/ticker.jsx`)
- Reached via `openTicker(symbol)` from anywhere a ticker symbol appears.
- Monumental ticker symbol + name + meta (exchange · market cap · vol) + price + change.
- A circled `MacroTilt Score` card top-right.
- Price-history chart with timeframe pills (1M/3M/6M/1Y/5Y/Max) + overlay buttons (+ 50d SMA, + 200d SMA, + Volume, + Events, + Compare ticker).
- Key-stats grid (12 cells: Open/High/Low/52w hi/lo/Avg vol/PE/Div/Beta/EPS/Float/Inst hold).
- Tab pills: Score breakdown · Insider · Options flow · Dark pool · News · Fundamentals. Each renders inline below.
- Related names grid (4 cards in same sector, each clickable).

---

## Design System · tokens

All theme tokens live in `lm.css` on `:root` (light default) and `[data-theme="dark"]` / `[data-theme="navy"]`. Apply by setting `data-theme`, `data-accent`, `data-density`, `data-sidebar`, `data-fonts`, `data-type` attributes on `<html>`.

### Color tokens — light

| Token              | Value                       | Use                              |
|--------------------|-----------------------------|----------------------------------|
| `--mt-bg`          | `#f4f3ee`                   | Page canvas                      |
| `--mt-surface`     | `#ffffff`                   | Card, sheet                      |
| `--mt-surface-2`   | `#fafaf6`                   | Drill body                       |
| `--mt-surface-3`   | `rgba(20,23,28,0.04)`       | Hover, pill bg                   |
| `--mt-ink-0`       | `#15181d`                   | Primary text                     |
| `--mt-ink-1`       | `#3a3f47`                   | Secondary text                   |
| `--mt-ink-2`       | `#6b7280`                   | Tertiary, captions               |
| `--mt-ink-3`       | `#a1a6ad`                   | Quaternary                       |
| `--mt-line-0`      | `rgba(20,23,28,0.06)`       | Hairlines                        |
| `--mt-line-1`      | `rgba(20,23,28,0.14)`       | Stronger borders                 |
| `--mt-accent`      | `#0a5cd1`                   | Brand blue                       |
| `--mt-accent-soft` | `rgba(10,92,209,0.08)`      | Selected row bg                  |
| `--mt-accent-glow` | `rgba(10,92,209,0.16)`      | Focus shadows                    |
| `--mt-up`          | `#1f9d60`                   | Positive direction (semantic)    |
| `--mt-down`        | `#c1394f`                   | Negative direction (semantic)    |
| `--mt-warn`        | `#c08428`                   | Elevated state (semantic, never decorative) |

### Color tokens — dark / navy

Dark: cool gray-black baseline (`--mt-bg: #0b0e13`).
Navy: Copilot-Money-inspired deep navy (`--mt-bg: #000814`, `--mt-surface: #001533`, `--mt-surface-2: #00204d`, text at 92% white).

Both presets are in `lm.css` — copy whole blocks.

### Typography

- **Display:** `Fraunces` (variable, opsz 9–144) at 300–600. Used for H1, H2, big numbers, hero figures. Italic for **one** accent word per heading.
- **UI:** `Inter` 300–700.
- **Numerals:** `font-variant-numeric: tabular-nums` everywhere (class `.num`). Set on the *element*, not the page.
- **Mono (only on Trading Desk variant):** `JetBrains Mono`.

### Type scale

- H1 editorial: `clamp(36px, 4.2vw, 56px)`, weight 400, letter-spacing `-0.025em`.
- H1 monumental (Tweak option): `clamp(72px, 9vw, 112px)`, weight 500, letter-spacing `-0.04em`.
- H2: 28px, weight 400, letter-spacing `-0.02em`.
- Eyebrow: 10.5px, weight 600, letter-spacing `0.18em`, uppercase, `var(--mt-ink-2)`.
- Body: 14.5–16px, line-height 1.55–1.6.

### Spacing

- Density scale on `data-density="spacious|balanced|dense"`. Use `var(--mt-pad-page)` / `var(--mt-pad-card)` / `var(--mt-gap-section)` / `var(--mt-gap-card)` / `var(--mt-row-h)` — they re-token per density.
- Radii: `--mt-r-sm: 6px` · `-md: 10px` · `-lg: 14px` · `-xl: 18px`.

### Motion

| Token                | Value                                | Use                              |
|----------------------|--------------------------------------|----------------------------------|
| `--mt-ease`          | `cubic-bezier(0.2, 0.8, 0.2, 1)`     | All transitions                  |
| `--mt-dur-fast`      | `160ms`                              | Hover, focus                     |
| `--mt-dur-med`       | `280ms`                              | Card lift, drill open            |
| `--mt-dur-slow`      | `460ms`                              | Number tweens, chart paths       |

- Animated numbers tween 520ms ease-out-cubic. Component: `AnimatedNumber` in `shared.jsx`.
- Drill-down panels fade-in 280ms.
- Sparklines draw on mount, no animation on data change.
- `prefers-reduced-motion: reduce` disables all entry animations.

---

## Shared components

These are the reusable building blocks. Rebuild as proper React components in the production codebase.

### `<FreshnessChip state={'fresh'|'stale'} asOf={...} variant={'dot'|'label'|'pill'} label />` (`shared.jsx`)
The most-used atom. Three states (fresh/stale/checking) × three variants. Hover shows an instant portal tooltip. **Every value renders one.** In production, wire to the existing `useFreshness(elementId)` hook backed by `data_manifest.json` + `pipeline_health`. Never accept a hard-coded freshness string.

### `<Tip content side="top|right|bottom|left" bare block>{children}</Tip>` (`shared.jsx`)
Portal'd hover tooltip used everywhere "static caption" used to live. Replaces dotted underline + position-aware tooltip. `bare` removes the underline; `block` makes it `display: block` (used on sidebar nav items).

### `<AnimatedNumber value format={fn} prefix suffix duration={520} />` (`shared.jsx`)
Tweens between values. Use everywhere a live tape value renders.

### `<Sparkline data width height stroke fill area showDot onHover />` (`shared.jsx`)
SVG line with optional area fill and final-point dot. Hover emits index + value.

### `<RegimeCanvas data onHover hover onSelect selected aspect />` (`lm-shared.jsx`)
The 2D regime map. Renders quadrant tints, axes, engine-call marker (top-left, no pulse), and indicator dots positioned via `positionIndicators(inds)`. Pass `aspect={1.55}` for Home preview, `{1.78}` (default) for Macro page.

### `<IndicatorDetail ind onClose onMethodology onCompare />` (`lm-shared.jsx`)
Inline panel that opens below the map when a dot is clicked. Has TF pills (1Y/5Y/10Y/Max), `BigHistoryChart` with hover crosshair, a `PercentileBar` showing 5y distribution, mean/median/σ/z-score stats, a related-indicators list, and two working buttons (Methodology / + Compare). Compare opens an inline picker; selecting a 2nd indicator overlays it dashed.

### `<BigHistoryChart data accent height compareData compareAccent />` (`lm-core.jsx`)
Wide history chart with grid-line y-ticks, area fill, hover crosshair, and a floating value tooltip. **Measures its container** via `ResizeObserver` and sets viewBox width to actual rendered width — never use `preserveAspectRatio="none"`, it distorts text.

### `<ScoreDial score max size />` (`lm-core.jsx`)
Donut + center number. Used on scanner rows, IG ticker lists, ticker page header (with `size={96}`).

### `<SectorFlow sectors igData expandedSectors expandedIGs toggleSector toggleIG openTicker />` (`lm-shared.jsx`)
The sector → IG → ticker 3-level drill. Each level expands inline with a chevron rotate. Tickers in the IG list are clickable → `openTicker(symbol)`.

### `<ScanList rows drillOpen setDrillOpen onOpenTicker onAct />` (`lm-shared.jsx`)
The scanner table. `onAct(action, ticker)` fires for "watchlist" / "copy" — copy uses `navigator.clipboard`.

### `<ScanDrill row onOpenTicker onAct />` (`lm-shared.jsx`)
The scanner-row drill. **Score math table** that reconciles to the headline score via `breakdownForTicker(row)` from `MT_SCORE_WEIGHTS`. Right column: `EventChart` (sparkline + A/B/C/N event markers anchored to specific day indices) + event list + three working CTAs.

### `<BigGauge value max thresholds bidirectional />` + `<GaugeLegend zones />` (`pages/tilt.jsx`)
Three-zone arc with a single black needle. **No labels inside the SVG** — the legend below is a 3-card row showing zone label + numeric range.

### `<Sidebar page setPage />` and `<TopNav page setPage />` (`lm-core.jsx`)
Two layouts of the same nav. Every item wrapped in a `<Tip side="right" bare block>` so collapsed-rail still gets tooltips.

---

## Data shapes (mock → real)

Replace the mock arrays in `lm-core.jsx` with these real sources from the existing `market-dashboard-live` codebase:

| Mock                  | Real source                                                                 |
|-----------------------|------------------------------------------------------------------------------|
| `MT_INDICATORS`       | `useIndicators()` hook · joined with `pipeline_health` for freshness         |
| `MT_SECTORS`          | `useSectorTilts()` hook from Asset Tilt engine                               |
| `MT_IG`               | `useIndustryGroups(sectorCode)`                                              |
| `MT_SCANNER`          | `useScannerResults(bucket)` — already exists                                 |
| `MT_PORTFOLIO_ACCOUNTS` / `MT_POSITIONS` | `usePortfolio()` + Plaid/CSV-import schema                |
| `MT_NEWS`             | Unusual Whales news endpoint                                                 |
| `MT_SCENARIOS`        | Static config in `scenario_definitions.json`                                 |

`positionIndicators(inds)` in `lm-shared.jsx` derives an (x, y) for each indicator on the regime canvas — keep this logic exactly as-is (anchors x to `state`, y to `domain`), don't switch back to raw percentile.

`breakdownForTicker(row)` in `lm-shared.jsx` is the **public score math**. The headline score must equal `Σ (component_score / 5) × weight × 10`. Weights:

```
Technicals  0.25
Insider     0.20
Analyst     0.20
Options vol 0.15
Congress    0.10
Dark pool   0.10
```

Replace this function with one that pulls real per-component scores from the scoring service.

---

## Tweaks panel (`tweaks-panel.jsx` + `app.jsx`)

Drop the prototype tweaks panel — it's only for design exploration. Don't ship it. The token system (`data-theme`, `data-accent`, etc.) is fine to keep; just hardwire to Joseph's preferred values (currently: theme **light** or **navy**, accent **blue**, density **balanced**, sidebar **rail**, fonts **fraunces-inter**, type-scale **editorial**).

---

## Interaction rules

- **No modals.** Everything drills inline. Drill bodies appear below the row/card that opened them and fade-in 280ms.
- **Hover tooltips, never static captions.** If you find yourself writing a `<p>today's reading is stressed</p>` next to a number, replace it with a `Tip` wrapping the number.
- **Every value has a `FreshnessChip`.** No exceptions. Aggregates roll up — if any dependency is stale, the parent chip flips red.
- **Tabular numerals on every number.** Use the `.num` class.
- **Tickers are always clickable.** Anywhere a ticker symbol appears, it opens the ticker detail page.
- **Esc closes** any open drill, picker, or detail panel.
- **Keyboard:** TF pills are focus-able, score buckets are buttons. Implement proper focus rings.

---

## Decisions · baked in

These are settled — Cowork should not re-litigate.

| Topic                  | Decision                                                                          |
|------------------------|-----------------------------------------------------------------------------------|
| **Routing**            | Path-based React Router. Routes: `/`, `/macro`, `/tilt`, `/scanner`, `/portfolio`, `/scenarios`, `/indicators`, `/methodology`, `/ticker/:symbol`. Active route reflects in the sidebar. |
| **Portfolio data**     | **CSV upload only** for v1 (Chase / Fidelity / Schwab). Render the "Connect brokerage via Plaid" CTA as a *disabled* button with a `Tip` reading "Coming soon". Don't wire Plaid yet. |
| **Real-time updates**  | **No live tape.** Data refreshes daily from the existing batch pipelines. Remove the `setInterval` jitter in `useTickerJitter` — just render the value statically with its `FreshnessChip`. |
| **Headline scale**     | **Editorial** is the default (~56px). Monumental stays as a Tweak option but is not the default. |
| **Default theme**      | First visit defaults to **Light**, then the user's Tweak choice persists in `localStorage` under `mt.theme`. Same for accent, density, sidebar, fonts. |
| **Macro default view** | Map ↔ Grid choice **persists per user** under `mt.macro.view`. First-time visitor sees the Map. |
| **Tweaks panel**       | **Ship it.** The user wants the theme/accent/density/font/headline-scale knobs in production. Skip only the dev-only options (e.g. number-format raw, coach-marks toggle) unless you want to keep them. |

## Scope · phase 1

All 9 page surfaces are in scope for the first build, plus the shared tokens/sidebar foundation. Suggested implementation order to maximize reuse:

1. **Foundation** — tokens (`lm.css`), Sidebar, TopNav, PageHeader, `FreshnessChip`, `Tip`, `AnimatedNumber`, `Sparkline`, `ScoreDial`. Get the chrome and shared atoms in place first.
2. **All indicators** — simplest data-bound page; proves out the indicator hook + the freshness contract.
3. **Macro overview** + `RegimeCanvas` + `IndicatorDetail` — unlocks reuse across Home and the indicator drill anywhere.
4. **Asset Tilt** — `BigGauge`, `GaugeLegend`, `SectorFlow` — unlocks reuse on Home.
5. **Trading scanner** + `ScanList`, `ScanDrill`, score math, `EventChart`.
6. **Ticker detail** — the universal drill target.
7. **Portfolio insights** — layered on top of scanner + ticker components.
8. **Scenario analysis**.
9. **Methodology** — mostly static, do last.
10. **Home** — wires the above together; do last so it can compose finished components.

## Files in this bundle (handoff)

| File                                  | Purpose                                              |
|---------------------------------------|------------------------------------------------------|
| `macrotilt.html`                      | Entry point — load this in a browser to see it run.  |
| `app.jsx`                             | App shell, routing state, Tweaks wiring.             |
| `shared.jsx`                          | `AnimatedNumber`, `Sparkline`, `FreshnessChip`, `Tip`, mock data + jitter hook. |
| `lm-core.jsx`                         | `Sidebar`, `TopNav`, `PageHeader`, `ScoreDial`, `BigHistoryChart`, `PercentileBar`, `IndicatorCard`, extended mock data. |
| `lm-shared.jsx`                       | `RegimeCanvas`, `positionIndicators`, `IndicatorDetail`, `SectorFlow`, `SectorRow`, `SectorDrillBody`, `ScanList`, `ScanDrill`, `EventChart`, `MT_SCORE_WEIGHTS`, `breakdownForTicker`. |
| `lm.css`                              | All design tokens + theme/accent/density variants + app shell. |
| `lm-components.css`                   | Map + indicator drill + sector flow + scanner styles. |
| `pages.css`                           | Per-page styles (Home / Macro / Tilt / Scanner / Portfolio / Scenarios / Indicators / Ticker). |
| `methodology.css`                     | Methodology page styles (formula blocks, vendor table, changelog). |
| `tweaks-panel.jsx`                    | Tweaks panel — discard in production.                |
| `pages/home.jsx`                      | Home page.                                           |
| `pages/macro.jsx`                     | Macro overview.                                      |
| `pages/tilt.jsx`                      | Asset Tilt + `BigGauge` + `GaugeLegend`.             |
| `pages/scanner.jsx`                   | Trading Scanner.                                     |
| `pages/portfolio.jsx`                 | Portfolio Insights.                                  |
| `pages/scenarios.jsx`                 | Scenario Analysis.                                   |
| `pages/indicators.jsx`                | All Indicators.                                      |
| `pages/methodology.jsx`               | Methodology.                                         |
| `pages/ticker.jsx`                    | Ticker Detail.                                       |

---

## Acceptance checklist

- [ ] All 8 nav pages render with the existing data, no console errors.
- [ ] Sidebar layouts: rail (default), rail-collapsed, top-nav all work.
- [ ] Light + dark + navy themes all render. Tokens applied via `data-theme` on `<html>`.
- [ ] Every value on every page renders a `FreshnessChip` (no static freshness strings anywhere).
- [ ] Every chart, sparkline, and bar is responsive — measured via container, not fixed width.
- [ ] Scanner score math reconciles: drill table contributions sum to headline score.
- [ ] Map indicators positioned by `state` (extreme right, calm left) — no red dots in the calm quadrant.
- [ ] Engine-call marker on the Home map is in the upper-LEFT (Risk On · Inflationary), not upper-right.
- [ ] Account cards on Portfolio drill open inline with positions + per-position P/L.
- [ ] Every ticker symbol anywhere opens the Ticker Detail page.
- [ ] Methodology page deep-links from every "Read methodology" button across the app.
- [ ] `prefers-reduced-motion: reduce` disables entry animations.
- [ ] Print works — `Cmd-P` on any page produces a clean printable.
- [ ] Tweaks panel ships with theme / accent / density / sidebar / fonts / headline-scale. State persists in `localStorage`.
- [ ] Macro view toggle (Map / Grid) persists in `localStorage` under `mt.macro.view`.
- [ ] Portfolio CSV upload works (Chase / Fidelity / Schwab). "Plaid coming soon" is rendered as a disabled button with a Tip.

---
