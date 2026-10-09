-- Patients who have stopped doing their home exercises: at least one active
-- exercise, and nothing ticked for EXERCISE_ADHERENCE_DAYS (5) days counted
-- from the later of their last tick and their newest assignment -- so a
-- patient given something new yesterday is not flagged for last month, and
-- one who never ticked anything is flagged five days after being given it.
--
-- Only patients who CAN tick: an app or portal login (user_id), since that
-- is the only place a tick is made. Without one, every patient with
-- exercises would be "not doing them". Archived and do-not-contact patients
-- are left out, as care_plan_continuity_alerts leaves them out, because the
-- action on the row is a message.
--
-- security_invoker: patient_exercises and their logs are under the staff
-- member's patient scope, so a practitioner limited to their own patients
-- sees only those. Read by Care Plan Alerts (web and the staff app) and the
-- practitioner's 8:00 push (staffPush.ts), which runs with the service role.
create or replace view public.exercise_adherence_alerts
  with (security_invoker = true)
as
select p.id as patient_id,
       p.account_id,
       p.first_name,
       p.last_name,
       p.preferred_language,
       p.default_practitioner_id,
       count(pe.id)::integer as active_exercises,
       max(l.last_done) as last_done_on,
       current_date - greatest(max(l.last_done), max(pe.created_at)::date) as days_without
from public.patients p
join public.patient_exercises pe on pe.patient_id = p.id and pe.ended_at is null
left join lateral (
  select max(pel.done_on) as last_done
  from public.patient_exercise_logs pel
  where pel.patient_exercise_id = pe.id
) l on true
where p.user_id is not null
  and p.status = 'active'
  and not p.do_not_contact
group by p.id
having current_date - greatest(max(l.last_done), max(pe.created_at)::date) >= 5;

-- A read-only list for signed-in staff; nothing for anon, and no writes.
revoke all on public.exercise_adherence_alerts from anon, authenticated;
grant select on public.exercise_adherence_alerts to authenticated;
