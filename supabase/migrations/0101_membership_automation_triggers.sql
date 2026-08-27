-- Three membership lifecycle events had no way to fire a campaign: a new
-- membership starting, one being cancelled, and a recurring Stripe
-- membership charge succeeding. Same drop/recreate pattern as 0075/0080
-- since this is an inline check-in-list constraint, not a native enum.
alter table automation_rules drop constraint automation_rules_trigger_event_check;

alter table automation_rules add constraint automation_rules_trigger_event_check check (trigger_event in (
  'appointment.checked_in',
  'appointment.booked',
  'appointment.completed',
  'appointment.cancelled',
  'appointment.no_show',
  'appointment.rescheduled',
  'invoice.paid',
  'patient.birthday',
  'membership.new_member',
  'membership.removed',
  'membership.payment_processed'
));
