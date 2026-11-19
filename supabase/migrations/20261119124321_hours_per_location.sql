-- A practitioner's hours at each location they work at.
--
-- team_members.business_hours is one week for the person, wherever they are.
-- That is right for somebody at one location and wrong for somebody at two:
-- a chiropractor who sees patients at the clinic all week and at a gym on
-- Tuesday and Thursday evenings was offered online at the gym every morning
-- of the week, because their own hours are authoritative and the gym's own
-- opening hours stop applying to them the moment they have any
-- (practitionerWindowsForDay). Tried on 19 Nov 2026: a location open Tue/Thu
-- 17:00-20:00 offered Wednesday 09:00.
--
-- team_member_clinics.business_hours is the week they work AT THAT LOCATION.
-- Null, which is every row today, changes nothing.
--
--   * Set for the location being booked: those are their hours there, and
--     nothing else is consulted.
--   * Not set here, but set at another location: their usual hours (their
--     own, or this location's for somebody with none) MINUS the time they are
--     down to be at the other one. So filling in the gym alone is enough;
--     nobody has to remember to carve the same evenings out of the clinic.
--
-- utils/businessHours.ts practitionerHoursAt is the same rule for every
-- screen that builds slots; assert_booking_slot_open below is what refuses a
-- booking that a client offered anyway -- an installed app from before this
-- still reads the person's single week.
--
-- No patient_id here, no new table (so no two-factor line), and
-- trg_audit_team_member_clinics already records changes to this table.

alter table public.team_member_clinics
  add column if not exists business_hours jsonb
  check (business_hours is null or jsonb_typeof(business_hours) = 'object');

comment on column public.team_member_clinics.business_hours is
  'The week this person works at this location, same shape as clinics.business_hours. Null: their usual hours.';

-- hasBusinessHoursConfigured: some day has at least one window.
create or replace function public.business_hours_configured(p_hours jsonb)
returns boolean
language sql
immutable
set search_path to 'public'
as $function$
  select jsonb_typeof(p_hours) = 'object' and exists (
    select 1 from jsonb_each(p_hours) d
    where jsonb_typeof(d.value) = 'array' and jsonb_array_length(d.value) > 0
  );
$function$;

-- 20261003154500's definition, with the hours read per location. Signature,
-- volatility and search_path unchanged.
create or replace function public.assert_booking_slot_open(
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
end;
$function$;

-- What the booking page and the patient app need to offer the right times:
-- the per-location weeks of the practitioners they are already showing.
-- get_public_booking_info and get_patient_booking_info hand out each
-- practitioner's single week; restating those two to carry this would put a
-- third copy of 250 lines in the migrations, so it is asked for beside them.
--
-- Anon's, like the booking page itself. It returns hours and nothing else,
-- only for people who can be booked online, and only rows where a week has
-- actually been set -- for an account that never uses this, nothing. The
-- other location's row is needed too (it is what gets taken out of the hours
-- here), so the location need not take online bookings itself.
create or replace function public.get_practitioner_location_hours(p_team_member_ids uuid[])
returns table(team_member_id uuid, clinic_id uuid, business_hours jsonb)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select tmc.team_member_id, tmc.clinic_id, tmc.business_hours
  from team_member_clinics tmc
  join team_members tm on tm.id = tmc.team_member_id
  join clinics c on c.id = tmc.clinic_id
  where tmc.team_member_id = any(p_team_member_ids)
    and tm.deleted_at is null
    and tm.online_booking_enabled
    and c.archived_at is null
    and business_hours_configured(tmc.business_hours);
$function$;

revoke all on function public.get_practitioner_location_hours(uuid[]) from public;
grant execute on function public.get_practitioner_location_hours(uuid[]) to anon, authenticated, service_role;

-- The calendar's reference data (20261018133323), with each link's hours so
-- the grid can hatch the time somebody is at their other location.
create or replace function public.calendar_reference(p_clinic_id uuid)
returns jsonb
language sql
stable
set search_path to 'public'
as $function$
  select jsonb_build_object(
    'appointment_types', coalesce((
      select jsonb_agg(to_jsonb(t)) from (
        select id, name, duration_minutes, color, default_price_cents, sort_order, archived_at, class_capacity
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
    ), '[]'::jsonb)
  );
$function$;

revoke all on function public.calendar_reference(uuid) from public, anon;
grant execute on function public.calendar_reference(uuid) to authenticated;
