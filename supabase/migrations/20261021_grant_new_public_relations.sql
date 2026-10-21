-- 20261021_grant_new_public_relations.sql
--
-- Bug #1275 (Supabase notice of 2026-10-20, "Final notice: new tables in
-- public need grants from October 30"): from 2026-10-30 Supabase stops
-- automatically granting Data API access to NEW tables in the public schema
-- on existing projects. Existing tables keep their grants. A table created
-- after that date with no explicit GRANT answers "permission denied" to
-- supabase-js, PostgREST and GraphQL — i.e. to every edge function (service
-- role), every pg_net/pg_cron caller and the site itself.
--
-- What this project does today (read from pg_default_acl, 2026-10-21): the
-- default privileges for role postgres in schema public grant ALL on tables,
-- sequences and functions to anon, authenticated and service_role. That is the
-- "automatic grant" Supabase is withdrawing. 37 of 117 committed migrations
-- create tables; 39 carry a GRANT — the rest relied on the default.
--
-- Fix, deterministic and independent of the vendor's switch: an event trigger
-- (same pattern as the postgres-owned `ensure_rls` already on this project)
-- grants, at ddl_command_end, exactly what the default privileges grant now,
-- on every new table / view / materialized view / sequence in public. RLS is
-- still auto-enabled on every new table by `ensure_rls`, so anon still reads
-- nothing without a policy — exposure before and after this migration is
-- identical. Migrations SHOULD still carry their own GRANTs (the Supabase
-- guidance, and the only thing that works on a preview branch or a local
-- reset where this trigger does not yet exist); this is the safety net for
-- the one that forgets.

create or replace function public.mt_grant_new_public_relation()
returns event_trigger
language plpgsql
security definer
set search_path to 'pg_catalog'
as $$
declare
  cmd record;
begin
  for cmd in
    select *
    from pg_event_trigger_ddl_commands()
    where command_tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO',
                          'CREATE VIEW', 'CREATE MATERIALIZED VIEW', 'CREATE SEQUENCE')
      and object_type in ('table', 'partitioned table', 'view', 'materialized view', 'sequence')
      and schema_name = 'public'
  loop
    begin
      if cmd.object_type = 'sequence' then
        execute format('grant usage, select, update on sequence %s to anon, authenticated, service_role', cmd.object_identity);
      else
        execute format('grant all on table %s to anon, authenticated, service_role', cmd.object_identity);
      end if;
      raise log 'mt_grant_new_public_relation: granted on %', cmd.object_identity;
    exception
      when others then
        -- never let the safety net fail the DDL that fired it
        raise log 'mt_grant_new_public_relation: could not grant on % (%)', cmd.object_identity, sqlerrm;
    end;
  end loop;
end;
$$;

drop event trigger if exists mt_grant_new_public_relations;
create event trigger mt_grant_new_public_relations
  on ddl_command_end
  when tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO',
               'CREATE VIEW', 'CREATE MATERIALIZED VIEW', 'CREATE SEQUENCE')
  execute function public.mt_grant_new_public_relation();

comment on function public.mt_grant_new_public_relation() is
  'Bug #1275: grants anon/authenticated/service_role on every new public relation, mirroring the default privileges Supabase withdraws on 2026-10-30. Migrations should still carry explicit GRANTs.';
