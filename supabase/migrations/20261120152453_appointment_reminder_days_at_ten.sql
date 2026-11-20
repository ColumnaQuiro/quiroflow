-- The clinic's appointment reminder goes out N DAYS before the visit, at
-- 10:00 clinic time, rather than N hours before it.
--
-- Counted in hours, every visit was reminded at its own hour the day before:
-- a 9:00 visit at 9:00, a 19:00 one at 19:00, so reminders (and the replies
-- to them) trickled in all day. Counted in days they go out together at
-- 10:00, and the front desk answers the replies in one sitting. The rule is
-- utils/appointmentReminderDue.ts; the cron reads this column from the
-- release that ships it.
--
-- appointment_reminder_hours_before stays, unused by that release: the code
-- live until then still reads it (CLAUDE.md, migrations must be backwards-
-- compatible with what is deployed). A patient's own override,
-- patients.appointment_reminder_hours_before, is untouched and stays in
-- hours -- it is for the patient who wants to hear two hours before.
--
-- Settings > Messages saves it; accounts_settings_permission already gives
-- every appointment_reminder_% column to communication_config, so a
-- receptionist without that permission cannot change it through the API.

alter table accounts
  add column if not exists appointment_reminder_days_before smallint not null default 1
    check (appointment_reminder_days_before between 1 and 7);

-- Each clinic keeps the lead it chose, rounded to whole days: 24 h -> 1,
-- 48 h -> 2, anything under a day -> 1, a week -> 7. Every clinic was on
-- 24 hours when this was written.
update accounts
   set appointment_reminder_days_before = greatest(1, least(7, round(appointment_reminder_hours_before / 24.0)::int))
 where appointment_reminder_hours_before is distinct from 24;
