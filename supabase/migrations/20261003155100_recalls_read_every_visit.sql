-- The recall queue (recall_candidates, recall_parked) and the care-plan alerts
-- (care_plan_continuity_alerts) had two faults.
--
-- 1. Archived patients were still in them. Archiving a patient (status
--    'inactive') tells the user it "hides the patient from the active list
--    and stops reminders", but none of the three views looked at status, so
--    an archived patient stayed in the queue, in the alerts, in the sidebar
--    badge and in the dashboard and My Day counts that read these views.
--
-- 2. For a practitioner who sees only their own patients, "last visit" and
--    "already booked" were computed from that practitioner's own visits.
--    The views are security_invoker -- correctly, so a practitioner only gets
--    rows for patients they may see -- but that also put the appointments
--    subqueries inside them under the caller's appointments policy, which for
--    'own' calendar scope is "my appointments". A patient of theirs booked
--    next week with a colleague showed as overdue and unbooked; a visit with
--    a colleague last week did not count as the last visit, so the days
--    since were wrong; a care plan's completed visits counted only theirs.
--
-- The fix keeps the views security_invoker and moves only the appointment
-- facts out from under the caller's appointments policy, into two SECURITY
-- DEFINER functions:
--
--   patient_visit_facts()    per patient: last attended visit, last no-show,
--                            and whether anything is booked ahead
--   care_plan_visit_facts()  per patient, for their latest care plan: visits
--                            completed since it started, the last of them,
--                            and whether anything is booked ahead
--
-- They are not a way round patient scoping. Each returns facts only about
-- patients the caller may see, by the same rule the patients policy applies
-- (my_patients_scope() = 'all', or the patient is in my_own_patient_ids()),
-- inside the caller's own accounts and only once two-factor is satisfied --
-- RLS does not reach a definer function, so those checks are made here. And
-- what they return is dates, a count and a boolean, never a visit. Each view
-- then reads the patient (and the care plan) through the caller's own
-- policies, so which rows come back is still decided by RLS.
--
-- Shape of the views, and why: each function is called once per query and
-- aggregates in one pass -- a definer function cannot be inlined, and calling
-- one per patient row cost 5x the whole view. The function is the driving
-- side, and the patient is looked up by primary key in a LATERAL subquery
-- with OFFSET 0, which keeps the planner from flattening it and turning the
-- function into the inner side of a nested loop. That plan is what it picked
-- whenever it misjudged how many patients a filter keeps (the sidebar badge's
-- filters made it guess 1 of 1,600): the function's output rescanned once per
-- patient, 2.2M comparisons, 0.9s for a count.
--
-- Columns, their order and their types are unchanged in all three views, so
-- every reader -- the Recalls page, the sidebar badge (recall_badge_count),
-- the dashboard summaries, My Day on the app -- reads the same shape. One
-- reader is gone: a patient-app user could select their own row from
-- recall_candidates (through "patients view own record"); the facts are
-- staff-only now, so they get nothing. Nothing reads it that way.

create or replace function public.patient_visit_facts()
returns table (patient_id uuid, last_appointment_at timestamptz, last_no_show_at timestamptz, has_future_appointment boolean)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select a.patient_id,
         max(a.starts_at) filter (where a.status <> all (array['cancelled', 'no_show'])),
         max(a.starts_at) filter (where a.status = 'no_show'),
         coalesce(bool_or(a.status <> 'cancelled' and a.starts_at > now()), false)
  from appointments a
  where a.deleted_at is null
    and a.patient_id is not null
    and a.account_id in (select my_member_account_ids())
    and (select mfa_satisfied())
    and (
      (select my_patients_scope()) = 'all'
      or ((select my_patients_scope()) = 'own' and a.patient_id in (select my_own_patient_ids()))
    )
  group by a.patient_id;
$function$;

create or replace function public.care_plan_visit_facts()
returns table (patient_id uuid, care_plan_id uuid, last_completed_at timestamptz, completed_in_plan bigint, has_future_appointment boolean)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with latest as (
    select distinct on (cp.patient_id) cp.id, cp.patient_id, cp.started_at
    from care_plans cp
    where cp.account_id in (select my_member_account_ids())
      and (select mfa_satisfied())
      and (
        (select my_patients_scope()) = 'all'
        or ((select my_patients_scope()) = 'own' and cp.patient_id in (select my_own_patient_ids()))
      )
    order by cp.patient_id, cp.created_at desc
  )
  select l.patient_id,
         l.id,
         max(a.starts_at) filter (where a.status = 'completed' and a.starts_at >= l.started_at),
         count(*) filter (where a.status = 'completed' and a.starts_at >= l.started_at),
         coalesce(bool_or(a.status <> 'cancelled' and a.starts_at > now()), false)
  from latest l
  join appointments a on a.patient_id = l.patient_id and a.deleted_at is null
  group by l.patient_id, l.id;
$function$;

revoke all on function public.patient_visit_facts() from public, anon;
revoke all on function public.care_plan_visit_facts() from public, anon;
grant execute on function public.patient_visit_facts() to authenticated;
grant execute on function public.care_plan_visit_facts() to authenticated;

create or replace view public.recall_candidates
  with (security_invoker = true)
as
select f.patient_id,
       p.account_id,
       p.first_name,
       p.last_name,
       p.email,
       p.tags,
       lb.balance_cents,
       p.recall_priority,
       p.default_practitioner_id,
       f.last_appointment_at,
       current_date - f.last_appointment_at::date as days_since_last_appointment,
       p.preferred_language,
       p.clinic_id,
       f.last_no_show_at
from patient_visit_facts() f
cross join lateral (select p1.* from patients p1 where p1.id = f.patient_id offset 0) p
left join patient_live_balances lb on lb.patient_id = p.id
where f.last_appointment_at is not null
  and not f.has_future_appointment
  and p.status = 'active'
  and not p.do_not_contact
  and not p.is_minor
  and (p.recall_snoozed_until is null or p.recall_snoozed_until <= current_date)
  and (
    p.recall_status = 'active'
    or (p.recall_status = 'dismissed' and p.recall_dismissed_at is not null and f.last_appointment_at > p.recall_dismissed_at)
  );

create or replace view public.recall_parked
  with (security_invoker = true)
as
select f.patient_id,
       p.account_id,
       p.clinic_id,
       p.first_name,
       p.last_name,
       p.default_practitioner_id,
       f.last_appointment_at,
       current_date - f.last_appointment_at::date as days_since_last_appointment,
       p.recall_snoozed_until,
       p.recall_dismissed_at,
       case when p.recall_status = 'dismissed' then 'dismissed' else 'snoozed' end as parked_as
from patient_visit_facts() f
cross join lateral (select p1.* from patients p1 where p1.id = f.patient_id offset 0) p
where f.last_appointment_at is not null
  and not f.has_future_appointment
  and p.status = 'active'
  and not p.do_not_contact
  and not p.is_minor
  and (
    (p.recall_status = 'dismissed' and (p.recall_dismissed_at is null or f.last_appointment_at <= p.recall_dismissed_at))
    or (p.recall_status = 'active' and p.recall_snoozed_until > current_date)
  );

create or replace view public.care_plan_continuity_alerts
  with (security_invoker = true)
as
select cf.patient_id,
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
       cf.last_completed_at as last_appointment_at,
       cf.completed_in_plan,
       cp.total_visits - cf.completed_in_plan as visits_remaining,
       cf.last_completed_at::date + cp.frequency_value * case when cp.frequency_unit = 'month' then 30 else 7 end as due_date,
       current_date - (cf.last_completed_at::date + cp.frequency_value * case when cp.frequency_unit = 'month' then 30 else 7 end) as days_overdue
from care_plan_visit_facts() cf
cross join lateral (select p1.* from patients p1 where p1.id = cf.patient_id offset 0) p
cross join lateral (select cp1.* from care_plans cp1 where cp1.id = cf.care_plan_id offset 0) cp
where cf.last_completed_at is not null
  and not cf.has_future_appointment
  and (cf.last_completed_at::date + cp.frequency_value * case when cp.frequency_unit = 'month' then 30 else 7 end) < current_date
  and (cp.total_visits - cf.completed_in_plan) > 0
  and p.status = 'active'
  and not p.do_not_contact
  and not p.is_minor;
