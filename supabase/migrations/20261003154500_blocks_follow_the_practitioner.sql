-- Blocked time follows the practitioner; somebody who has left stays off the
-- booking page.
--
-- 1. A practitioner's own block at their OTHER clinic. availability_blocks
--    rows belong to a clinic, and every reader asked only about the clinic
--    being booked: assert_booking_slot_open (the booking page and the patient
--    app), get_booking_blocked_times (what those screens grey out) and
--    save_appointment_if_free (a waitlist claim). So a practitioner who works
--    at two clinics and had a morning blocked off at one was offered, and
--    booked, at the other for the same morning. 20260930160011 made the same
--    correction for their appointments.
--
--    The rule now, everywhere: a block that names a practitioner keeps THAT
--    practitioner away at every clinic of the account; a block that names
--    nobody (a closure, a room) stays the business of the clinic it is at.
--
--    get_booking_blocked_times is anon's. It still returns only start, end
--    and practitioner -- no note, no clinic -- and from another clinic only
--    the blocks of practitioners who work at the one being booked, which is
--    what get_booking_busy_times already hands out for appointments. Its
--    shape is unchanged, so the page and every installed app read the extra
--    rows exactly as they read this clinic's own practitioner blocks.
--
-- 2. "Bookable online" for somebody who has left. Leaving switches it off
--    (20260925112120), and get_public_booking_info / create_public_booking
--    refuse a departed member whatever the switch says (20260930160011). But
--    the switch could still be turned back on, and every OTHER reader of
--    online_booking_enabled -- the API's availability, the receptionist, the
--    reports -- takes it at its word. The same trigger now holds it off for as
--    long as deleted_at is set, on any write, and a check constraint is the
--    floor under it. The trigger coerces rather than refuses, so the Settings
--    page already live, which saves the whole form including the switch,
--    keeps saving a departed member's other fields without an error.
--
-- Signatures, security definer and search_path are unchanged; grants are
-- restated below.

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

  -- hasBusinessHoursConfigured: some day has at least one window.
  if jsonb_typeof(v_member_hours) = 'object' and exists (
    select 1 from jsonb_each(v_member_hours) d
    where jsonb_typeof(d.value) = 'array' and jsonb_array_length(d.value) > 0
  ) then
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


create or replace function public.get_booking_blocked_times(
  p_clinic_id uuid,
  p_from timestamptz,
  p_to timestamptz
)
returns table (starts_at timestamptz, ends_at timestamptz, practitioner_id uuid)
language sql
security definer
set search_path = public
as $$
  -- This clinic's blocks, as before, plus each block another clinic of the
  -- account holds for a practitioner who also works here. The clinic being
  -- booked is what opens the door: it has to take online bookings.
  select b.starts_at, b.ends_at, b.practitioner_id
  from clinics c
  join availability_blocks b on b.account_id = c.account_id
  where c.id = p_clinic_id
    and c.online_booking_enabled = true
    and (
      b.clinic_id = p_clinic_id
      or (
        b.practitioner_id is not null
        and exists (
          select 1 from team_member_clinics tmc
          where tmc.team_member_id = b.practitioner_id and tmc.clinic_id = p_clinic_id
        )
      )
    )
    and b.starts_at < p_to
    and b.ends_at > p_from;
$$;

create or replace function public.save_appointment_if_free(
  p_account_id uuid,
  p_appointment_id uuid,
  p_values jsonb,
  p_check_overlap boolean default true,
  p_check_room boolean default false,
  p_check_blocks boolean default false
)
returns uuid
language plpgsql
volatile
set search_path to 'public'
as $function$
declare
  v_allowed text[] := array[
    'patient_id', 'clinic_id', 'practitioner_id', 'practitioner_name', 'appointment_type_id', 'room_id',
    'starts_at', 'ends_at', 'status', 'note', 'external_reference', 'source', 'rescheduled'
  ];
  v_unknown text;
  v_existing appointments%rowtype;
  v_row appointments%rowtype;
  v_cols text;
  v_clash record;
  v_id uuid;
begin
  select k into v_unknown from jsonb_object_keys(p_values) k where k <> all (v_allowed) limit 1;
  if v_unknown is not null then
    raise exception 'save_appointment_if_free cannot set %', v_unknown;
  end if;

  -- The row as it will be once written: the values given over what is there
  -- now, or over nothing for a new one. Every check reads this, so a PATCH
  -- that moves only the practitioner is checked at the time the visit keeps.
  if p_appointment_id is not null then
    select * into v_existing from appointments
    where id = p_appointment_id and account_id = p_account_id and deleted_at is null;
    if not found then
      raise exception 'appointment_not_found';
    end if;
    v_row := jsonb_populate_record(v_existing, p_values);
  else
    v_row := jsonb_populate_record(null::appointments, p_values || jsonb_build_object('account_id', p_account_id));
  end if;

  if p_check_overlap or p_check_room or p_check_blocks then
    -- The key create_public_booking, create_patient_booking and
    -- reschedule_patient_appointment take (20260930141539), unassigned time
    -- queued per clinic as they queue it.
    perform pg_advisory_xact_lock(hashtext('appointment_slot'), hashtext(coalesce(v_row.practitioner_id, v_row.clinic_id)::text));
  end if;

  if p_check_overlap and v_row.practitioner_id is not null then
    select a.starts_at, a.ends_at into v_clash
    from appointments a
    where a.account_id = p_account_id
      and a.practitioner_id = v_row.practitioner_id
      -- A deleted appointment keeps status 'booked'; it holds no time.
      and a.deleted_at is null
      and a.status <> 'cancelled'
      -- Half-open: back-to-back visits do not clash.
      and a.starts_at < v_row.ends_at
      and a.ends_at > v_row.starts_at
      and (p_appointment_id is null or a.id <> p_appointment_id)
    order by a.starts_at
    limit 1;
    if found then
      raise exception 'appointment_overlap'
        using detail = jsonb_build_object('starts_at', v_clash.starts_at, 'ends_at', v_clash.ends_at)::text;
    end if;
  end if;

  if p_check_room and v_row.room_id is not null and exists (
    select 1 from appointments a
    where a.room_id = v_row.room_id
      and a.deleted_at is null
      and a.status <> 'cancelled'
      and a.starts_at < v_row.ends_at
      and a.ends_at > v_row.starts_at
      and (p_appointment_id is null or a.id <> p_appointment_id)
  ) then
    raise exception 'room_taken';
  end if;

  -- Blocks as the booking page reads them: one naming nobody, which closes
  -- this clinic for everyone, or one for this practitioner at ANY clinic of
  -- the account -- their own blocked time follows them.
  if p_check_blocks and exists (
    select 1 from availability_blocks b
    where (
        (b.clinic_id = v_row.clinic_id and b.practitioner_id is null)
        or (b.practitioner_id = v_row.practitioner_id and b.account_id = p_account_id)
      )
      and b.starts_at < v_row.ends_at
      and b.ends_at > v_row.starts_at
  ) then
    raise exception 'slot_blocked';
  end if;

  select string_agg(quote_ident(k), ', ') into v_cols from jsonb_object_keys(p_values) k;

  if p_appointment_id is null then
    execute format(
      'insert into public.appointments (%1$s) select %1$s from (select ($1).*) r returning id',
      'account_id' || coalesce(', ' || v_cols, '')
    ) using v_row into v_id;
    return v_id;
  end if;

  if v_cols is not null then
    execute format(
      'update public.appointments a set (%1$s) = (select %1$s from (select ($1).*) r) where a.id = $2 and a.account_id = $3',
      v_cols
    ) using v_row, p_appointment_id, p_account_id;
  end if;
  return p_appointment_id;
end;
$function$;


create or replace function public.team_member_leaving_stops_online_booking()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  -- Not only at the moment of leaving: for as long as they are gone. The
  -- switch stayed on a departed member's settings page and could be ticked
  -- again. Reactivating still does not turn it back on; that stays a
  -- decision for whoever reactivates them.
  if new.deleted_at is not null then
    new.online_booking_enabled := false;
  end if;
  return new;
end;
$function$;

drop trigger if exists team_member_leaving_stops_online_booking on public.team_members;
create trigger team_member_leaving_stops_online_booking
  before insert or update of deleted_at, online_booking_enabled on public.team_members
  for each row execute function public.team_member_leaving_stops_online_booking();

-- Anybody switched back on since.
update public.team_members
set online_booking_enabled = false
where deleted_at is not null and online_booking_enabled;

alter table public.team_members drop constraint if exists team_members_departed_not_bookable_online;
alter table public.team_members add constraint team_members_departed_not_bookable_online
  check (deleted_at is null or not online_booking_enabled);

-- create or replace keeps each function's grants; restated so this file says
-- who may call what.
revoke all on function public.assert_booking_slot_open(uuid, uuid, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.get_booking_blocked_times(uuid, timestamptz, timestamptz) from public;
grant execute on function public.get_booking_blocked_times(uuid, timestamptz, timestamptz) to anon, authenticated;
revoke all on function public.save_appointment_if_free(uuid, uuid, jsonb, boolean, boolean, boolean) from public, anon, authenticated;
grant execute on function public.save_appointment_if_free(uuid, uuid, jsonb, boolean, boolean, boolean) to service_role;
