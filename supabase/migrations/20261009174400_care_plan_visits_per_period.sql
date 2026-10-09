-- A care plan's cadence was one number read two ways. care_plans.frequency_value
-- is an interval -- "every N weeks" -- for the calendar's "repeat as the plan"
-- series, Care Plan Alerts (this view), the record's progress and the staff
-- app's plan sheet. The web plan form labelled the same number "Visitas [N]
-- cada [semana]" and the Overview showed it as "N x por semana", so a plan
-- someone entered as "2 visits a week" was booked and chased every two weeks.
--
-- Both are real needs (an intensive phase is 2-3 visits a week; maintenance
-- is one every few weeks), so a plan now says both, the way PracticeHub
-- does: visits_per_period visits every frequency_value weeks or months.
-- Existing plans keep their interval and get 1 visit per period, which is
-- what everything but those two labels already read them as.
alter table public.care_plans
  add column visits_per_period smallint not null default 1
  check (visits_per_period between 1 and 7);

-- Due after the average gap between visits: the period over the visits in
-- it, rounded up -- 2 a week is due 4 days after the last, 1 every 2 weeks
-- after 14 as before. Re-created from 20261003155100; only due_date,
-- days_overdue and the filter change, and visits_per_period is appended.
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
       cf.last_completed_at::date + g.gap_days as due_date,
       current_date - (cf.last_completed_at::date + g.gap_days) as days_overdue,
       cp.visits_per_period
from care_plan_visit_facts() cf
cross join lateral (select p1.* from patients p1 where p1.id = cf.patient_id offset 0) p
cross join lateral (select cp1.* from care_plans cp1 where cp1.id = cf.care_plan_id offset 0) cp
cross join lateral (
  select ceil((cp.frequency_value * case when cp.frequency_unit = 'month' then 30 else 7 end)::numeric / greatest(cp.visits_per_period, 1))::integer as gap_days
) g
where cf.last_completed_at is not null
  and not cf.has_future_appointment
  and (cf.last_completed_at::date + g.gap_days) < current_date
  and (cp.total_visits - cf.completed_in_plan) > 0
  and p.status = 'active'
  and not p.do_not_contact
  and not p.is_minor;
