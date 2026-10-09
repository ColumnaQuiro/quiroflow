-- A push for what patients now do on their own from the app and the portal:
-- paying an invoice online, joining the waitlist (server/utils/staffPush.ts,
-- pushPatientAction). Switchable in the app's Profile > Avisos like every
-- other kind; on unless someone turns it off.
--
-- Additive: the apps already released upsert the columns they know and
-- leave this one to its default.
alter table public.staff_push_preferences
  add column if not exists patient_actions boolean not null default true;
