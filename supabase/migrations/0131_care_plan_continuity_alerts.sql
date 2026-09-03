-- "Treatment-plan continuity alerts": recall_candidates already flags any
-- patient with no future appointment and no fixed time threshold in mind --
-- this is a narrower, plan-aware version for patients actively on a
-- care_plans phase (0056_care_plans.sql), comparing their actual visit
-- gap against that specific plan's own cadence (frequency_value/unit)
-- instead of a generic days-since-last-visit number. A patient on a
-- "weekly" plan who's gone 12 days without a booked follow-up is overdue by
-- their own plan's standard even though a generic 3-week recall threshold
-- wouldn't catch them yet.
create or replace view care_plan_continuity_alerts
  with (security_invoker = true)
  as
  select
    p.id as patient_id,
    p.account_id,
    p.first_name,
    p.last_name,
    p.email,
    p.default_practitioner_id,
    p.preferred_language,
    cp.id as care_plan_id,
    cp.name as care_plan_name,
    cp.frequency_value,
    cp.frequency_unit,
    cp.total_visits,
    la.last_appointment_at,
    la.completed_in_plan,
    (cp.total_visits - la.completed_in_plan) as visits_remaining,
    (la.last_appointment_at::date + (cp.frequency_value * case when cp.frequency_unit = 'month' then 30 else 7 end)) as due_date,
    (current_date - (la.last_appointment_at::date + (cp.frequency_value * case when cp.frequency_unit = 'month' then 30 else 7 end))) as days_overdue
  from patients p
  -- Most recent care plan per patient, same "latest phase wins" rule
  -- PhaseStats.vue uses.
  join lateral (
    select * from care_plans cp2 where cp2.patient_id = p.id order by cp2.created_at desc limit 1
  ) cp on true
  join lateral (
    select max(a.starts_at) as last_appointment_at, count(*) as completed_in_plan
    from appointments a
    where a.patient_id = p.id and a.status = 'completed' and a.deleted_at is null and a.starts_at >= cp.started_at
  ) la on true
  where la.last_appointment_at is not null
    -- Overdue by the plan's own cadence.
    and (la.last_appointment_at::date + (cp.frequency_value * case when cp.frequency_unit = 'month' then 30 else 7 end)) < current_date
    -- Plan isn't already finished -- no point flagging a completed course of care.
    and (cp.total_visits - la.completed_in_plan) > 0
    and not p.do_not_contact
    and not p.is_minor
    and not exists (
      select 1 from appointments a2
      where a2.patient_id = p.id and a2.status <> 'cancelled' and a2.deleted_at is null and a2.starts_at > now()
    );
