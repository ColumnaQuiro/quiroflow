-- "Appointment rescheduled" as a fireable automation trigger, alongside the
-- existing 'appointment.cancelled'. Postgres has no ALTER TYPE ADD VALUE for
-- an inline check-in-list constraint (0057_automations.sql), so this drops
-- and recreates it -- safe, no data migration needed since we're only
-- widening the allowed set.

alter table automation_rules drop constraint automation_rules_trigger_event_check;

alter table automation_rules add constraint automation_rules_trigger_event_check check (trigger_event in (
  'appointment.checked_in',
  'appointment.booked',
  'appointment.completed',
  'appointment.cancelled',
  'appointment.no_show',
  'appointment.rescheduled',
  'invoice.paid'
));
