-- 059_paper_portfolio_rls_authenticated.sql
-- Bug found 2026-05-27: original 058 only granted SELECT to anon. Signed-in
-- (authenticated) users got empty arrays back from the paper_* tables because
-- no policy matched their role. The Paper Portfolio page rendered an empty
-- state even though the data was sitting in the tables.
--
-- Fix: add an authenticated-role SELECT policy on every paper_* table.

CREATE POLICY paper_accounts_read_auth         ON public.paper_accounts        FOR SELECT TO authenticated USING (true);
CREATE POLICY paper_orders_read_auth           ON public.paper_orders          FOR SELECT TO authenticated USING (true);
CREATE POLICY paper_fills_read_auth            ON public.paper_fills           FOR SELECT TO authenticated USING (true);
CREATE POLICY paper_positions_read_auth        ON public.paper_positions       FOR SELECT TO authenticated USING (true);
CREATE POLICY paper_nav_daily_read_auth        ON public.paper_nav_daily       FOR SELECT TO authenticated USING (true);
CREATE POLICY paper_signal_capture_read_auth   ON public.paper_signal_capture  FOR SELECT TO authenticated USING (true);
