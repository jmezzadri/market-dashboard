-- =============================================================================
-- MacroTilt migration template
-- -----------------------------------------------------------------------------
-- Copy this file when adding a new table in the public schema. Fill in every
-- TODO and delete the parts you don't need. Data Steward sign-off required.
--
-- Background:
--   Supabase changed the Data API default on 2026-05-13. Starting Oct 30, 2026
--   for our existing project, NEW tables in public are NOT auto-exposed to
--   supabase-js / PostgREST / GraphQL. A missing GRANT means the front-end
--   tile that reads the table will silently render as `—` (PostgREST returns
--   error 42501). Always pair `create table` with the GRANT block below.
--
--   Existing tables keep their pre-Oct-30 grants. This template only applies
--   to NEW tables.
-- =============================================================================

-- 1) CREATE TABLE -------------------------------------------------------------
create table if not exists public.<TODO_table_name> (
    id              bigserial primary key,
    -- TODO columns
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now()
);

-- Helpful indexes
-- create index if not exists ix_<TODO_table_name>_<col> on public.<TODO_table_name>(<col>);

-- 2) GRANTS (REQUIRED — pick the access pattern that fits) --------------------
-- Pattern A: front-end reads (public dashboard, anyone can SELECT)
--   grant select                          on public.<TODO_table_name> to anon, authenticated;
--   grant all                             on public.<TODO_table_name> to service_role;
--
-- Pattern B: user-owned rows (positions, watchlist, transactions)
--   grant select, insert, update, delete  on public.<TODO_table_name> to authenticated;
--   grant all                             on public.<TODO_table_name> to service_role;
--
-- Pattern C: service-only / ingestion-only (prices_eod, indicator_observations)
--   grant all                             on public.<TODO_table_name> to service_role;
--   -- intentionally no grant to anon or authenticated; front-end reads pre-aggregated JSON
--
-- DELETE THE TWO PATTERNS YOU DIDN'T PICK AND UNCOMMENT THE ONE YOU DID.

-- TODO uncomment one pattern:
-- grant select                          on public.<TODO_table_name> to anon, authenticated;
-- grant all                             on public.<TODO_table_name> to service_role;

-- 3) ROW LEVEL SECURITY -------------------------------------------------------
alter table public.<TODO_table_name> enable row level security;

-- Public-read example (Pattern A):
-- create policy "anyone can read <TODO_table_name>"
--   on public.<TODO_table_name>
--   for select to anon, authenticated
--   using (true);

-- User-owned example (Pattern B):
-- create policy "users read their own rows"
--   on public.<TODO_table_name>
--   for select to authenticated
--   using (auth.uid() = user_id);
-- create policy "users write their own rows"
--   on public.<TODO_table_name>
--   for insert to authenticated
--   with check (auth.uid() = user_id);

-- Service-only example (Pattern C): no policies needed; service_role bypasses RLS.

-- 4) DATA STEWARD CHECKLIST (paste into PR description) -----------------------
-- [ ] Registered in data_manifest.json (category, cadence, freshness SLA, consumers)
-- [ ] Pipeline named <category>-<element>-<cadence>
-- [ ] Freshness chip wired on every consumer surface
-- [ ] Grants reviewed and match access pattern above
-- [ ] No anon grant unless the front end actually reads it pre-auth
