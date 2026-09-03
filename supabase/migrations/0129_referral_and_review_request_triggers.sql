-- Two new campaign trigger types, requested after a competitor feature scan
-- (Praxxos does both as built-in automations):
--
-- patient.referred: fires for the REFERRING patient (not the new patient)
-- the moment patients.referred_by_patient_id transitions to a value --
-- lets a clinic build a "thank you for referring someone" campaign. Purely
-- event-driven (same shape as invoice.paid/appointment.completed), fired
-- from OverviewTab.vue's save() -- see that file for where the transition
-- is detected. No new filters needed.
--
-- appointment.review_request: fires N days after a completed appointment,
-- for a "please leave us a Google review" campaign. Time-based like
-- appointment.hours_before, so it reuses that trigger's approach: a
-- `days_after` value in filters (default 2, read only by
-- review-request-cron.post.ts, not a patient-targeting filter -- see
-- evaluateAutomationFilters.ts) and the existing automation_rule_sends
-- table for its per-(rule, appointment) "already sent" guard, since that
-- table was already generic enough to reuse rather than needing its own.
alter table automation_rules drop constraint automation_rules_trigger_event_check;
alter table automation_rules add constraint automation_rules_trigger_event_check
  check (trigger_event = any (array[
    'appointment.checked_in', 'appointment.booked', 'appointment.completed',
    'appointment.cancelled', 'appointment.no_show', 'appointment.rescheduled',
    'appointment.same_day', 'appointment.hours_before',
    'invoice.paid', 'patient.birthday',
    'membership.new_member', 'membership.removed', 'membership.payment_processed',
    'patient.referred', 'appointment.review_request'
  ]));

-- Backs the {{google_review_link}} merge token (runAutomationActions.ts) so
-- a review-request campaign's WhatsApp/email action can link straight to
-- the clinic's own Google review page. Configured in Settings ->
-- Communications -> General, alongside the other account-wide messaging
-- settings.
alter table accounts add column google_review_url text;
