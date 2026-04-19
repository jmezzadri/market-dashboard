# Track B — Multi-user Support: Scoping Document

**Status:** B1 shipped (2026-04-18). B2 in flight.
**Author:** Claude (drafted 2026-04-18, revised 2026-04-18 post-B1)
**Owner:** Joe
**Depends on:** Track A (sidebar nav) — shipped; Track B0 (Scanner de-personalize) — shipped; B1 (Auth scaffold) — shipped.

---

## Decisions locked in (2026-04-18)

### Revised post-B1 (2026-04-18 evening)

The "soft login gate on portfolio tabs" decision is **superseded** after B1 went live. New direction:

- **No UI gates anywhere.** Every tab is publicly clickable, including the Portfolio & Insights detail tab. Data is what gates, not routing. Unauthenticated visitors see the tab chrome and layout in a **zero/empty state**; sign-in switches the data from empty to user-scoped.
- **Inline sign-in CTA, not a blocking LoginScreen card.** When the detail tab renders empty, a contextual "Sign in to see your portfolio" prompt sits inline (near the snapshot or as a top banner), with the same magic-link email input embedded. No more "replace the whole view with a login wall."
- **Home tile stays public too.** The Home dashboard's Trading Opps summary tile renders zero-state numbers pre-auth (totals $0 / 0 positions / 0 watchlist / etc.), not a "sign in to see" panel. Signed-in users see their aggregates.
- **Rationale.** Hard gates create a funnel cliff — prospective F&F users see a wall instead of the product. Empty-state views let them see the shape of what they'd get, which is a better discovery experience. And it avoids a throwaway intermediate "gate the UI" state before B2 un-gates it anyway.
- **`ProtectedRoute` wrapper stays in the codebase** (may be useful later, e.g. settings/admin), but is no longer wired into portopps.

### Original decisions (pre-B1, still applicable)

- **Soft login gate.** ~~Only the two portfolio tabs require auth.~~ **Superseded — see above.** Macro Dashboard, Indicators, Sectors, Scanner, and Methodology stay public — F&F can try the macro side before signing up.
- **Scanner de-personalized.** The "CURRENT PORTFOLIO" section has been removed from the Scanner tab (Track B0). The scanner JSON may still emit `portfolio_positions`, but the dashboard no longer renders it. No per-user personalization of the scanner UI.
- **Scored-universe expansion (separate track, scanner repo).** Universe should broaden to S&P 500 + NASDAQ Composite + Dow Jones Industrial Average + Russell 2000. This is Python-side work in the trading-scanner repo, not this repo. Tracked separately.
- **Supabase + RLS** is the vendor pick.
- **Portfolio input supports two modes:**
  - **CSV upload** for a full portfolio (account + positions with shares / avg cost / sector).
  - **Lightweight "add ticker for tracking"** — symbol-only entry that creates a watchlist row. No financial data required. Useful for F&F who just want to track names without committing to data entry.
- **"Wipe my portfolio" button** on the portfolio tabs — one-click reset so F&F can undo a botched CSV upload.
- **Sample portfolio shipped as static JSON**, not a DB row.
- **Git history scrub — deferred.** The old `ACCOUNTS` array will remain in git history after the B5 cutover. Data is already public via a public GitHub repo, so rewriting history is closing the barn door. Future safety comes from never hardcoding real data again (which B5 enforces).

---

## 1. What we're building

A version of MacroTilt that friends & family can log into, see a **sample portfolio as a preview**, and then replace with their own via **manual entry** or **CSV upload**. Joe's real portfolio stays private to his login only.

**In scope**

- Email-based login (passwordless magic link)
- Per-user portfolio: accounts + positions, owned by the signed-in user
- Sample/demo portfolio shown on first login as a preview
- "Make it yours" flow: clear sample → manual add / CSV upload
- Strict data isolation (one user can never see another user's holdings)
- Joe's existing hardcoded `ACCOUNTS` array migrates into *his* user record, not a global default

**Out of scope (for now)**

- Plaid / broker linking
- Social / sharing features across users
- Sharing Joe's portfolio with specific users (e.g., "let Jane see my book")
- Mobile apps, push notifications
- Admin UI for managing other users
- Transactions / tax-lot tracking beyond current avgCost model

**Non-goals**

- We are not building a compliance-grade system. This is a personal-finance preview tool. The security bar is: one user's data can't leak to another user. We are not building to FINRA / SOX standards.

---

## 2. Architectural choice: Supabase

**Recommendation:** Supabase (Postgres + Auth + Row-Level Security), free tier.

| Option | Pro | Con |
|---|---|---|
| **Supabase** | Free tier covers F&F scale. Auth + DB in one. RLS gives strong data isolation at the DB layer, not just the app. JS client drops into React. Matches Vercel deployment model. | Adds a vendor. Learning curve on RLS policies. |
| Firebase | Similar ergonomics. | Firestore is NoSQL — schema drift risk, joins awkward for portfolio queries. Auth is solid. |
| Clerk + separate DB | Clean auth primitives. | Two vendors, two bills, extra glue code. |
| Roll own (NextAuth + Postgres on Neon) | Full control. | We'd own auth UX, password resets, session handling. Not worth it for this scale. |

The RLS angle is the one that matters most for you — in a risk/controls framing, it's the difference between "app code promises not to leak" and "database rejects the query if it isn't yours." Given this is F&F, RLS gives you a real security boundary without a real security budget.

---

## 3. Data model

Three tables. All user-owned, RLS-gated. The split between `positions` and `watchlist` mirrors the two input modes: committed capital vs. things you just want to track.

### `accounts`

| column | type | notes |
|---|---|---|
| `id` | uuid PK | |
| `user_id` | uuid FK → auth.users | **RLS filter** |
| `label` | text | e.g. "JPM Taxable Brokerage" |
| `sub` | text | e.g. "Margin · J.P. Morgan" |
| `color` | text | hex — used in UI |
| `tactical` | bool | tactical vs. strategic flag |
| `note` | text | free-form note |
| `sort_order` | int | for display ordering |
| `created_at` / `updated_at` | timestamptz | |

### `positions`

| column | type | notes |
|---|---|---|
| `id` | uuid PK | |
| `user_id` | uuid FK → auth.users | **RLS filter — redundant with account but makes policy simpler** |
| `account_id` | uuid FK → accounts | |
| `ticker` | text | |
| `name` | text | |
| `shares` | numeric | |
| `price` | numeric | |
| `avg_cost` | numeric | |
| `value` | numeric | denormalized; `shares * price` for now |
| `sector` | text | |
| `beta` | numeric | |
| `analysis` | text | Joe's qualitative take per holding |
| `color` | text | |
| `created_at` / `updated_at` | timestamptz | |

### `watchlist`

Ticker-only rows for the "add ticker for tracking" flow — no shares, no avg cost, no capital-at-risk data.

| column | type | notes |
|---|---|---|
| `id` | uuid PK | |
| `user_id` | uuid FK → auth.users | **RLS filter** |
| `ticker` | text | |
| `name` | text | optional — filled from scanner metadata if available |
| `theme` | text | optional — user's tag ("AI / Semis", "Energy", etc.) |
| `note` | text | optional — free-form |
| `sort_order` | int | |
| `created_at` / `updated_at` | timestamptz | |

### RLS policies (the important part)

```sql
-- accounts
alter table accounts enable row level security;
create policy "own accounts - select"
  on accounts for select using (auth.uid() = user_id);
create policy "own accounts - write"
  on accounts for all using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- positions (same pattern)
alter table positions enable row level security;
create policy "own positions - select"
  on positions for select using (auth.uid() = user_id);
create policy "own positions - write"
  on positions for all using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- watchlist (same pattern)
alter table watchlist enable row level security;
create policy "own watchlist - select"
  on watchlist for select using (auth.uid() = user_id);
create policy "own watchlist - write"
  on watchlist for all using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
```

A user without a JWT, or a user whose JWT's `sub` doesn't match `user_id`, gets an empty result set. Enforcement lives at the Postgres layer, not the app.

### Sample portfolio

Shipped as a static JSON file in the repo (`src/data/samplePortfolio.json`), not a DB row. On first login the UI reads it directly — no network call, no risk of it accidentally appearing in a query. Once the user clicks "Make this mine" (see §4), we insert their positions into the DB and stop rendering the sample.

This keeps the sample portfolio completely separate from real user data. It never sits in the accounts/positions tables.

---

## 4. UX flow

### First-time user

1. Hits macrotilt.com → sees landing/login screen ("Sign in with email to continue").
2. Enters email → magic link sent → clicks link → returns authenticated.
3. Lands on Home. The Portfolio & Insights tab and Holdings Detail tab show the **sample portfolio** with a prominent banner: *"This is a demo portfolio. [Replace with your own]."*
4. Clicks "Replace with your own." Options presented:
   - **Add manually** — form to create an account, then add positions one by one.
   - **Upload CSV** — download a template CSV, fill it in, upload. Parse → confirm → insert.
5. Sample vanishes. Portfolio tabs now show their real data.

### Returning user

1. Hits macrotilt.com → already authenticated via session cookie → lands on Home directly.
2. Portfolio tabs show their data from DB.

### Joe specifically

- Same flow, but seeded once: run a one-time script that inserts the current hardcoded `ACCOUNTS` array into `accounts` + `positions` tagged with Joe's `user_id`. After that, Joe sees his real portfolio on every login; everyone else sees the sample until they replace it.

### CSV format

Keep it aligned with the in-code shape to minimize translation logic:

```
account_label,account_sub,ticker,name,shares,price,avg_cost,sector,beta
JPM Taxable Brokerage,Margin · J.P. Morgan,CCJ,Cameco Corp,400,120.67,117.35,Materials,1.40
```

Account metadata (label, sub) repeats per row and gets deduped server-side. Simple and Excel-friendly.

---

## 5. Migration plan for Joe's data

**Problem:** `src/App.jsx:543` has a hardcoded `ACCOUNTS` array with real position data. We need to:

1. Move it out of source code (it's in a public repo).
2. Put it into the DB, keyed to Joe's user_id.
3. Delete the hardcoded array.

**Plan:**

1. Export `ACCOUNTS` → a one-time seed JSON file, kept local (gitignored).
2. Build a `scripts/seed-joes-portfolio.mjs` that reads the JSON and inserts via the Supabase admin key (service role, skips RLS for seeding only).
3. Run once after Joe signs up with his email.
4. Verify the dashboard renders his data from DB.
5. Delete the `ACCOUNTS` literal from `App.jsx` in the same PR. **This is the point where real data leaves the repo.**
6. Git-rewrite history to scrub the old commits? Low priority — it's behind a public GitHub URL but not actively sensitive (no account numbers, just positions). Your call.

---

## 6. Delivery stages (revised 2026-04-18 post-B1)

Each stage is shippable and reversible. B1 shipped in one session; B2 collapses the originally-planned B2+B3+B4+B5 into a single coherent stage because un-gating + user-scoping + seeding need to land together to avoid data-leakage intermediate states.

| Stage | Scope | Status |
|---|---|---|
| **B1 — Auth scaffold** | Supabase SDK, magic-link login, ProtectedRoute wrapper, sidebar account UI. | ✅ Shipped 2026-04-18 |
| **B2 — Data model + un-gate + read + write + seed** | (a) Supabase schema: `accounts`, `positions`, `watchlist` with RLS on `auth.uid()`. (b) `useUserPortfolio` hook — reads Supabase when session exists, returns empty shape when session is null. (c) Replace all `ACCOUNTS` / `WATCHLIST_FALLBACK` reads in App.jsx with the hook. (d) Zero-state rendering at every call site (Home tile = zero numbers, portopps detail = empty skeleton + inline sign-in CTA). (e) Remove `ProtectedRoute` wrapper from portopps. (f) Onboarding flow: post-sign-in with zero rows routes to import screen with **two paths: paste-tickers form + CSV upload**, both writing through same insert. (g) Sample portfolio shipped as `src/data/samplePortfolio.json`, rendered to unauthenticated visitors as a preview (optional; see §4). (h) Seed Joe's `ACCOUNTS` into DB under his user_id. (i) Delete `ACCOUNTS` literal from App.jsx. | In flight |
| **B3 — Wipe my portfolio + account/position edit forms** | Edit-in-place forms for accounts and positions. "Wipe my portfolio" confirmation button. Add-ticker-to-watchlist form (symbol-only quick add). | Pending — split out so B2 doesn't balloon |
| **B4 — Invite F&F** | Share URL. Watch for bugs. Collect feedback on onboarding friction. | Pending |

**Time estimate for B2:** 1–2 focused sessions. Schema + RLS is 30 minutes. Session-scoped store + wiring is the bulk of the work (4–6 hours). Import flow is 1–2 hours. Seeding + cutover is another hour.

**Key sequencing rule for B2:** the un-gate and the data-store swap must land in the same deploy. If we un-gate portopps while ACCOUNTS is still bundled, every visitor sees Joe's book. The cutover PR removes both gates at once.

---

## 7. Open questions for Joe

1. ~~**Is Supabase OK as the auth/DB vendor?**~~ **Yes — locked.**
2. ~~**Login gate: hard or soft?**~~ **Soft — only portfolio tabs gated. Locked.**
3. ~~**CSV-first or manual-first?**~~ **Both — CSV for full portfolios, plus a lightweight "add ticker for tracking" path (symbol only, stores in `watchlist` table). Locked.**
4. ~~**"Delete my data" affordance?**~~ **Yes — "Wipe my portfolio" button. Locked.**
5. ~~**Hardcoded-ACCOUNTS history scrub?**~~ **Deferred. Data already public; rewriting history doesn't meaningfully reduce exposure. Locked.**

All questions resolved. Ready to start B1.

---

## 8. B2 execution plan

Landing in this order within B2:

1. **Schema SQL** (`supabase/migrations/001_b2_portfolio_tables.sql`) — `accounts`, `positions`, `watchlist` tables + RLS policies + indexes. Joe runs this once in the Supabase SQL editor.
2. **`useUserPortfolio` hook** (`src/hooks/useUserPortfolio.js`) — subscribes to session, fetches rows for the current user on sign-in, returns `{ accounts, positions, watchlist, loading, refetch }`. Pre-auth returns the sample portfolio JSON (for visual preview) or an explicit empty shape `{ accounts: [], positions: [], watchlist: [] }` — decide at implementation time.
3. **Sample portfolio JSON** (`src/data/samplePortfolio.json`) — tiny 2-account fake portfolio (JPM Brokerage + 401k) so unauthenticated visitors see a realistic shape rather than "$0 everywhere". Clearly labeled as "SAMPLE" in the UI.
4. **Wire hook into App.jsx** — replace every read of `ACCOUNTS`, `WATCHLIST_FALLBACK`, and the scanner's `watchlist` slice with the hook return. Delete the `ACCOUNTS` literal from source. Home tile, portopps detail, anywhere else.
5. **Un-gate portopps** — remove `<ProtectedRoute>` wrapper; the IIFE renders freely. Add inline "Sign in to see your portfolio" banner when `!session` (using the magic-link input from LoginScreen, but embedded not fullscreen).
6. **Import flow** (`src/portfolio/Onboarding.jsx`) — routed to automatically when signed in with zero positions. Two side-by-side cards:
   - **Paste tickers:** multiline textarea, one line per position, format `TICKER SHARES AVG_COST ACCOUNT_LABEL` (or simpler — just tickers with quantities, account defaults to "Brokerage"). Parse, preview, commit.
   - **Upload CSV:** file input, template download, parse, preview, commit.
   Both write through the same `insertPortfolio({ accounts, positions })` function.
7. **Seed Joe's data** — `scripts/seed-joes-portfolio.mjs` reads exported JSON (ran locally, never committed), uses Supabase service-role key from `.env.local`, inserts tagged with Joe's `user_id`. Run once.
8. **Build, commit, push, UAT.** Verify: signed-out shows sample-labeled zero-state everywhere; sign in as Joe → real portfolio renders; sign in as a fresh test user → onboarding screen appears.

Total expected session time: 4–6 hours of focused execution.
