-- Personal, phases 3 and 5: each person's papers (nóminas, contracts,
-- certificates, partes de baja) and what each person costs the clinic a
-- month, for Rentabilidad por profesional.

-- 1. Documents ---------------------------------------------------------------
--
-- Owners upload; the person reads their own -- except a parte de baja, which
-- is health data and stays with owners. "Visto" is the person's first open,
-- a read receipt and not a signature, set through mark_staff_document_viewed.
create table public.staff_documents (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  -- Restrict, not cascade: leaving is a soft deactivation, and a hard delete
  -- of the person must not silently take their payslips with it -- the way
  -- facturas.patient_id refuses for a patient.
  team_member_id uuid not null references public.team_members(id) on delete restrict,
  category text not null check (category in ('payslip', 'contract', 'certificate', 'sick_note', 'other')),
  -- The month a payslip is for (its first day); optional for the rest.
  period date check (period is null or extract(day from period) = 1),
  title text check (char_length(title) <= 200),
  storage_path text not null unique,
  file_name text not null check (char_length(file_name) <= 255),
  size_bytes integer check (size_bytes >= 0),
  content_type text,
  uploaded_by uuid references public.team_members(id) on delete set null,
  uploaded_at timestamptz not null default now(),
  first_viewed_at timestamptz,
  check (category <> 'payslip' or period is not null)
);
create index staff_documents_member on public.staff_documents (team_member_id, uploaded_at desc);
create index staff_documents_account on public.staff_documents (account_id, uploaded_at desc);

alter table public.staff_documents enable row level security;
create policy "owner or own select staff_documents" on public.staff_documents
  for select using (
    public.is_account_owner(account_id)
    or (category <> 'sick_note' and public.is_my_team_member(account_id, team_member_id))
  );
create policy "owners insert staff_documents" on public.staff_documents
  for insert with check (
    public.is_account_owner(account_id)
    and exists (select 1 from public.team_members tm where tm.id = team_member_id and tm.account_id = staff_documents.account_id)
  );
create policy "owners update staff_documents" on public.staff_documents
  for update using (public.is_account_owner(account_id))
  with check (
    public.is_account_owner(account_id)
    and exists (select 1 from public.team_members tm where tm.id = team_member_id and tm.account_id = staff_documents.account_id)
  );
create policy "owners delete staff_documents" on public.staff_documents
  for delete using (public.is_account_owner(account_id));
select public.require_two_factor_on('public.staff_documents');
select public.grant_data_api('public.staff_documents');

-- The person opening their own document: only first_viewed_at, only once,
-- only their own. A definer function rather than an update policy, which
-- could not stop them changing the other columns.
create or replace function public.mark_staff_document_viewed(p_document_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.mfa_satisfied() then
    raise exception 'Two-factor required' using errcode = 'insufficient_privilege';
  end if;
  update public.staff_documents d
  set first_viewed_at = now()
  where d.id = p_document_id
    and d.first_viewed_at is null
    and d.category <> 'sick_note'
    and public.is_my_team_member(d.account_id, d.team_member_id);
end;
$$;
revoke all on function public.mark_staff_document_viewed(uuid) from public, anon;
grant execute on function public.mark_staff_document_viewed(uuid) to authenticated;

-- The files: private, under <account>/<team member>/. Readable by whoever
-- can read the row that names them.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('team-member-files', 'team-member-files', false, 20971520, array['application/pdf', 'image/jpeg', 'image/png'])
on conflict (id) do nothing;

create policy "owners manage team-member-files" on storage.objects
  for all using (bucket_id = 'team-member-files' and public.is_account_owner((storage.foldername(name))[1]::uuid))
  with check (bucket_id = 'team-member-files' and public.is_account_owner((storage.foldername(name))[1]::uuid));
create policy "own team-member-files" on storage.objects
  for select using (
    bucket_id = 'team-member-files'
    and exists (
      select 1 from public.staff_documents d
      where d.storage_path = storage.objects.name
        and d.category <> 'sick_note'
        and public.is_my_team_member(d.account_id, d.team_member_id)
    )
  );

-- 2. What each person costs ---------------------------------------------------
--
-- The month's coste empresa from the gestoría, per person, typed in by an
-- owner. Without it, Rentabilidad estimates from the pay plan and says so.
create table public.staff_monthly_costs (
  account_id uuid not null references public.accounts(id) on delete cascade,
  team_member_id uuid not null references public.team_members(id),
  month date not null check (extract(day from month) = 1),
  cost_cents bigint not null check (cost_cents >= 0 and cost_cents < 100000000),
  updated_at timestamptz not null default now(),
  primary key (team_member_id, month)
);
create index staff_monthly_costs_account on public.staff_monthly_costs (account_id, month);
alter table public.staff_monthly_costs enable row level security;
create policy "owners select staff_monthly_costs" on public.staff_monthly_costs
  for select using (public.is_account_owner(account_id));
create policy "owners insert staff_monthly_costs" on public.staff_monthly_costs
  for insert with check (
    public.is_account_owner(account_id)
    and exists (select 1 from public.team_members tm where tm.id = team_member_id and tm.account_id = staff_monthly_costs.account_id)
  );
create policy "owners update staff_monthly_costs" on public.staff_monthly_costs
  for update using (public.is_account_owner(account_id))
  with check (public.is_account_owner(account_id));
create policy "owners delete staff_monthly_costs" on public.staff_monthly_costs
  for delete using (public.is_account_owner(account_id));
select public.require_two_factor_on('public.staff_monthly_costs');
select public.grant_data_api('public.staff_monthly_costs');

-- 3. The audit trail (CLAUDE.md), appended as 20261105161255 does ----------------
do $$
declare
  v_types text[];
begin
  select array_agg(distinct m[1]) into v_types
  from pg_constraint c, regexp_matches(pg_get_constraintdef(c.oid), '([a-z][a-z_]*)', 'g') m
  where c.conname = 'audit_logs_entity_type_check' and c.conrelid = 'public.audit_logs'::regclass
    and m[1] not in ('entity_type', 'text');
  v_types := array(select distinct x from unnest(coalesce(v_types, '{}') || array['staff_document', 'staff_monthly_cost']) x order by 1);

  alter table public.audit_logs drop constraint audit_logs_entity_type_check;
  execute format('alter table public.audit_logs add constraint audit_logs_entity_type_check check (entity_type = any (%L::text[]))', v_types);
end;
$$;
create trigger trg_audit_staff_documents after insert or update or delete on public.staff_documents
  for each row execute function public.fn_audit_log('staff_document');
create trigger trg_audit_staff_monthly_costs after insert or update or delete on public.staff_monthly_costs
  for each row execute function public.fn_audit_log('staff_monthly_cost', 'updated_at');
