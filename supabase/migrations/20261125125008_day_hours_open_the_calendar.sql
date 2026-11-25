-- One day's hours for one person, honoured by booking.
--
-- Clinics keep asking the same thing: "open this practitioner's calendar on Friday the
-- 11th", a day they never work. The weekly hours (team_members.business_hours)
-- cannot say it without opening every Friday, and the only per-date
-- override -- shift_days, the Turnos tab of the registro de jornada
-- (20261016145412) -- was written to "only inform": it compared a shift with
-- what was clocked and nothing else read it. Online booking, the calendar's
-- hatching and the receptionist all went on offering the weekly hours.
--
-- shift_days already holds exactly the fact wanted -- "this person's hours on
-- this date, instead of their usual ones; [] = not working" -- so it becomes
-- what decides that day, everywhere a practitioner's hours are read:
--
--   * assert_booking_slot_open (below): online and patient-app bookings.
--   * get_practitioner_day_hours (below): the booking page and the patient
--     app build their slots from it.
--   * The calendar, the staff app, the receptionist, earlier-visit offers and
--     the public API read the table directly (utils/businessHours.ts
--     withDayHours).
--
-- A day replaces the week for that date only; every other day is untouched.
-- It is not narrowed by the clinic's hours, the same rule a practitioner's
-- own week follows (practitionerWindowsForDay). Somebody who works at two
-- locations has one day for both: no account has a second location for
-- anyone yet, and a per-location day can be added when one does.
--
-- Nothing changes for anyone on the day this ships: there are no rows in
-- shift_days in production.
--
-- Writes widen from owners to team_admin, which is what already governs
-- business_hours (20260925073743): whoever can change somebody's week can
-- change one of their days. Owners pass has_permission.
--
-- No patient_id here.

-- ------------------------------------------------------------ shape
-- Each range ["HH:MM","HH:MM"], start before end. Read straight into the
-- booking check below, so a malformed row would otherwise be a day nobody can
-- book with no error anywhere.
create or replace function public.day_ranges_valid(p_ranges jsonb)
returns boolean
language sql
immutable
set search_path to 'public'
as $function$
  select jsonb_typeof(p_ranges) = 'array'
    and not exists (
      select 1 from jsonb_array_elements(p_ranges) r
      where jsonb_typeof(r) <> 'array'
        or jsonb_array_length(r) <> 2
        or jsonb_typeof(r -> 0) <> 'string'
        or jsonb_typeof(r -> 1) <> 'string'
        or (r ->> 0) !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
        or (r ->> 1) !~ '^(([01][0-9]|2[0-3]):[0-5][0-9]|24:00)$'
        or (r ->> 0) >= (r ->> 1)
    );
$function$;

alter table public.shift_days drop constraint if exists shift_days_ranges_check;
alter table public.shift_days add constraint shift_days_ranges_valid check (public.day_ranges_valid(ranges));

-- ------------------------------------------------------------ who writes
drop policy if exists "owners insert shift_days" on public.shift_days;
drop policy if exists "owners update shift_days" on public.shift_days;
drop policy if exists "owners delete shift_days" on public.shift_days;
create policy "team admins insert shift_days" on public.shift_days
  for insert with check (public.has_permission(account_id, 'team_admin'));
create policy "team admins update shift_days" on public.shift_days
  for update using (public.has_permission(account_id, 'team_admin')) with check (public.has_permission(account_id, 'team_admin'));
create policy "team admins delete shift_days" on public.shift_days
  for delete using (public.has_permission(account_id, 'team_admin'));

-- A row's person must be in the row's account: account_id is what the
-- policies above check, so a mismatch would let one account write another's
-- calendar.
create or replace function public.shift_days_same_account()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if not exists (select 1 from team_members tm where tm.id = new.team_member_id and tm.account_id = new.account_id) then
    raise exception 'That team member is not in this account';
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_shift_days_same_account on public.shift_days;
create trigger trg_shift_days_same_account before insert or update on public.shift_days
  for each row execute function public.shift_days_same_account();

-- ------------------------------------------------------------ booking page
-- The booking page and the patient app build slots in the browser, from data
-- an anonymous visitor may read. Mirrors get_practitioner_location_hours
-- (20261119124321): only people offered online, from yesterday on (a clinic
-- ahead of UTC is already on tomorrow), and at most ~400 days of them.
create or replace function public.get_practitioner_day_hours(p_team_member_ids uuid[], p_from date, p_to date)
returns table(team_member_id uuid, day date, ranges jsonb)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select sd.team_member_id, sd.day, sd.ranges
  from shift_days sd
  join team_members tm on tm.id = sd.team_member_id
  where sd.team_member_id = any(p_team_member_ids)
    and tm.deleted_at is null
    and tm.online_booking_enabled
    and sd.day >= greatest(p_from, current_date - 1)
    and sd.day <= least(p_to, greatest(p_from, current_date - 1) + 400);
$function$;

revoke all on function public.get_practitioner_day_hours(uuid[], date, date) from public;
grant execute on function public.get_practitioner_day_hours(uuid[], date, date) to anon, authenticated, service_role;

-- ------------------------------------------------------------ booking check
-- 20261122184746's definition, with the day read after the week: a
-- shift_days row for this person on this date replaces the week's windows.
create or replace function public.assert_booking_slot_open(
  p_clinic_id uuid,
  p_team_member_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz
)
returns void
language plpgsql
volatile
set search_path to 'public'
as $function$
declare
  v_timezone text;
  v_clinic_hours jsonb;
  v_member_hours jsonb;
  v_here_hours jsonb;
  v_here_set boolean;
  v_hours jsonb;
  v_date date;
  v_day text;
  v_windows jsonb;
  v_day_ranges jsonb;
begin
  select coalesce(nullif(c.timezone, ''), 'Europe/Madrid'), c.business_hours
    into v_timezone, v_clinic_hours
  from clinics c
  where c.id = p_clinic_id;

  select tm.business_hours into v_member_hours
  from team_members tm
  where tm.id = p_team_member_id;

  select tmc.business_hours into v_here_hours
  from team_member_clinics tmc
  where tmc.team_member_id = p_team_member_id and tmc.clinic_id = p_clinic_id;

  v_here_set := coalesce(business_hours_configured(v_here_hours), false);

  if v_here_set then
    v_hours := v_here_hours;
  elsif coalesce(business_hours_configured(v_member_hours), false) then
    v_hours := v_member_hours;
  else
    v_hours := v_clinic_hours;
  end if;

  v_date := (p_starts_at at time zone v_timezone)::date;
  v_day := (array['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'])[extract(dow from v_date)::int + 1];
  v_windows := case when jsonb_typeof(v_hours -> v_day) = 'array' then v_hours -> v_day else '[]'::jsonb end;

  -- This person's hours on this date, when somebody set them: instead of the
  -- week's, whatever the week says ([] = not working that day).
  select sd.ranges into v_day_ranges
  from shift_days sd
  where sd.team_member_id = p_team_member_id and sd.day = v_date;
  if found then
    v_windows := v_day_ranges;
  end if;

  -- The whole visit inside one window, as the page builds slots: a slot is
  -- only offered when it ends by the window's close.
  if not exists (
    select 1 from jsonb_array_elements(v_windows) w
    where p_starts_at >= ((v_date + (w ->> 0)::time) at time zone v_timezone)
      and p_ends_at <= ((v_date + (w ->> 1)::time) at time zone v_timezone)
  ) then
    raise exception 'That time is not available for booking';
  end if;

  -- With no hours of their own for THIS location, the time they are down to
  -- be at another one is not theirs to give here. Read on this location's
  -- clock: two locations of one account in different time zones is not a
  -- case this tries to be exact about.
  if not v_here_set and exists (
    select 1
    from team_member_clinics o
    join clinics oc on oc.id = o.clinic_id and oc.archived_at is null
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(o.business_hours -> v_day) = 'array' then o.business_hours -> v_day else '[]'::jsonb end
    ) w
    where o.team_member_id = p_team_member_id
      and o.clinic_id <> p_clinic_id
      and business_hours_configured(o.business_hours)
      and p_starts_at < ((v_date + (w ->> 1)::time) at time zone v_timezone)
      and p_ends_at > ((v_date + (w ->> 0)::time) at time zone v_timezone)
  ) then
    raise exception 'That time is not available for booking';
  end if;

  -- A block naming nobody closes this clinic for everyone; one naming this
  -- practitioner keeps them away wherever it was entered -- somebody who
  -- works at two clinics is one person, and a morning blocked off at the
  -- other one is a morning they are not here either.
  if exists (
    select 1 from availability_blocks b
    where (
        (b.clinic_id = p_clinic_id and b.practitioner_id is null)
        or b.practitioner_id = p_team_member_id
      )
      and b.starts_at < p_ends_at
      and b.ends_at > p_starts_at
  ) then
    raise exception 'That time is not available for booking';
  end if;

  -- An online booking of this slot is about to be written: the trigger on
  -- appointments holds it to its type's windows (see 20261122184746).
  -- Transaction-local, so it ends with the booking function's own call.
  perform set_config('quiroflow.online_booking_slot', online_booking_slot_key(p_team_member_id, p_starts_at), true);
end;
$function$;

revoke all on function public.assert_booking_slot_open(uuid, uuid, timestamptz, timestamptz) from public, anon, authenticated;

-- ------------------------------------------------------------ calendar
-- 20261123134304's definition plus 'day_hours': the one-off days around
-- today, so the grid hatches a day the way booking will treat it, in the same
-- single request (the calendar's first paint is one round trip on purpose).
-- Caller-scoped like the rest of it: shift_days' select policy keeps it to
-- the caller's account.
create or replace function public.calendar_reference(p_clinic_id uuid)
returns jsonb
language sql
stable
set search_path to 'public'
as $function$
  select jsonb_build_object(
    'appointment_types', coalesce((
      select jsonb_agg(to_jsonb(t)) from (
        select id, name, duration_minutes, color, default_price_cents, sort_order, archived_at, class_capacity,
               online_booking_enabled, online_booking_windows, practitioner_ids
        from appointment_types
      ) t
    ), '[]'::jsonb),
    'team_members', coalesce((
      select jsonb_agg(to_jsonb(m)) from (
        select id, full_name, color, business_hours
        from team_members
        where deleted_at is null and is_practitioner
        order by full_name
      ) m
    ), '[]'::jsonb),
    'overrides', coalesce((
      select jsonb_agg(to_jsonb(o)) from (
        select appointment_type_id, team_member_id, duration_minutes, price_cents
        from appointment_type_overrides
      ) o
    ), '[]'::jsonb),
    'team_member_clinics', coalesce((
      select jsonb_agg(to_jsonb(c)) from (
        select team_member_id, clinic_id, business_hours from team_member_clinics
      ) c
    ), '[]'::jsonb),
    'rooms', coalesce((
      select jsonb_agg(to_jsonb(r)) from (
        select id, name from calendar_resources
        where p_clinic_id is not null and clinic_id = p_clinic_id
        order by name
      ) r
    ), '[]'::jsonb),
    'day_hours', coalesce((
      select jsonb_agg(to_jsonb(d)) from (
        select team_member_id, day, ranges from shift_days
        where day between current_date - 120 and current_date + 400
      ) d
    ), '[]'::jsonb)
  );
$function$;

revoke all on function public.calendar_reference(uuid) from public, anon;
grant execute on function public.calendar_reference(uuid) to authenticated;
