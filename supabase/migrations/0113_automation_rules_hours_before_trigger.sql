-- Adds the new appointment.hours_before trigger (AutomationModal.vue,
-- hours-before-cron.post.ts) to the allowed trigger_event values.
alter table automation_rules drop constraint automation_rules_trigger_event_check;
alter table automation_rules add constraint automation_rules_trigger_event_check
  check (trigger_event = any (array[
    'appointment.checked_in', 'appointment.booked', 'appointment.completed',
    'appointment.cancelled', 'appointment.no_show', 'appointment.rescheduled',
    'appointment.same_day', 'appointment.hours_before',
    'invoice.paid', 'patient.birthday',
    'membership.new_member', 'membership.removed', 'membership.payment_processed'
  ]));
