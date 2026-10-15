-- Registro de jornada: the daily record of working hours every employer in
-- Spain has to keep (Estatuto de los Trabajadores art. 34.9), for four years,
-- available to the staff, their representatives and the Inspección de
-- Trabajo.
--
-- Each person clocks themselves -- entrada, pausa, vuelta, salida -- from My
-- Day in the app or on the web. What makes it a record rather than a diary:
--
--   * The time is the server's. Nobody writes time_entries directly: the only
--     way in is clock_time(), which stamps now(). A phone set to the wrong
--     hour, or a person typing one, cannot put a time in.
--   * Nothing is ever changed or removed. A forgotten or wrong entry is fixed
--     by a CORRECTION: the person asks, with a reason (request_time_correction),
--     and an owner approves or rejects it (decide_time_correction). Approving
--     adds a new entry from the correction and marks the one it replaces as
--     superseded; the original row stays, next to who asked, why, and who
--     approved. No policy allows an update or a delete, for anyone.
--   * Each person reads their own; owners read everyone's in the account.
--
-- Someone who does not have to clock (an autónomo renting a room, say) is
-- excluded per person by an owner (time_clock_exemptions).
--
-- Every entry carries the day it counts towards (work_date), fixed when it is
-- written: the clinic's local date at the entrada, and the open day's date
-- for everything after it -- so a salida after midnight closes the day it
-- belongs to rather than opening a new one.

create table public.time_corrections (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  team_member_id uuid not null references public.team_members(id),
  work_date date not null,
  kind text not null check (kind in ('in', 'break_start', 'break_end', 'out')),
  at timestamptz not null,
  -- The entry this one corrects; null when it adds one that is missing
  -- (a salida never clocked, say).
  replaces_entry_id uuid,
  reason text not null check (length(btrim(reason)) > 0),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  requested_at timestamptz not null default now(),
  decided_by uuid references public.team_members(id),
  decided_at timestamptz
);

create table public.time_entries (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  team_member_id uuid not null references public.team_members(id),
  work_date date not null,
  kind text not null check (kind in ('in', 'break_start', 'break_end', 'out')),
  at timestamptz not null default now(),
  source text not null default 'clock' check (source in ('clock', 'correction')),
  correction_id uuid references public.time_corrections(id),
  superseded_by uuid references public.time_corrections(id),
  created_at timestamptz not null default now(),
  check ((source = 'correction') = (correction_id is not null))
);

alter table public.time_corrections
  add constraint time_corrections_replaces_entry_id_fkey foreign key (replaces_entry_id) references public.time_entries(id);

create index time_entries_member_day on public.time_entries (team_member_id, work_date);
create index time_entries_account_day on public.time_entries (account_id, work_date);
create index time_corrections_account_pending on public.time_corrections (account_id) where status = 'pending';
create index time_corrections_member on public.time_corrections (team_member_id, work_date);

create table public.time_clock_exemptions (
  team_member_id uuid primary key references public.team_members(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- The 20:00 "your day is still open" push, once per person and day
-- (server/utils/timeClock.ts). Written by the service role only.
create table public.time_clock_reminders (
  team_member_id uuid not null references public.team_members(id) on delete cascade,
  work_date date not null,
  account_id uuid not null references public.accounts(id) on delete cascade,
  sent_at timestamptz not null default now(),
  primary key (team_member_id, work_date)
);

alter table public.time_entries enable row level security;
alter table public.time_corrections enable row level security;
alter table public.time_clock_exemptions enable row level security;
alter table public.time_clock_reminders enable row level security;

create policy "own or owner select time_entries" on public.time_entries
  for select using (public.is_my_team_member(account_id, team_member_id) or public.is_account_owner(account_id));
create policy "own or owner select time_corrections" on public.time_corrections
  for select using (public.is_my_team_member(account_id, team_member_id) or public.is_account_owner(account_id));

-- Everyone reads who is excluded (My Day hides the clock for them); owners decide.
create policy "staff select time_clock_exemptions" on public.time_clock_exemptions
  for select using (public.is_account_member(account_id));
create policy "owners insert time_clock_exemptions" on public.time_clock_exemptions
  for insert with check (public.is_account_owner(account_id));
create policy "owners delete time_clock_exemptions" on public.time_clock_exemptions
  for delete using (public.is_account_owner(account_id));

select public.require_two_factor_on('public.time_entries');
select public.require_two_factor_on('public.time_corrections');
select public.require_two_factor_on('public.time_clock_exemptions');
select public.require_two_factor_on('public.time_clock_reminders');

-- The account's own date today: its first live clinic's time zone, Madrid
-- when it has none.
create or replace function public.account_local_date(p_account_id uuid, p_at timestamptz default now())
returns date
language sql
stable
security definer
set search_path to 'public'
as $$
  select (p_at at time zone coalesce(
    (select c.timezone from clinics c where c.account_id = p_account_id and c.archived_at is null and c.timezone is not null order by c.created_at limit 1),
    'Europe/Madrid'
  ))::date;
$$;
revoke all on function public.account_local_date(uuid, timestamptz) from public, anon;
grant execute on function public.account_local_date(uuid, timestamptz) to authenticated;

-- A day left open longer than this is not "still working": the next entrada
-- starts a new day and the old one is left for a correction.
-- (16 hours: a long day with a split shift, short of the next morning.)
create or replace function public.clock_time(p_account_id uuid, p_kind text)
returns public.time_entries
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_member uuid;
  v_last time_entries;
  v_open boolean;
  v_row time_entries;
begin
  if not public.mfa_satisfied() then
    raise exception 'Two-factor verification required' using errcode = '42501';
  end if;
  select tm.id into v_member from team_members tm
  where tm.account_id = p_account_id and tm.user_id = auth.uid() and tm.deleted_at is null;
  if v_member is null then
    raise exception 'Not a member of this account' using errcode = '42501';
  end if;
  if exists (select 1 from time_clock_exemptions e where e.team_member_id = v_member) then
    raise exception 'You are not set to record your working time' using errcode = '42501';
  end if;
  if p_kind not in ('in', 'break_start', 'break_end', 'out') then
    raise exception 'Unknown entry %', p_kind using errcode = '22023';
  end if;

  -- One at a time per person: two taps in a row cannot both pass the check.
  perform 1 from team_members where id = v_member for update;

  select * into v_last from time_entries
  where team_member_id = v_member and superseded_by is null
  order by at desc, created_at desc limit 1;
  v_open := v_last.id is not null and v_last.kind <> 'out' and v_last.at > now() - interval '16 hours';

  if p_kind = 'in' then
    if v_open then
      raise exception 'Your day is already open' using errcode = '22023';
    end if;
  elsif not v_open then
    raise exception 'Clock in first' using errcode = '22023';
  elsif p_kind = 'break_start' and v_last.kind = 'break_start' then
    raise exception 'You are already on a break' using errcode = '22023';
  elsif p_kind = 'break_end' and v_last.kind <> 'break_start' then
    raise exception 'You are not on a break' using errcode = '22023';
  end if;

  insert into time_entries (account_id, team_member_id, work_date, kind)
  values (
    p_account_id, v_member,
    case when p_kind = 'in' then public.account_local_date(p_account_id) else v_last.work_date end,
    p_kind
  )
  returning * into v_row;
  return v_row;
end;
$$;
revoke all on function public.clock_time(uuid, text) from public, anon;
grant execute on function public.clock_time(uuid, text) to authenticated;

create or replace function public.request_time_correction(
  p_account_id uuid,
  p_work_date date,
  p_kind text,
  p_at timestamptz,
  p_replaces_entry_id uuid,
  p_reason text
)
returns public.time_corrections
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_member uuid;
  v_replaced time_entries;
  v_row time_corrections;
begin
  if not public.mfa_satisfied() then
    raise exception 'Two-factor verification required' using errcode = '42501';
  end if;
  select tm.id into v_member from team_members tm
  where tm.account_id = p_account_id and tm.user_id = auth.uid() and tm.deleted_at is null;
  if v_member is null then
    raise exception 'Not a member of this account' using errcode = '42501';
  end if;
  if p_kind not in ('in', 'break_start', 'break_end', 'out') then
    raise exception 'Unknown entry %', p_kind using errcode = '22023';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'Say why' using errcode = '22023';
  end if;
  if p_at > now() then
    raise exception 'A correction cannot be in the future' using errcode = '22023';
  end if;
  -- Within a day either side of the day it is for (a salida after midnight).
  if p_at < (p_work_date::timestamp - interval '1 day') at time zone 'UTC'
     or p_at > (p_work_date::timestamp + interval '2 days') at time zone 'UTC' then
    raise exception 'That time is not on that day' using errcode = '22023';
  end if;
  if p_replaces_entry_id is not null then
    select * into v_replaced from time_entries where id = p_replaces_entry_id;
    if v_replaced.id is null or v_replaced.team_member_id <> v_member or v_replaced.superseded_by is not null then
      raise exception 'That entry cannot be corrected' using errcode = '22023';
    end if;
    if v_replaced.kind <> p_kind or v_replaced.work_date <> p_work_date then
      raise exception 'A correction keeps the entry''s kind and day' using errcode = '22023';
    end if;
    if exists (select 1 from time_corrections c where c.replaces_entry_id = p_replaces_entry_id and c.status = 'pending') then
      raise exception 'That entry already has a correction waiting' using errcode = '22023';
    end if;
  end if;

  insert into time_corrections (account_id, team_member_id, work_date, kind, at, replaces_entry_id, reason)
  values (p_account_id, v_member, p_work_date, p_kind, p_at, p_replaces_entry_id, btrim(p_reason))
  returning * into v_row;
  return v_row;
end;
$$;
revoke all on function public.request_time_correction(uuid, date, text, timestamptz, uuid, text) from public, anon;
grant execute on function public.request_time_correction(uuid, date, text, timestamptz, uuid, text) to authenticated;

create or replace function public.decide_time_correction(p_correction_id uuid, p_approve boolean)
returns public.time_corrections
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_c time_corrections;
  v_owner uuid;
  v_entry uuid;
begin
  if not public.mfa_satisfied() then
    raise exception 'Two-factor verification required' using errcode = '42501';
  end if;
  select * into v_c from time_corrections where id = p_correction_id for update;
  if v_c.id is null then
    raise exception 'No such correction' using errcode = '22023';
  end if;
  select tm.id into v_owner from team_members tm
  where tm.account_id = v_c.account_id and tm.user_id = auth.uid() and tm.is_owner and tm.deleted_at is null;
  if v_owner is null then
    raise exception 'Only an owner can approve a correction' using errcode = '42501';
  end if;
  if v_c.status <> 'pending' then
    raise exception 'That correction was already decided' using errcode = '22023';
  end if;

  if p_approve then
    if v_c.replaces_entry_id is not null then
      update time_entries set superseded_by = v_c.id
      where id = v_c.replaces_entry_id and superseded_by is null
      returning id into v_entry;
      if v_entry is null then
        raise exception 'That entry was already corrected' using errcode = '22023';
      end if;
    end if;
    insert into time_entries (account_id, team_member_id, work_date, kind, at, source, correction_id)
    values (v_c.account_id, v_c.team_member_id, v_c.work_date, v_c.kind, v_c.at, 'correction', v_c.id);
  end if;

  update time_corrections
  set status = case when p_approve then 'approved' else 'rejected' end, decided_by = v_owner, decided_at = now()
  where id = v_c.id
  returning * into v_c;
  return v_c;
end;
$$;
revoke all on function public.decide_time_correction(uuid, boolean) from public, anon;
grant execute on function public.decide_time_correction(uuid, boolean) to authenticated;
