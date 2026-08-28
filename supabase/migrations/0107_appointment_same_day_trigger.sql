-- "Day of appointment" as a fireable automation trigger, for campaigns like
-- "send first-visit info the morning of the appointment" that need to fire
-- on a schedule rather than instantly off a client action (same reasoning as
-- patient.birthday). Widening the check-in-list constraint per the pattern
-- established in 0075_appointment_rescheduled_automation.sql.

alter table automation_rules drop constraint automation_rules_trigger_event_check;

alter table automation_rules add constraint automation_rules_trigger_event_check check (trigger_event in (
  'appointment.checked_in',
  'appointment.booked',
  'appointment.completed',
  'appointment.cancelled',
  'appointment.no_show',
  'appointment.rescheduled',
  'appointment.same_day',
  'invoice.paid',
  'patient.birthday',
  'membership.new_member',
  'membership.removed',
  'membership.payment_processed'
));

-- Idempotency guard for the same-day cron (server/api/automations/same-day-cron.post.ts),
-- same role as confirmation_sent_at/reminder_sent_at in 0103_appointment_communication_defaults.sql.
alter table appointments add column same_day_info_sent_at timestamptz;
