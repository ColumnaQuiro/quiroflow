-- Care plan templates. Settings > Care plans used to hold one thing: the
-- maintenance the end-of-plan review proposes (20261105163000_clinic_maintenance).
-- So the page called "Care plans" was really "maintenance", and the plan a
-- patient starts on -- the intensive or corrective phase, by far the more
-- common -- had nowhere to be set up once: every one was typed by hand in the
-- patient's "New care plan".
--
-- PracticeHub 2.0 does it with templates (Settings > Billing > Care Plans):
-- one kind of care plan, whose schedule is a set course with phases, ongoing,
-- or none. Maintenance is just an ongoing template. This is the same: a
-- template is a care plan without a patient -- name, cadence, length, the
-- phases after it, its re-exam visits and how it is usually paid -- copied
-- into the plan when it is chosen. Nothing points back at it, so editing or
-- deleting one never changes a patient's plan.
--
-- One template per clinic is the maintenance: what "Keep coming" in the
-- review proposes. The maintenance cadence columns on accounts stay (the code
-- that is live until the next release reads them) and become what the review
-- falls back to when a clinic has no maintenance template.
--
-- Keyed by account, not patient: nothing for merge_patients or
-- anonymize_patient to move or remove.

create table public.care_plan_templates (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 80),
  -- The first phase, in care_plans' own shape: visits_per_period visits
  -- every frequency_value weeks or months, for total_visits (null = no end).
  visits_per_period smallint not null default 1 check (visits_per_period between 1 and 7),
  frequency_value smallint not null default 1 check (frequency_value between 1 and 52),
  frequency_unit text not null default 'week' check (frequency_unit in ('week', 'month')),
  total_visits smallint check (total_visits is null or total_visits between 1 and 200),
  -- The same checks care_plans makes (20261113132000, 20261020065508).
  next_phases jsonb not null default '[]'::jsonb
    constraint care_plan_templates_next_phases_valid check (public.care_plan_next_phases_valid(next_phases)),
  visit_markers jsonb not null default '[]'::jsonb
    constraint care_plan_templates_visit_markers_valid check (public.care_plan_visit_markers_valid(visit_markers)),
  -- How it is usually paid. A template cannot name a patient's bono or
  -- membership, so this only preselects the kind; the plan still links the
  -- patient's own.
  payment_kind text not null default 'per_visit' check (payment_kind in ('per_visit', 'bono', 'membership')),
  is_maintenance boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint care_plan_templates_next_phases_need_an_end check (total_visits is not null or next_phases = '[]'::jsonb)
);

create index care_plan_templates_account_idx on public.care_plan_templates (account_id, sort_order, name);
-- One maintenance per clinic.
create unique index care_plan_templates_one_maintenance on public.care_plan_templates (account_id) where is_maintenance;

comment on table public.care_plan_templates is
  'Reusable care plans (Settings > Care plans). Copied into care_plans when chosen; nothing references them. is_maintenance = what the end-of-plan review proposes for "Keep coming".';

alter table public.care_plan_templates enable row level security;

-- Everyone in the clinic reads them (to start a plan from one); the people
-- who may change Settings > Care plans change them, as with the maintenance
-- columns they replace (clinic_config).
create policy "staff read care_plan_templates" on public.care_plan_templates for select
  using (account_id in (select public.my_member_account_ids()));
create policy "staff manage care_plan_templates" on public.care_plan_templates for all
  using (public.is_account_member(account_id) and public.has_permission(account_id, 'settings_access') and public.has_permission(account_id, 'clinic_config'))
  with check (public.is_account_member(account_id) and public.has_permission(account_id, 'settings_access') and public.has_permission(account_id, 'clinic_config'));

select public.require_two_factor_on('public.care_plan_templates');
select public.grant_data_api('public.care_plan_templates');

create or replace function public.care_plan_templates_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
create trigger care_plan_templates_touch
  before update on public.care_plan_templates
  for each row execute function public.care_plan_templates_touch();

-- ---------------------------------------------------------------------------
-- Every clinic starts with its maintenance as a template, from what Settings
-- > Care plans held until now; a new clinic gets the same defaults.

create or replace function public.seed_maintenance_template(p_account_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.care_plan_templates (account_id, name, visits_per_period, frequency_value, frequency_unit, total_visits, payment_kind, is_maintenance)
  select a.id,
         'Mantenimiento',
         a.maintenance_visits_per_period,
         a.maintenance_frequency_value,
         a.maintenance_frequency_unit,
         a.maintenance_total_visits,
         case when a.maintenance_membership_id is not null then 'membership' else 'per_visit' end,
         true
  from public.accounts a
  where a.id = p_account_id
    and not exists (select 1 from public.care_plan_templates t where t.account_id = a.id and t.is_maintenance);
$$;
revoke all on function public.seed_maintenance_template(uuid) from public, anon, authenticated;

select public.seed_maintenance_template(id) from public.accounts;

-- A trigger rather than an edit to create_account_with_owner, as
-- seed_care_stop_reasons does: signup is not the only thing that makes an
-- account.
create or replace function public.seed_maintenance_template_for_new_account()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.seed_maintenance_template(new.id);
  return new;
end;
$$;
create trigger accounts_seed_maintenance_template
  after insert on public.accounts
  for each row execute function public.seed_maintenance_template_for_new_account();

-- ---------------------------------------------------------------------------
-- The audit trail (CLAUDE.md): a clinic setting, so audited like the
-- maintenance columns it takes over. Appended to whatever the constraint
-- allows when this runs, as 20261121163746 does.
do $$
declare
  v_types text[];
begin
  select array_agg(distinct m[1]) into v_types
  from pg_constraint c, regexp_matches(pg_get_constraintdef(c.oid), '([a-z][a-z_]*)', 'g') m
  where c.conname = 'audit_logs_entity_type_check' and c.conrelid = 'public.audit_logs'::regclass
    and m[1] not in ('entity_type', 'text');
  v_types := array(select distinct x from unnest(coalesce(v_types, '{}') || array['care_plan_template']) x order by 1);

  alter table public.audit_logs drop constraint audit_logs_entity_type_check;
  execute format('alter table public.audit_logs add constraint audit_logs_entity_type_check check (entity_type = any (%L::text[]))', v_types);
end;
$$;
create trigger trg_audit_care_plan_templates after insert or update or delete on public.care_plan_templates
  for each row execute function public.fn_audit_log('care_plan_template', 'updated_at,sort_order');
