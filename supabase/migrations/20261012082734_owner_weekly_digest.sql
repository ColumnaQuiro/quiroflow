-- The owner's Monday summary of last week, by email and push
-- (server/utils/weeklyDigest.ts, run from same-day-cron at 8:00 Monday where
-- the clinic is). Each owner can switch it off in Avisos, beside the morning
-- summary it resembles, so it lives in the same row:
--
--   weekly_digest        on by default -- an owner who never opened Avisos
--                        gets it, as they get the morning summary.
--   digest_sent_week     the Monday it was last sent for, claimed before
--                        sending so a second cron tick in the window does
--                        not send it twice (summary_sent_on's pattern).
--
-- Additive only; the table's RLS and two-factor policy already cover it.
alter table public.staff_push_preferences
  add column if not exists weekly_digest boolean not null default true,
  add column if not exists digest_sent_week date;
