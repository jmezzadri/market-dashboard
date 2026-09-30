-- 2026-09-30 — weekly thesis review (Joe: "run it weekly and I'd like an email
-- of the analysis"). One row per emailed review date; the primary key is the
-- send mutex for THESIS-REVIEW-WEEKLY.yml, the same shape as brief_email_log.
create table if not exists public.thesis_review_email_log (
  review_date date primary key,
  sent_at     timestamptz not null default now(),
  sent_by     text
);
create table if not exists public.thesis_review_email_log_failures (
  id          bigserial primary key,
  review_date date not null,
  detail      text,
  failed_at   timestamptz not null default now()
);
alter table public.thesis_review_email_log enable row level security;
alter table public.thesis_review_email_log_failures enable row level security;
-- service role only (no policies): the workflow writes with the service key.

-- Freshness row for the new served element public/thesis_reviews.json.
-- Seeded red-until-first-run on purpose: a feed that has never published
-- must never read green (LESSONS: honest timestamps from the real first run).
insert into public.pipeline_health (indicator_id, label, source, cadence, expected_cadence_minutes, status, last_error)
values ('thesis_reviews', 'Weekly thesis review', 'MacroTilt editorial (Monday scheduled session) + THESIS-REVIEW-WEEKLY.yml', 'W', 7*24*60 + 24*60, 'red', 'not yet run')
on conflict (indicator_id) do nothing;
