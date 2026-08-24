-- Migrating PracticeHub's Connect campaigns exposed two gaps in the
-- automation system: a trigger fires for every appointment regardless of
-- type today (no way to say "only Primera visita"), and PH's two birthday
-- campaigns aren't triggered by an event at all -- they're a daily "is it
-- this patient's birthday today" check, which needs a trigger_event value
-- for a scheduled/cron firing rather than a client action.
--
-- filters shape: { appointment_type_id?: uuid, total_visits?: number,
-- no_prior_appointments?: boolean, has_future_appointment?: boolean }.
-- total_visits is scoped to appointment_type_id when both are set.
alter table automation_rules add column filters jsonb not null default '{}'::jsonb;

alter table automation_rules drop constraint automation_rules_trigger_event_check;

alter table automation_rules add constraint automation_rules_trigger_event_check check (trigger_event in (
  'appointment.checked_in',
  'appointment.booked',
  'appointment.completed',
  'appointment.cancelled',
  'appointment.no_show',
  'appointment.rescheduled',
  'invoice.paid',
  'patient.birthday'
));
