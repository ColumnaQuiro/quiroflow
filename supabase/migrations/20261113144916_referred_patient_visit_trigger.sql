-- "Referred patient completes a visit" (referral.visit_completed): fires when
-- a patient someone referred (patients.referred_by_patient_id) has a visit
-- marked completed, and messages THE PATIENT WHO REFERRED THEM -- the "thank
-- you for sending us X" a clinic sends once X has actually come in.
--
-- Deliberately every completed visit, not only the first: the rule's own
-- "only if" filters say which one (Completed visits = 1 for the first,
-- = 2 for the second, an appointment type, a practitioner), and they look at
-- the referred patient and their visit. patient.referred (0129) still fires
-- the moment the referral is recorded, before anyone has come.
--
-- Raised on the server where appointment.completed is (fire.post.ts and
-- appPayments.ts), so no app change is needed. automation_rule_sends is the
-- claim, one per (rule, visit), so a visit reopened and completed again does
-- not thank the same person twice.
--
-- Restates 20261109181443_exercises_section_and_patient_types's list.
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
    'audience.entered',
    'patient.date',
    'patient.type_added', 'patient.type_removed',
    'referral.visit_completed'
  ]));
