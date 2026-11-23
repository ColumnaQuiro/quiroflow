-- The times an appointment type can be booked online.
--
-- Online booking offers a type in every free slot of the practitioner's
-- hours. A clinic coming from PracticeHub keeps half-hour "special" slots in
-- the diary for first assessments, first consultations, reports and reviews,
-- so those types can only be booked at those times; a free 30-minute
-- assessment for people arriving from an Instagram ad is offered on Tuesday
-- and Thursday at 10:00 and 17:00, say, and never in the middle of a morning
-- of adjustments. Nothing in QuiroFlow could say that.
--
-- appointment_types.online_booking_windows is that. Null, which is every row
-- today, changes nothing. Otherwise it is
--
--   { "all": <week>, "practitioners": { "<team_member_id>": <week> } }
--
-- with each <week> the shape of clinics.business_hours
-- ({ "mon": [["10:00", "10:30"], ...], ... }). A practitioner with a week of
-- their own uses it; everyone else uses "all". A day with no window is a day
-- the type is not offered online, so a type restricted to Tuesdays has every
-- other day empty.
--
-- A visit is offered only where it fits inside BOTH a window of the
-- practitioner's hours and a window of the type -- a window is where the
-- type can be booked, not a new opening time -- and the slots step from the
-- start of that overlap, so a 45-minute window takes a 45-minute visit at its
-- start whatever the hours around it. utils/bookingSlots.ts builds that for
-- the booking page (and so the lead/ad link, which is the same page), the
-- patient app and the receptionist.
--
-- Only online booking is restricted. Staff book the type at any time from the
-- calendar, and the public API and a waitlist claim are held to the clinic's
-- own rules as 20260930155957 explains.
--
-- WHERE THE RULE IS ENFORCED. The booking functions take any time a caller
-- hands them, so the check has to live here as well as in the pages
-- (20260930141539 says why). Restating create_public_booking,
-- create_patient_booking and reschedule_patient_appointment to pass a type
-- into assert_booking_slot_open would put another ~700 lines of copies in the
-- migrations, and the next restatement of any of them could drop the line.
-- Instead:
--
--   * assert_booking_slot_open, which every one of them already calls just
--     before it writes the visit, notes in a transaction-local setting which
--     slot it has just let through (practitioner and start);
--   * a trigger on appointments checks that row's type windows when the row
--     being written IS that slot.
--
-- So the rule holds for every caller of assert_booking_slot_open, present and
-- future, and for nothing else: a staff booking, an import, the API and the
-- waitlist never call it, never set the note, and are never checked. Setting
-- the note from a function that only reads would be wrong, so
-- assert_booking_slot_open is now volatile; its signature and search_path are
-- unchanged.
--
-- No new table (so no two-factor or grants line), no patient_id, nothing on
-- accounts. trg_audit_appointment_types already records changes to the
-- column, and the read-only guard already covers the table.

-- ---------------------------------------------------------------------------
-- The column
-- ---------------------------------------------------------------------------

-- One week: an object of day keys, each a list of [from, to] "HH:MM" pairs
-- with from before to.
create or replace function public.booking_week_valid(p_week jsonb)
returns boolean
language sql
immutable
set search_path to 'public'
as $function$
  select jsonb_typeof(p_week) = 'object' and not exists (
    select 1
    from jsonb_each(p_week) d
    where d.key not in ('mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun')
       or jsonb_typeof(d.value) <> 'array'
       or exists (
         select 1 from jsonb_array_elements(d.value) w
         where jsonb_typeof(w) <> 'array'
            or jsonb_array_length(w) <> 2
            or coalesce(w ->> 0, '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
            or coalesce(w ->> 1, '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
            or (w ->> 0) >= (w ->> 1)
       )
  );
$function$;

create or replace function public.online_booking_windows_valid(p_windows jsonb)
returns boolean
language sql
immutable
set search_path to 'public'
as $function$
  select p_windows is null or (
    jsonb_typeof(p_windows) = 'object'
    and not exists (select 1 from jsonb_object_keys(p_windows) k where k not in ('all', 'practitioners'))
    and (p_windows -> 'all' is null or booking_week_valid(p_windows -> 'all'))
    and (
      p_windows -> 'practitioners' is null
      or (
        jsonb_typeof(p_windows -> 'practitioners') = 'object'
        and not exists (
          select 1 from jsonb_each(p_windows -> 'practitioners') p
          where p.key !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
             or not booking_week_valid(p.value)
        )
      )
    )
  );
$function$;

alter table public.appointment_types
  add column if not exists online_booking_windows jsonb
  constraint appointment_types_online_booking_windows_check check (public.online_booking_windows_valid(online_booking_windows));

comment on column public.appointment_types.online_booking_windows is
  'When this type can be booked online: {"all": week, "practitioners": {team_member_id: week}}, each week shaped like clinics.business_hours. Null: whenever the practitioner is free.';

-- The windows of one practitioner on one weekday: null when the type has no
-- restriction, otherwise a (possibly empty) list of [from, to] pairs.
-- utils/bookingSlots.ts typeWindowsOn is the same rule.
create or replace function public.online_booking_windows_on(p_windows jsonb, p_team_member_id uuid, p_day text)
returns jsonb
language sql
immutable
set search_path to 'public'
as $function$
  select case
    when p_windows is null then null
    else coalesce(
      case
        when jsonb_typeof(p_windows -> 'practitioners' -> p_team_member_id::text) = 'object'
          then p_windows -> 'practitioners' -> p_team_member_id::text -> p_day
        else p_windows -> 'all' -> p_day
      end,
      '[]'::jsonb
    )
  end;
$function$;

-- ---------------------------------------------------------------------------
-- The check
-- ---------------------------------------------------------------------------

-- The visit fits inside one of its type's windows that day, on the clinic's
-- clock -- the same reading assert_booking_slot_open makes of the hours.
create or replace function public.assert_booking_type_window(
  p_appointment_type_id uuid,
  p_clinic_id uuid,
  p_team_member_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz
)
returns void
language plpgsql
stable
set search_path to 'public'
as $function$
declare
  v_windows jsonb;
  v_timezone text;
  v_date date;
  v_day text;
  v_today jsonb;
begin
  select t.online_booking_windows into v_windows
  from appointment_types t
  where t.id = p_appointment_type_id;
  if v_windows is null then
    return;
  end if;

  select coalesce(nullif(c.timezone, ''), 'Europe/Madrid') into v_timezone
  from clinics c where c.id = p_clinic_id;
  v_timezone := coalesce(v_timezone, 'Europe/Madrid');

  v_date := (p_starts_at at time zone v_timezone)::date;
  v_day := (array['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'])[extract(dow from v_date)::int + 1];
  v_today := online_booking_windows_on(v_windows, p_team_member_id, v_day);

  if jsonb_typeof(v_today) <> 'array' or not exists (
    select 1 from jsonb_array_elements(v_today) w
    where p_starts_at >= ((v_date + (w ->> 0)::time) at time zone v_timezone)
      and p_ends_at <= ((v_date + (w ->> 1)::time) at time zone v_timezone)
  ) then
    raise exception 'That time is not available for booking';
  end if;
end;
$function$;

revoke all on function public.assert_booking_type_window(uuid, uuid, uuid, timestamptz, timestamptz) from public, anon, authenticated;

-- The slot assert_booking_slot_open has just let through, as the trigger
-- below compares it.
create or replace function public.online_booking_slot_key(p_team_member_id uuid, p_starts_at timestamptz)
returns text
language sql
immutable
set search_path to 'public'
as $function$
  select coalesce(p_team_member_id::text, '') || '|' || extract(epoch from p_starts_at)::text;
$function$;

-- 20261119124321's definition, unchanged but for the note at the end and the
-- volatility that note needs.
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
  -- appointments holds it to its type's windows (see the top of this file).
  -- Transaction-local, so it ends with the booking function's own call.
  perform set_config('quiroflow.online_booking_slot', online_booking_slot_key(p_team_member_id, p_starts_at), true);
end;
$function$;

revoke all on function public.assert_booking_slot_open(uuid, uuid, timestamptz, timestamptz) from public, anon, authenticated;

-- Security definer so the check it calls, which nobody else may execute,
-- runs whoever's statement fired it. For every write but an online booking's
-- it returns before reading anything.
create or replace function public.appointments_obey_type_booking_windows()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.appointment_type_id is null
     or coalesce(current_setting('quiroflow.online_booking_slot', true), '') = ''
     or current_setting('quiroflow.online_booking_slot', true) <> online_booking_slot_key(new.practitioner_id, new.starts_at) then
    return new;
  end if;
  perform assert_booking_type_window(new.appointment_type_id, new.clinic_id, new.practitioner_id, new.starts_at, new.ends_at);
  return new;
end;
$function$;

drop trigger if exists trg_appointments_obey_type_booking_windows on public.appointments;
create trigger trg_appointments_obey_type_booking_windows
  before insert or update of starts_at, ends_at, practitioner_id, appointment_type_id, clinic_id
  on public.appointments
  for each row execute function public.appointments_obey_type_booking_windows();

-- ---------------------------------------------------------------------------
-- What the booking page and the patient app read
-- ---------------------------------------------------------------------------

-- The windows of the types they are already showing, asked for beside
-- get_public_booking_info and get_patient_booking_info rather than by
-- restating those two (the reason 20261119124321 gives for
-- get_practitioner_location_hours). Anon's, like the booking page: it
-- returns times and nothing else, only for types that are booked online, and
-- only types that have windows -- for an account that never uses this,
-- nothing.
create or replace function public.get_appointment_type_booking_windows(p_type_ids uuid[])
returns table(appointment_type_id uuid, online_booking_windows jsonb)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select t.id, t.online_booking_windows
  from appointment_types t
  where t.id = any(p_type_ids)
    and t.online_booking_enabled
    and t.archived_at is null
    and t.online_booking_windows is not null;
$function$;

revoke all on function public.get_appointment_type_booking_windows(uuid[]) from public;
grant execute on function public.get_appointment_type_booking_windows(uuid[]) to anon, authenticated, service_role;
