-- Deleting an appointment (AppointmentModal.vue's "Delete") was a hard
-- delete -- gone from the DB entirely, with no way to distinguish "deleted"
-- from "never existed." The calendar's Display panel already has a "Hide
-- cancelled" toggle backed by a real status; matching "Hide rescheduled"
-- (the existing `rescheduled` boolean) and a new "Hide deleted" toggle
-- needs deletion to become non-destructive too, same idea as `rescheduled`
-- being a separate flag rather than folded into the status check constraint.
alter table appointments add column deleted_at timestamptz;

-- recall_candidates already excludes cancelled appointments from counting
-- as a patient's "last appointment" -- a soft-deleted one shouldn't count
-- either, or a deleted appointment would wrongly suppress/trigger recalls.
create or replace view recall_candidates
  with (security_invoker = true)
  as
  select
    p.id as patient_id,
    p.account_id,
    p.first_name,
    p.last_name,
    p.email,
    p.tags,
    lb.balance_cents,
    p.recall_priority,
    p.default_practitioner_id,
    la.last_appointment_at,
    (current_date - la.last_appointment_at::date) as days_since_last_appointment,
    p.preferred_language
  from patients p
  join lateral (
    select max(a.starts_at) as last_appointment_at
    from appointments a
    where a.patient_id = p.id and a.status <> 'cancelled' and a.deleted_at is null
  ) la on true
  left join patient_live_balances lb on lb.patient_id = p.id
  where la.last_appointment_at is not null
    and p.recall_status = 'active'
    and not p.do_not_contact
    and not p.is_minor
    and not exists (
      select 1 from appointments a2
      where a2.patient_id = p.id and a2.status <> 'cancelled' and a2.deleted_at is null and a2.starts_at > now()
    );
