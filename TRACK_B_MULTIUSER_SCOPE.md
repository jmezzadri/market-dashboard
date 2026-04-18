# Track B — Multi-user Support: Scoping Document

**Status:** Draft — key decisions locked in (2026-04-18)
**Author:** Claude (drafted 2026-04-18)
**Owner:** Joe
**Depends on:** Track A (sidebar nav) — shipped; Track B0 (Scanner de-personalize) — shipped

---

## Decisions locked in (2026-04-18)

- **Soft login gate.** Only the two portfolio tabs (Portfolio & Insights, Holdings Detail) require auth. Macro Dashboard, Indicators, Sectors, Scanner, and Methodology stay public — F&F can try the macro side before signing up.
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

## 6. Delivery stages

Each stage is shippable and reversible. Each should land as its own PR / Vercel deploy so we can UAT incrementally.

| Stage | Scope | Risk | Time estimate |
|---|---|---|---|
| **B1 — Auth scaffold** | Add Supabase SDK, login screen, email magic link, protected route wrapper. No DB writes yet. Can still show hardcoded ACCOUNTS to everyone behind auth. | Low | ~half day w/ Cursor |
| **B2 — Data model + RLS** | Create `accounts` + `positions` tables, RLS policies, migrations. Admin script to test-insert & test-query. No UI integration yet. | Low | ~half day |
| **B3 — Sample portfolio + read path** | Add sample JSON. Refactor Portfolio & Insights + Holdings Detail tabs to read from DB if the user has data, else show sample with banner. Joe's data still comes from `ACCOUNTS` for now (toggle). | Medium — touches the biggest tabs | ~1 day |
| **B4 — Write path: CSV upload, add-position form, add-ticker-to-watchlist form, wipe-my-portfolio button** | Add/Edit account form. Add/Edit position form. Add-ticker form (lightweight — symbol only → watchlist). CSV template download + upload with parse preview. "Wipe my portfolio" confirmation → truncates user's accounts/positions/watchlist rows. | Medium | ~1.5 days |
| **B5 — Migrate Joe's data + remove hardcode** | Seed Joe's data into DB. Delete ACCOUNTS literal. Verify dashboard still looks identical for Joe. | Medium — this is the cutover | ~half day |
| **B6 — Invite F&F** | Share URL. Watch for bugs. | — | ongoing |

Total: ~3–4 days of focused work, spread across however many sessions you want.

---

## 7. Open questions for Joe

1. ~~**Is Supabase OK as the auth/DB vendor?**~~ **Yes — locked.**
2. ~~**Login gate: hard or soft?**~~ **Soft — only portfolio tabs gated. Locked.**
3. ~~**CSV-first or manual-first?**~~ **Both — CSV for full portfolios, plus a lightweight "add ticker for tracking" path (symbol only, stores in `watchlist` table). Locked.**
4. ~~**"Delete my data" affordance?**~~ **Yes — "Wipe my portfolio" button. Locked.**
5. ~~**Hardcoded-ACCOUNTS history scrub?**~~ **Deferred. Data already public; rewriting history doesn't meaningfully reduce exposure. Locked.**

All questions resolved. Ready to start B1.

---

## 8. What I'd recommend we do next

All scoping questions resolved. Next step is **B1 — Auth scaffold**:

1. Create Supabase project (free tier)
2. Add `@supabase/supabase-js` dep + Supabase client singleton in the dashboard repo
3. Login screen (email magic link only — no password)
4. Protected-route wrapper that gates only the two portfolio tabs (soft gate)
5. Basic account UI in the sidebar footer slot (name/email + "Sign out")

B1 is low-risk and fully reversible — if we decide to change auth vendor later, nothing in B1 is load-bearing for B2+. It's also ~half a day of Cursor work with you supervising.

I'll need from you before I start:
- Supabase project URL + anon key (created once in the Supabase dashboard — I can walk you through it)
- A throwaway email address to test magic-link login end-to-end (or your primary; both work)
