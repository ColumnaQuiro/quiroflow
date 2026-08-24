-- Per-practitioner overrides for an appointment type's duration/price --
-- e.g. a more experienced practitioner needs less time for the same visit
-- type than a newer one, or charges differently for it. Most (type,
-- practitioner) pairs will have no row at all here -- absence means "use
-- the type's own duration_minutes/default_price_cents", which is why both
-- override columns are nullable independently.

create table appointment_type_overrides (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  appointment_type_id uuid not null references appointment_types(id) on delete cascade,
  team_member_id uuid not null references team_members(id) on delete cascade,
  duration_minutes int,
  price_cents int,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (appointment_type_id, team_member_id)
);

create index appointment_type_overrides_account_idx on appointment_type_overrides (account_id);

alter table appointment_type_overrides enable row level security;
create policy "staff manage appointment_type_overrides" on appointment_type_overrides
  for all using (is_account_member(account_id) and has_permission(account_id, 'clinic_config'))
  with check (is_account_member(account_id) and has_permission(account_id, 'clinic_config'));

-- ---------------------------------------------------------------------
-- Public/patient booking info RPCs: include the overrides so the client
-- can compute an effective duration/price for the practitioner it picked
-- without extra round-trips.
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
    ), '[]'::jsonb),
    'overrides', coalesce((
      select jsonb_agg(jsonb_build_object(
        'appointment_type_id', o.appointment_type_id, 'team_member_id', o.team_member_id,
        'duration_minutes', o.duration_minutes, 'price_cents', o.price_cents
      ))
      from appointment_type_overrides o
      where o.account_id = v_account_id
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

revoke execute on function get_public_booking_info(text) from public;
grant execute on function get_public_booking_info(text) to anon, authenticated;

create or replace function get_patient_booking_info()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
begin
  select account_id into v_account_id from patients where user_id = auth.uid();
  if v_account_id is null then
    raise exception 'Not found';
  end if;

  return jsonb_build_object(
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
    ), '[]'::jsonb),
    'overrides', coalesce((
      select jsonb_agg(jsonb_build_object(
        'appointment_type_id', o.appointment_type_id, 'team_member_id', o.team_member_id,
        'duration_minutes', o.duration_minutes, 'price_cents', o.price_cents
      ))
      from appointment_type_overrides o
      where o.account_id = v_account_id
    ), '[]'::jsonb)
  );
end;
$$;

revoke execute on function get_patient_booking_info() from public;
grant execute on function get_patient_booking_info() to authenticated;

-- ---------------------------------------------------------------------
-- Booking-write RPCs: the duration that actually determines v_ends_at and
-- the conflict check must respect a practitioner override server-side,
-- regardless of what the client showed.
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
  v_override_duration int;
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

  select duration_minutes into v_override_duration
  from appointment_type_overrides
  where appointment_type_id = p_appointment_type_id and team_member_id = p_team_member_id;
  if v_override_duration is not null then
    v_duration := v_override_duration;
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

create or replace function create_patient_booking(
  p_clinic_id uuid,
  p_team_member_id uuid,
  p_appointment_type_id uuid,
  p_starts_at timestamptz,
  p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_patient_id uuid;
  v_duration int;
  v_override_duration int;
  v_ends_at timestamptz;
  v_appointment_id uuid;
  v_room_id uuid;
begin
  select id, account_id into v_patient_id, v_account_id from patients where user_id = auth.uid();
  if v_patient_id is null then
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

  select duration_minutes into v_override_duration
  from appointment_type_overrides
  where appointment_type_id = p_appointment_type_id and team_member_id = p_team_member_id;
  if v_override_duration is not null then
    v_duration := v_override_duration;
  end if;

  if not exists (
    select 1 from team_members tm
    join team_member_clinics tmc on tmc.team_member_id = tm.id
    where tm.id = p_team_member_id and tm.account_id = v_account_id
      and tm.online_booking_enabled = true and tmc.clinic_id = p_clinic_id
  ) then
    raise exception 'Practitioner not available';
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

  select cr.id into v_room_id
  from calendar_resources cr
  where cr.clinic_id = p_clinic_id
    and not exists (
      select 1 from appointments a
      where a.room_id = cr.id
        and a.status <> 'cancelled'
        and a.starts_at < v_ends_at
        and a.ends_at > p_starts_at
    )
  order by cr.name
  limit 1;

  insert into appointments (
    account_id, clinic_id, room_id, practitioner_id, patient_id, appointment_type_id,
    starts_at, ends_at, status, source
  )
  values (
    v_account_id, p_clinic_id, v_room_id, p_team_member_id, v_patient_id, p_appointment_type_id,
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

revoke execute on function create_patient_booking(uuid, uuid, uuid, timestamptz, text) from public;
grant execute on function create_patient_booking(uuid, uuid, uuid, timestamptz, text) to authenticated;
