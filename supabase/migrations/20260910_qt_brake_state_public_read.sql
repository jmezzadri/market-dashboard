-- Applied 2026-09-10 via the Supabase MCP (record of applied migration).
-- The Paper page shows the crash brake's reading and state (Joe 2026-09-10: "I'm lost
-- on what the trigger is"). Same read policy shape as qt_nav_daily_read.
create policy qt_brake_state_read on public.qt_brake_state for select to anon, authenticated using (true);
