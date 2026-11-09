-- Personal › a person's file › Contrato: how someone works for the clinic.
-- One row per contract, so a temporal made indefinido or a change of hours
-- adds a row and the history stays readable; the current one is the latest
-- that has started.
--
-- Only what QuiroFlow itself uses or hands the gestoría: no NAF, IBAN or home
-- address (the gestoría holds those for the alta, and nothing here reads them).
create table public.staff_contracts (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  -- No cascade, as time_entries: a contract is a labour record kept after
  -- someone leaves, and leaving is a soft deactivation (deleted_at). A hard
  -- delete of the person is refused rather than silently taking it along.
  team_member_id uuid not null references public.team_members(id),
  -- employee: cuenta ajena, gets nóminas. self_employed: an autónomo who
  -- invoices the clinic. partner: a socio.
  employment_type text not null check (employment_type in ('employee', 'self_employed', 'partner')),
  modality text check (modality in ('indefinido', 'temporal', 'fijo_discontinuo', 'practicas')),
  starts_on date,
  ends_on date,
  weekly_hours numeric(4, 1) check (weekly_hours > 0 and weekly_hours <= 80),
  job_title text check (char_length(job_title) <= 120),
  convenio text check (char_length(convenio) <= 200),
  created_at timestamptz not null default now(),
  created_by uuid references public.team_members(id) on delete set null,
  check (ends_on is null or starts_on is null or ends_on >= starts_on),
  -- A modalidad is a kind of employment contract; an autónomo has none.
  check (modality is null or employment_type = 'employee')
);
create index staff_contracts_member on public.staff_contracts (team_member_id, starts_on desc);
create index staff_contracts_account on public.staff_contracts (account_id);

alter table public.staff_contracts enable row level security;
create policy "own or owner select staff_contracts" on public.staff_contracts
  for select using (public.is_account_owner(account_id) or public.is_my_team_member(account_id, team_member_id));
-- Owners write, and only for someone on their own team.
create policy "owners insert staff_contracts" on public.staff_contracts
  for insert with check (
    public.is_account_owner(account_id)
    and exists (select 1 from public.team_members tm where tm.id = team_member_id and tm.account_id = staff_contracts.account_id)
  );
create policy "owners update staff_contracts" on public.staff_contracts
  for update using (public.is_account_owner(account_id))
  with check (
    public.is_account_owner(account_id)
    and exists (select 1 from public.team_members tm where tm.id = team_member_id and tm.account_id = staff_contracts.account_id)
  );
create policy "owners delete staff_contracts" on public.staff_contracts
  for delete using (public.is_account_owner(account_id));

select public.require_two_factor_on('public.staff_contracts');
select public.grant_data_api('public.staff_contracts');

-- The audit trail (CLAUDE.md), appended to whatever the constraint allows
-- when this runs rather than restated, as 20261105161255 does.
do $$
declare
  v_types text[];
begin
  select array_agg(distinct m[1]) into v_types
  from pg_constraint c, regexp_matches(pg_get_constraintdef(c.oid), '([a-z][a-z_]*)', 'g') m
  where c.conname = 'audit_logs_entity_type_check' and c.conrelid = 'public.audit_logs'::regclass
    and m[1] not in ('entity_type', 'text');
  v_types := array(select distinct x from unnest(coalesce(v_types, '{}') || array['staff_contract']) x order by 1);

  alter table public.audit_logs drop constraint audit_logs_entity_type_check;
  execute format('alter table public.audit_logs add constraint audit_logs_entity_type_check check (entity_type = any (%L::text[]))', v_types);
end;
$$;
create trigger trg_audit_staff_contracts after insert or update or delete on public.staff_contracts
  for each row execute function public.fn_audit_log('staff_contract');
