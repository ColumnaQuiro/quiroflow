-- "Enters a list or segment" (audience.entered, utils/automationCatalog.ts):
-- a patient added to a list, or newly matching a segment, read each 15-minute
-- tick from audience_entries_since (20261105143740_patient_lists_and_audiences)
-- by enrolAudienceEntries -- already scheduled, no new cron. Its cursor is
-- automation_rules.segment_last_run_at, which the group send uses the same
-- way, so no column is added.
--
-- The list restates 20261105165746_automation_care_triggers's, plus this one.

alter table public.automation_rules drop constraint automation_rules_trigger_event_check;
alter table public.automation_rules add constraint automation_rules_trigger_event_check
  check (trigger_event = any (array[
    'appointment.checked_in', 'appointment.booked', 'appointment.completed', 'appointment.cancelled',
    'appointment.no_show', 'appointment.rescheduled', 'appointment.same_day', 'appointment.hours_before',
    'invoice.paid', 'invoice.overdue', 'patient.birthday', 'membership.new_member', 'membership.removed',
    'membership.payment_processed', 'patient.referred', 'appointment.review_request', 'appointment.satisfaction',
    'lead.created', 'waitlist.slot_offered', 'segment',
    'satisfaction.answered', 'patient.tag_added', 'patient.tag_removed', 'doc.completed', 'lead.stage_changed',
    'care_plan.milestone', 'bono.running_low',
    'audience.entered'
  ]));
