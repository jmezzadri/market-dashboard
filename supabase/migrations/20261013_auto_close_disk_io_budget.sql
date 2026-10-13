-- Joe decision 2026-10-13: no compute upgrade; do not raise Supabase Disk IO budget
-- warnings unless the site really degrades. The Daily Action Brief files Supabase
-- warning emails into bug_reports and lists open rows to Joe every day. Close Disk IO
-- budget reports from that filer on insert so they never show as open items. Real
-- degradation still surfaces through job failures and freshness alarms.
create or replace function public.auto_close_disk_io_budget_reports()
returns trigger language plpgsql as $$
begin
  if (coalesce(new.title,'') || ' ' || coalesce(new.description,'')) ~* 'disk\s*io|disk i/o|io budget'
     and coalesce(new.reporter_name,'') ilike '%Action Brief%' then
    new.status := 'wontfix';
    new.triage_notes := coalesce(new.triage_notes,'') ||
      'Auto-closed on insert: Joe decided 2026-10-13 not to upgrade compute and not to be told about Disk IO budget warnings unless the site really degrades (see #1264, LESSONS decisions table).';
  end if;
  return new;
end $$;

drop trigger if exists trg_auto_close_disk_io_budget on public.bug_reports;
create trigger trg_auto_close_disk_io_budget
before insert on public.bug_reports
for each row execute function public.auto_close_disk_io_budget_reports();
