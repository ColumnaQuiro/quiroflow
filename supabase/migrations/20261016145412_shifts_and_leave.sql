-- Shifts and leave (turnos y vacaciones), the follow-up to the registro de
-- jornada (20261015075045). Design: the "Turnos y vacaciones" row of the
-- QuiroFlow canvas.
--
-- A person's SHIFT is their weekly hours, team_members.business_hours -- the
-- schedule the calendar and online booking already read for a practitioner,
-- now set for the front desk too (Settings > Team). One day can be changed
-- without touching the week: shift_days holds that day's hours instead
-- ([] = not working). The Turnos tab compares the shift with what was
-- clocked, and only informs.
--
-- LEAVE is asked for by the person and decided by an owner:
--   request_staff_absence   their own, pending
--   decide_staff_absence    an owner; approving blocks that person's calendar
--                           for the days (availability_blocks, so neither
--                           online booking nor the waitlist offers them),
--                           unless it is half a day
--   cancel_staff_absence    the person while pending; an owner at any time,
--                           which takes the blocks away again
-- Pushes go out from the server endpoints that call the first two
-- (server/api/staff-absences).
--
-- Holiday allowance per person per year: staff_leave_allowances, 22 working
-- days when there is no row.
--
-- No patient_id anywhere here.

create table public.shift_days (
  team_member_id uuid not null references public.team_members(id) on delete cascade,
  day date not null,
  account_id uuid not null references public.accounts(id) on delete cascade,
  ranges jsonb not null default '[]'::jsonb check (jsonb_typeof(ranges) = 'array'),
  updated_at timestamptz not null default now(),
  primary key (team_member_id, day)
);
alter table public.shift_days enable row level security;
create policy "staff select shift_days" on public.shift_days for select using (public.is_account_member(account_id));
create policy "owners insert shift_days" on public.shift_days for insert with check (public.is_account_owner(account_id));
create policy "owners update shift_days" on public.shift_days for update using (public.is_account_owner(account_id)) with check (public.is_account_owner(account_id));
create policy "owners delete shift_days" on public.shift_days for delete using (public.is_account_owner(account_id));
select public.require_two_factor_on('public.shift_days');

create table public.staff_leave_allowances (
  team_member_id uuid primary key references public.team_members(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  days_per_year numeric(5, 1) not null default 22 check (days_per_year >= 0 and days_per_year <= 366)
);
alter table public.staff_leave_allowances enable row level security;
create policy "staff select staff_leave_allowances" on public.staff_leave_allowances for select using (public.is_account_member(account_id));
create policy "owners insert staff_leave_allowances" on public.staff_leave_allowances for insert with check (public.is_account_owner(account_id));
create policy "owners update staff_leave_allowances" on public.staff_leave_allowances for update using (public.is_account_owner(account_id)) with check (public.is_account_owner(account_id));
select public.require_two_factor_on('public.staff_leave_allowances');

create table public.staff_absences (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  team_member_id uuid not null references public.team_members(id) on delete cascade,
  kind text not null check (kind in ('vacation', 'personal', 'sick', 'training')),
  starts_on date not null,
  ends_on date not null,
  half_day boolean not null default false,
  note text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  requested_at timestamptz not null default now(),
  decided_by uuid references public.team_members(id) on delete set null,
  decided_at timestamptz,
  block_ids uuid[] not null default '{}',
  check (ends_on >= starts_on),
  check (not half_day or starts_on = ends_on)
);
create index staff_absences_member on public.staff_absences (team_member_id, starts_on);
create index staff_absences_account_pending on public.staff_absences (account_id) where status = 'pending';
alter table public.staff_absences enable row level security;
create policy "own or owner select staff_absences" on public.staff_absences
  for select using (public.is_my_team_member(account_id, team_member_id) or public.is_account_owner(account_id));
select public.require_two_factor_on('public.staff_absences');

create or replace function public.request_staff_absence(p_account_id uuid, p_kind text, p_starts_on date, p_ends_on date, p_half_day boolean default false, p_note text default null)
returns public.staff_absences
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_member uuid;
  v_row staff_absences;
begin
  if not public.mfa_satisfied() then
    raise exception 'Two-factor verification required' using errcode = '42501';
  end if;
  select tm.id into v_member from team_members tm
  where tm.account_id = p_account_id and tm.user_id = auth.uid() and tm.deleted_at is null;
  if v_member is null then
    raise exception 'Not a member of this account' using errcode = '42501';
  end if;
  if p_starts_on is null or p_ends_on is null or p_ends_on < p_starts_on then
    raise exception 'Choose the days' using errcode = '22023';
  end if;
  if coalesce(p_half_day, false) and p_starts_on <> p_ends_on then
    raise exception 'Half a day is one day' using errcode = '22023';
  end if;
  if exists (
    select 1 from staff_absences a
    where a.team_member_id = v_member and a.status in ('pending', 'approved')
      and a.starts_on <= p_ends_on and a.ends_on >= p_starts_on
  ) then
    raise exception 'You already asked for some of those days' using errcode = '22023';
  end if;
  insert into staff_absences (account_id, team_member_id, kind, starts_on, ends_on, half_day, note)
  values (p_account_id, v_member, p_kind, p_starts_on, p_ends_on, coalesce(p_half_day, false), nullif(btrim(coalesce(p_note, '')), ''))
  returning * into v_row;
  return v_row;
end;
$$;
revoke all on function public.request_staff_absence(uuid, text, date, date, boolean, text) from public, anon;
grant execute on function public.request_staff_absence(uuid, text, date, date, boolean, text) to authenticated;

create or replace function public.decide_staff_absence(p_absence_id uuid, p_approve boolean)
returns public.staff_absences
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_a staff_absences;
  v_owner uuid;
  v_name text;
  v_blocks uuid[] := '{}';
  v_label text;
  r record;
  v_block uuid;
begin
  if not public.mfa_satisfied() then
    raise exception 'Two-factor verification required' using errcode = '42501';
  end if;
  select * into v_a from staff_absences where id = p_absence_id for update;
  if v_a.id is null then
    raise exception 'No such request' using errcode = '22023';
  end if;
  select tm.id into v_owner from team_members tm
  where tm.account_id = v_a.account_id and tm.user_id = auth.uid() and tm.is_owner and tm.deleted_at is null;
  if v_owner is null then
    raise exception 'Only an owner can decide a request' using errcode = '42501';
  end if;
  if v_a.status <> 'pending' then
    raise exception 'That request was already decided' using errcode = '22023';
  end if;

  if p_approve and not v_a.half_day then
    select full_name into v_name from team_members where id = v_a.team_member_id;
    v_label := case v_a.kind when 'vacation' then 'Vacaciones' when 'personal' then 'Asuntos propios' when 'sick' then 'Baja' else 'Formación' end;
    -- One block per clinic the person works at (every clinic of the account
    -- when they are linked to none), midnight to midnight in that clinic's
    -- own time zone, as the calendar's "whole day" block is.
    for r in
      select c.id, coalesce(c.timezone, 'Europe/Madrid') as tz
      from clinics c
      where c.account_id = v_a.account_id and c.archived_at is null
        and (
          exists (select 1 from team_member_clinics l where l.team_member_id = v_a.team_member_id and l.clinic_id = c.id)
          or not exists (select 1 from team_member_clinics l where l.team_member_id = v_a.team_member_id)
        )
    loop
      insert into availability_blocks (account_id, clinic_id, practitioner_id, room_id, starts_at, ends_at, note, created_by)
      values (
        v_a.account_id, r.id, v_a.team_member_id, null,
        (v_a.starts_on::timestamp) at time zone r.tz,
        ((v_a.ends_on + 1)::timestamp) at time zone r.tz,
        v_label || ' · ' || coalesce(v_name, ''),
        v_owner
      )
      returning id into v_block;
      v_blocks := v_blocks || v_block;
    end loop;
  end if;

  update staff_absences
  set status = case when p_approve then 'approved' else 'rejected' end,
      decided_by = v_owner, decided_at = now(), block_ids = v_blocks
  where id = v_a.id
  returning * into v_a;
  return v_a;
end;
$$;
revoke all on function public.decide_staff_absence(uuid, boolean) from public, anon;
grant execute on function public.decide_staff_absence(uuid, boolean) to authenticated;

create or replace function public.cancel_staff_absence(p_absence_id uuid)
returns public.staff_absences
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_a staff_absences;
  v_is_owner boolean;
  v_is_self boolean;
begin
  if not public.mfa_satisfied() then
    raise exception 'Two-factor verification required' using errcode = '42501';
  end if;
  select * into v_a from staff_absences where id = p_absence_id for update;
  if v_a.id is null then
    raise exception 'No such request' using errcode = '22023';
  end if;
  v_is_owner := public.is_account_owner(v_a.account_id);
  v_is_self := public.is_my_team_member(v_a.account_id, v_a.team_member_id);
  if not (v_is_owner or (v_is_self and v_a.status = 'pending')) then
    raise exception 'Only an owner can cancel a decided request' using errcode = '42501';
  end if;
  if v_a.status not in ('pending', 'approved') then
    raise exception 'That request is already closed' using errcode = '22023';
  end if;
  delete from availability_blocks where id = any(v_a.block_ids);
  update staff_absences set status = 'cancelled', block_ids = '{}' where id = v_a.id returning * into v_a;
  return v_a;
end;
$$;
revoke all on function public.cancel_staff_absence(uuid) from public, anon;
grant execute on function public.cancel_staff_absence(uuid) to authenticated;
