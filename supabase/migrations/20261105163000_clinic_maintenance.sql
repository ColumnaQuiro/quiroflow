-- Maintenance is each clinic's own. Until now the review at the end of a care
-- plan (utils/planRenewal.ts) offered a maintenance plan fixed in the code --
-- one visit every three weeks, eight of them -- and a discharge that brought
-- the patient back into Recalls after ninety days. Clinics do not agree on
-- either: one sees its maintenance patients once a month for as long as they
-- keep coming, another every three weeks for a set number of visits.
--
-- Settings > Care plans now says it, and the review proposes what is set
-- there.

-- ---------------------------------------------------------------------------
-- A plan with no end. total_visits null is "Sin fin": the plan counts visits
-- from its start and never runs out, so it is never flagged for the
-- end-of-plan review. The check (total_visits > 0) stays; null passes it.
alter table public.care_plans alter column total_visits drop not null;

comment on column public.care_plans.total_visits is
  'Visits in the plan; null = no end (maintenance until someone closes it).';

-- ---------------------------------------------------------------------------
-- The clinic's maintenance, as the review proposes it.
--
--   maintenance_visits_per_period / _frequency_value / _frequency_unit
--     the cadence, in care_plans' own shape (visits every N weeks or months);
--     one a month by default.
--   maintenance_total_visits
--     how many visits; null = no end, the default.
--   maintenance_membership_id
--     the membership the review offers beside the plan, if any. Not a foreign
--     key, as recall_assignee_member_id is not: one from accounts to
--     memberships would make every accounts <-> memberships embed ambiguous
--     (memberships.account_id already joins them). One that has been deleted
--     is ignored where it is read.
--   maintenance_discharge_recall_months
--     how long after discharge the patient is back in Recalls (it was a fixed
--     ninety days).
--   maintenance_habits_article_ids
--     the habits pack: learn_articles, in the order they are sent. Archived
--     or deleted ones are skipped where it is read.
--   maintenance_habits_on_start / _on_discharge
--     whether the review offers the pack when the patient moves to
--     maintenance, and when they are discharged.
alter table public.accounts
  add column maintenance_visits_per_period smallint not null default 1
    check (maintenance_visits_per_period between 1 and 7),
  add column maintenance_frequency_value smallint not null default 1
    check (maintenance_frequency_value between 1 and 52),
  add column maintenance_frequency_unit text not null default 'month'
    check (maintenance_frequency_unit in ('week', 'month')),
  add column maintenance_total_visits smallint
    check (maintenance_total_visits is null or maintenance_total_visits between 1 and 200),
  add column maintenance_membership_id uuid,
  add column maintenance_discharge_recall_months smallint not null default 3
    check (maintenance_discharge_recall_months between 1 and 24),
  add column maintenance_habits_article_ids uuid[] not null default '{}',
  add column maintenance_habits_on_start boolean not null default true,
  add column maintenance_habits_on_discharge boolean not null default false;

-- Settings > Care plans sits under Clinic, on clinic_config. Unchanged from
-- 20261029153033 but for the maintenance line.
create or replace function public.accounts_settings_permission(p_column text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    -- Settings > Online Booking, Mobile App, Scheduling Policies, New Patient Fields
    when p_column like 'online_booking\_%' or p_column like 'patient_app\_%'
      or p_column in ('cancellation_fee_cents', 'missed_appointment_fee_cents', 'scheduling_policy_fee_cents', 'new_patient_field_config')
      -- Waitlist > how freed slots are offered
      or p_column like 'waitlist\_%'
      -- Online Booking > referral programme
      or p_column like 'referral\_%'
      -- Settings > Care plans: maintenance, discharge and the habits pack
      or p_column like 'maintenance\_%'
      then 'clinic_config'
    -- Settings > Invoicing, Payments
    when p_column like 'invoice\_email\_%' or p_column like 'hide\_%' or p_column like 'show\_%\_on_invoices' or p_column like 'stripe\_%' or p_column like 'factura\_%'
      or p_column in ('send_invoices_automatically_default', 'next_invoice_number', 'rectificativa_prefix')
      then 'billing_config'
    -- Settings > Messages, WhatsApp, Leads (and the Meta/Instagram connections)
    when p_column like 'appointment\_confirmation\_%' or p_column like 'appointment\_reminder\_%' or p_column like 'email\_%'
      or p_column like 'whatsapp\_%' or p_column like 'instagram\_%' or p_column like 'meta\_ads\_%' or p_column like 'lead\_%' or p_column like 'new_lead_notify\_%'
      or p_column in ('google_review_url', 'default_phone_country')
      -- Settings > WhatsApp > Web chat, and the Messenger Page beside Instagram
      or p_column like 'webchat\_%' or p_column like 'messenger\_%'
      -- Settings > Recalls: who a new recall is assigned to
      or p_column like 'recall\_assignee\_%'
      then 'communication_config'
    -- Settings > Import (PracticeHub connection)
    when p_column like 'practicehub\_%' then 'data_admin'
    -- Settings > Team (require two-factor)
    when p_column = 'require_two_factor' then 'team_admin'
    -- Guarded by accounts_guard_verifactu, not here.
    when p_column like 'verifactu\_%' then 'verifactu'
    else null
  end
$$;

-- ---------------------------------------------------------------------------
-- Care Plan Alerts: someone in a plan with no end is still in it, so a
-- maintenance patient whose next visit is overdue and not booked is exactly
-- who this list is for. Re-created from 20261009174400; only the
-- visits-remaining filter changes, and visits_remaining is null for them.
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
  and (cp.total_visits is null or (cp.total_visits - cf.completed_in_plan) > 0)
  and p.status = 'active'
  and not p.do_not_contact
  and not p.is_minor;
