-- Pausing a team member: a baja, an illness, maternity or paternity leave.
-- They stay on the team -- their login, role, history and patients -- but
-- for those days nobody is offered their time.
--
-- It is a staff absence (20261016145412_shifts_and_leave.sql), recorded by
-- an owner rather than asked for, so it reuses what an approved absence
-- already does: a block on their calendar at every clinic they work at,
-- which online booking, the waitlist, the public API and the AI receptionist
-- all respect. The receptionist also offers a patient whose own practitioner
-- is away a colleague instead (server/utils/receptionist.ts).
--
-- What is new:
--   * kind 'parental' (maternidad / paternidad).
--   * record_staff_absence   an owner records one for anyone on the team,
--                            approved at once. The return date is optional:
--                            without one it lasts until someone says they
--                            are back. "Until further notice" is ends_on
--                            2999-12-31 (OPEN_ENDED_ABSENCE in
--                            utils/staffShifts.ts) rather than null, because
--                            every screen that lists absences filters on
--                            ends_on, and a null would drop it from all of
--                            them without a word.
--   * set_staff_absence_return   an owner moves the return date: "ha vuelto
--                            hoy", or the date once it is known. The blocks
--                            move with it. A return on or before the first
--                            day cancels the absence.
--
-- decide_staff_absence is re-created only to name the new kind on the
-- block it writes.
--
-- No patient_id, no new table.

alter table public.staff_absences drop constraint staff_absences_kind_check;
alter table public.staff_absences add constraint staff_absences_kind_check
  check (kind in ('vacation', 'personal', 'sick', 'training', 'parental'));

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
    v_label := case v_a.kind when 'vacation' then 'Vacaciones' when 'personal' then 'Asuntos propios' when 'sick' then 'Baja' when 'parental' then 'Maternidad / paternidad' else 'Formación' end;
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

create or replace function public.record_staff_absence(p_team_member_id uuid, p_kind text, p_starts_on date, p_returns_on date default null, p_note text default null)
returns public.staff_absences
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_member team_members;
  v_ends_on date;
  v_row staff_absences;
begin
  if not public.mfa_satisfied() then
    raise exception 'Two-factor verification required' using errcode = '42501';
  end if;
  select * into v_member from team_members where id = p_team_member_id;
  if v_member.id is null or not public.is_account_owner(v_member.account_id) then
    raise exception 'Only an owner can record an absence for someone' using errcode = '42501';
  end if;
  if v_member.deleted_at is not null then
    raise exception 'They are deactivated' using errcode = '22023';
  end if;
  if p_kind is null or p_kind not in ('vacation', 'personal', 'sick', 'training', 'parental') then
    raise exception 'Choose what kind of absence it is' using errcode = '22023';
  end if;
  if p_starts_on is null then
    raise exception 'Choose the first day' using errcode = '22023';
  end if;
  -- Holidays come out of a yearly allowance counted day by day, so they
  -- always have an end.
  if p_kind = 'vacation' and p_returns_on is null then
    raise exception 'Holidays need the day they are back' using errcode = '22023';
  end if;
  -- The day they are back is not part of it.
  v_ends_on := coalesce(p_returns_on - 1, date '2999-12-31');
  if v_ends_on < p_starts_on then
    raise exception 'They are back before it starts' using errcode = '22023';
  end if;
  if exists (
    select 1 from staff_absences a
    where a.team_member_id = v_member.id and a.status in ('pending', 'approved')
      and a.starts_on <= v_ends_on and a.ends_on >= p_starts_on
  ) then
    raise exception 'They already have an absence on some of those days' using errcode = '22023';
  end if;
  insert into staff_absences (account_id, team_member_id, kind, starts_on, ends_on, half_day, note)
  values (v_member.account_id, v_member.id, p_kind, p_starts_on, v_ends_on, false, nullif(btrim(coalesce(p_note, '')), ''))
  returning * into v_row;
  -- Approved, and their calendar blocked, exactly as an owner approving a
  -- request does: the same owner check, the same blocks.
  return public.decide_staff_absence(v_row.id, true);
end;
$$;
revoke all on function public.record_staff_absence(uuid, text, date, date, text) from public, anon;
grant execute on function public.record_staff_absence(uuid, text, date, date, text) to authenticated;

create or replace function public.set_staff_absence_return(p_absence_id uuid, p_returns_on date)
returns public.staff_absences
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_a staff_absences;
begin
  if not public.mfa_satisfied() then
    raise exception 'Two-factor verification required' using errcode = '42501';
  end if;
  select * into v_a from staff_absences where id = p_absence_id for update;
  if v_a.id is null or not public.is_account_owner(v_a.account_id) then
    raise exception 'Only an owner can change an absence' using errcode = '42501';
  end if;
  if v_a.status <> 'approved' then
    raise exception 'Only an approved absence has a return date' using errcode = '22023';
  end if;
  if p_returns_on is null then
    raise exception 'Choose the day they are back' using errcode = '22023';
  end if;
  if p_returns_on <= v_a.starts_on then
    return public.cancel_staff_absence(v_a.id);
  end if;
  if exists (
    select 1 from staff_absences a
    where a.team_member_id = v_a.team_member_id and a.id <> v_a.id and a.status in ('pending', 'approved')
      and a.starts_on <= p_returns_on - 1 and a.ends_on >= v_a.starts_on
  ) then
    raise exception 'That overlaps another of their absences' using errcode = '22023';
  end if;
  -- Each block ends at midnight of the return day in its own clinic's time
  -- zone, as decide_staff_absence wrote it.
  update availability_blocks b
  set ends_at = (p_returns_on::timestamp) at time zone coalesce(c.timezone, 'Europe/Madrid')
  from clinics c
  where b.id = any(v_a.block_ids) and c.id = b.clinic_id;
  update staff_absences set ends_on = p_returns_on - 1 where id = v_a.id returning * into v_a;
  return v_a;
end;
$$;
revoke all on function public.set_staff_absence_return(uuid, date) from public, anon;
grant execute on function public.set_staff_absence_return(uuid, date) to authenticated;
