-- The patient list's visit summary, without deleted visits, and with the
-- care plan's progress counted the way every other reader counts it.
--
-- Two things were wrong with 20260929130512_patient_list_visit_summary:
--
--   * It read deleted visits as real ones. Deleting an appointment keeps the
--     row (deleted_at set, status unchanged), so a deleted future booking was
--     the patient's "Next visit" and a deleted completed one raised the
--     visit count and Last visit.
--
--   * Its completed_count -- every completed visit the patient ever had --
--     was what the list showed as care-plan progress. A plan counts the
--     visits completed SINCE IT STARTED (care_plan_continuity_alerts, 0131;
--     the Clinical tab; the app), so a returning patient's new plan read half
--     done on day one. completed_in_plan is that number, against the
--     patient's newest plan (by created_at, the one the list shows).
--
-- Adding an output column changes the return type, which create or replace
-- cannot do, so the function is dropped and made again in this migration.
-- Same name and argument, and completed_count stays, so the code already
-- deployed keeps calling it unchanged.
drop function if exists public.patient_list_visit_summary(uuid[]);

create function public.patient_list_visit_summary(p_patient_ids uuid[])
returns table (patient_id uuid, last_visit_at timestamptz, completed_count integer, next_visit_at timestamptz, completed_in_plan integer)
language sql
stable
set search_path = public
as $$
  with plan as (
    select distinct on (cp.patient_id) cp.patient_id, cp.started_at
    from care_plans cp
    where cp.patient_id = any(p_patient_ids)
    order by cp.patient_id, cp.created_at desc
  )
  select a.patient_id,
         max(a.starts_at) filter (where a.status = 'completed'),
         (count(*) filter (where a.status = 'completed'))::integer,
         min(a.starts_at) filter (where a.status = 'booked' and a.starts_at > now()),
         (count(*) filter (where a.status = 'completed' and a.starts_at >= p.started_at))::integer
  from appointments a
  left join plan p on p.patient_id = a.patient_id
  where a.patient_id = any(p_patient_ids)
    and a.deleted_at is null
  group by a.patient_id
$$;

revoke all on function public.patient_list_visit_summary(uuid[]) from anon, public;
grant execute on function public.patient_list_visit_summary(uuid[]) to authenticated, service_role;
