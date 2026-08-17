-- Public online booking widget (standalone page + iframe embed), mirroring
-- PracticeHub's "Book an appointment" flow. Public visitors are never
-- authenticated, so every read/write for this flow goes through security
-- definer RPCs (same pattern as create_account_with_owner /
-- claim_patient_profile) rather than direct table access + RLS.

alter table clinics add column online_booking_enabled boolean not null default false;
alter table clinics add column business_hours jsonb not null default
  '{"mon":[],"tue":[],"wed":[],"thu":[],"fri":[],"sat":[],"sun":[]}'::jsonb;

alter table team_members add column online_booking_enabled boolean not null default true;
alter table appointment_types add column online_booking_enabled boolean not null default true;

-- Distinguishes appointments a patient booked themselves online from ones
-- staff created, mostly for display (e.g. an "Online" badge on Calendar).
alter table appointments add column source text not null default 'staff'
  check (source in ('staff', 'online'));

-- ---------------------------------------------------------------------
-- Public read: clinic / appointment type / practitioner options for the
-- booking widget. Only ever returns rows explicitly opted in to online
-- booking -- an account with the feature untouched exposes nothing.
-- ---------------------------------------------------------------------

create or replace function get_public_booking_info(p_slug text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_account_name text;
  v_result jsonb;
begin
  select id, name into v_account_id, v_account_name from accounts where slug = p_slug;
  if v_account_id is null then
    raise exception 'Not found';
  end if;

  select jsonb_build_object(
    'account', jsonb_build_object('id', v_account_id, 'name', v_account_name),
    'clinics', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'name', c.name, 'address', c.address, 'business_hours', c.business_hours
      ) order by c.name)
      from clinics c
      where c.account_id = v_account_id and c.online_booking_enabled = true
    ), '[]'::jsonb),
    'appointment_types', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', at.id, 'name', at.name, 'duration_minutes', at.duration_minutes,
        'color', at.color, 'default_price_cents', at.default_price_cents
      ) order by at.name)
      from appointment_types at
      where at.account_id = v_account_id and at.online_booking_enabled = true
    ), '[]'::jsonb),
    'team_members', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', tm.id, 'full_name', tm.full_name, 'color', tm.color,
        'clinic_ids', (
          select coalesce(jsonb_agg(tmc.clinic_id), '[]'::jsonb)
          from team_member_clinics tmc where tmc.team_member_id = tm.id
        )
      ) order by tm.full_name)
      from team_members tm
      where tm.account_id = v_account_id and tm.online_booking_enabled = true
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

revoke execute on function get_public_booking_info(text) from public;
grant execute on function get_public_booking_info(text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- Public read: busy time ranges for a practitioner, so the widget can
-- compute free slots client-side from clinic.business_hours minus these.
-- Only start/end times -- never patient identity -- and only for clinics
-- that opted in, so this can't be used to snoop on a private schedule.
-- ---------------------------------------------------------------------

create or replace function get_booking_busy_times(
  p_clinic_id uuid,
  p_team_member_id uuid,
  p_from timestamptz,
  p_to timestamptz
)
returns table (starts_at timestamptz, ends_at timestamptz)
language sql
security definer
set search_path = public
as $$
  select a.starts_at, a.ends_at
  from appointments a
  join clinics c on c.id = a.clinic_id and c.online_booking_enabled = true
  where a.clinic_id = p_clinic_id
    and a.practitioner_id = p_team_member_id
    and a.status <> 'cancelled'
    and a.starts_at < p_to
    and a.ends_at > p_from;
$$;

revoke execute on function get_booking_busy_times(uuid, uuid, timestamptz, timestamptz) from public;
grant execute on function get_booking_busy_times(uuid, uuid, timestamptz, timestamptz) to anon, authenticated;

-- ---------------------------------------------------------------------
-- Public write: create the booking. Re-validates everything server-side
-- (never trust the widget's own filtering) and re-checks for a clashing
-- appointment right before insert to close the race between two visitors
-- grabbing the same slot.
-- ---------------------------------------------------------------------

create or replace function create_public_booking(
  p_account_slug text,
  p_clinic_id uuid,
  p_team_member_id uuid,
  p_appointment_type_id uuid,
  p_starts_at timestamptz,
  p_first_name text,
  p_last_name text,
  p_email text,
  p_phone text,
  p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_duration int;
  v_ends_at timestamptz;
  v_patient_id uuid;
  v_appointment_id uuid;
begin
  select id into v_account_id from accounts where slug = p_account_slug;
  if v_account_id is null then
    raise exception 'Not found';
  end if;

  if not exists (
    select 1 from clinics
    where id = p_clinic_id and account_id = v_account_id and online_booking_enabled = true
  ) then
    raise exception 'Clinic not available for online booking';
  end if;

  select duration_minutes into v_duration
  from appointment_types
  where id = p_appointment_type_id and account_id = v_account_id and online_booking_enabled = true;
  if v_duration is null then
    raise exception 'Appointment type not available';
  end if;

  if not exists (
    select 1 from team_members tm
    join team_member_clinics tmc on tmc.team_member_id = tm.id
    where tm.id = p_team_member_id and tm.account_id = v_account_id
      and tm.online_booking_enabled = true and tmc.clinic_id = p_clinic_id
  ) then
    raise exception 'Practitioner not available';
  end if;

  if p_first_name is null or trim(p_first_name) = '' then
    raise exception 'First name required';
  end if;
  if p_email is null or trim(p_email) = '' then
    raise exception 'Email required';
  end if;
  if p_starts_at < now() then
    raise exception 'Cannot book a time in the past';
  end if;

  v_ends_at := p_starts_at + (v_duration || ' minutes')::interval;

  if exists (
    select 1 from appointments
    where practitioner_id = p_team_member_id
      and status <> 'cancelled'
      and starts_at < v_ends_at
      and ends_at > p_starts_at
  ) then
    raise exception 'That time is no longer available';
  end if;

  select id into v_patient_id from patients
  where account_id = v_account_id and lower(email) = lower(trim(p_email))
  limit 1;

  if v_patient_id is null then
    insert into patients (account_id, clinic_id, first_name, last_name, email, phone)
    values (
      v_account_id, p_clinic_id, trim(p_first_name),
      nullif(trim(coalesce(p_last_name, '')), ''),
      lower(trim(p_email)), nullif(trim(coalesce(p_phone, '')), '')
    )
    returning id into v_patient_id;
  end if;

  insert into appointments (
    account_id, clinic_id, practitioner_id, patient_id, appointment_type_id,
    starts_at, ends_at, status, source
  )
  values (
    v_account_id, p_clinic_id, p_team_member_id, v_patient_id, p_appointment_type_id,
    p_starts_at, v_ends_at, 'booked', 'online'
  )
  returning id into v_appointment_id;

  if p_note is not null and trim(p_note) <> '' then
    insert into visit_notes (account_id, appointment_id, body, created_by)
    values (v_account_id, v_appointment_id, trim(p_note), null);
  end if;

  return jsonb_build_object('appointment_id', v_appointment_id, 'starts_at', p_starts_at, 'ends_at', v_ends_at);
end;
$$;

revoke execute on function create_public_booking(
  text, uuid, uuid, uuid, timestamptz, text, text, text, text, text
) from public;
grant execute on function create_public_booking(
  text, uuid, uuid, uuid, timestamptz, text, text, text, text, text
) to anon, authenticated;
