-- What a patient can see and do in the patient app, and what the clinic
-- lets them do.
--
-- Until now the patient side was half-built: patients could message the
-- clinic and book, but they could not see the files the clinic shared with
-- them, could not change a booking once made, and the booking button was
-- gated by the PUBLIC online-booking switch -- so a clinic that wanted a
-- bookable website necessarily also let every app patient book, and one
-- that wanted neither had to turn off the website to stop the app. Those
-- are two different decisions and they now have two different switches.

-- ---------------------------------------------------------------------
-- Clinic-level switches
-- ---------------------------------------------------------------------

-- Default false, deliberately. These grant patients the ability to change
-- the clinic's diary, so a clinic opts in rather than discovering after
-- the fact that yesterday's patients cancelled themselves overnight.
-- (online_booking_enabled, the public-website switch, defaults false for
-- the same reason.)
alter table accounts add column patient_app_booking_enabled boolean not null default false;
alter table accounts add column patient_app_cancel_enabled boolean not null default false;
alter table accounts add column patient_app_reschedule_enabled boolean not null default false;

-- How close to the appointment a patient may still change it themselves.
-- Inside this window the app shows "call the clinic" instead -- a no-show
-- the clinic could have refilled is the thing this protects, which is the
-- same concern cancellation_fee_cents already exists for.
alter table accounts add column patient_app_change_notice_hours integer not null default 24
  check (patient_app_change_notice_hours >= 0 and patient_app_change_notice_hours <= 336);

-- ---------------------------------------------------------------------
-- Patient push opt-out
-- ---------------------------------------------------------------------

-- Per-patient, not per-device: a patient who asks the clinic to stop
-- messaging them means it for that person, not for the handset they said
-- it on. Mirrors do_not_contact, which already gates WhatsApp and email
-- in appointmentNotifications.ts.
--
-- Opt-OUT rather than opt-in: these are messages from a healthcare
-- provider the patient has an existing relationship with, about their own
-- care. do_not_contact stays the harder switch and is checked first.
alter table patients add column app_push_opted_out boolean not null default false;

-- ---------------------------------------------------------------------
-- Patients can read their own 'custom' files
-- ---------------------------------------------------------------------

-- patient_files.visibility (0054) has carried 'generic' vs 'custom' since
-- before there was anything to read it -- 0054 added it precisely so "a
-- future patient-facing mobile app can decide what to show". This is that
-- decision, enforced in the database rather than in a front-end filter:
-- the default is 'generic', so a file is invisible to the patient unless
-- someone deliberately marked it otherwise. An X-ray the patient should
-- have and an internal note about a difficult conversation live in the
-- same table, and only this column separates them.
--
-- storage_path not null excludes the PracticeHub rows whose metadata was
-- imported but whose bytes never were -- a row there would render as a
-- file the patient can see listed and can never open.
create policy "patients view own custom patient_files" on patient_files
for select using (
  visibility = 'custom'
  and storage_path is not null
  and patient_id in (select p.id from patients p where p.user_id = auth.uid())
);

-- ---------------------------------------------------------------------
-- Booking gate moves off the public-website switch
-- ---------------------------------------------------------------------

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
  v_ends_at timestamptz;
  v_appointment_id uuid;
  v_room_id uuid;
begin
  select id, account_id into v_patient_id, v_account_id from patients where user_id = auth.uid();
  if v_patient_id is null then
    raise exception 'Not found';
  end if;

  -- The new gate. Everything below is unchanged from 0069.
  if not exists (select 1 from accounts where id = v_account_id and patient_app_booking_enabled = true) then
    raise exception 'Booking from the app is not enabled for this clinic';
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

-- ---------------------------------------------------------------------
-- Cancel / reschedule
-- ---------------------------------------------------------------------

-- Both are SECURITY DEFINER for the same reason create_patient_booking is:
-- a patient has SELECT on their own appointments and nothing more, and
-- giving them UPDATE would mean a policy broad enough to let them edit
-- fields (practitioner, price, status 'completed') that are not theirs to
-- set. Here the only reachable changes are the two below.

create or replace function cancel_patient_appointment(p_appointment_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_patient_id uuid;
  v_account_id uuid;
  v_starts_at timestamptz;
  v_status text;
  v_checked_in_at timestamptz;
  v_enabled boolean;
  v_notice_hours int;
begin
  select id, account_id into v_patient_id, v_account_id from patients where user_id = auth.uid();
  if v_patient_id is null then
    raise exception 'Not found';
  end if;

  select patient_app_cancel_enabled, patient_app_change_notice_hours
    into v_enabled, v_notice_hours
  from accounts where id = v_account_id;
  if not coalesce(v_enabled, false) then
    raise exception 'Cancelling from the app is not enabled for this clinic';
  end if;

  select starts_at, status, checked_in_at into v_starts_at, v_status, v_checked_in_at
  from appointments
  where id = p_appointment_id and patient_id = v_patient_id and deleted_at is null;
  if v_starts_at is null then
    raise exception 'Appointment not found';
  end if;
  if v_status = 'cancelled' then
    return jsonb_build_object('appointment_id', p_appointment_id, 'already_cancelled', true);
  end if;

  -- A visit that happened is a clinical record, not a plan -- cancelling it
  -- would erase what took place. status only ever holds booked/completed/
  -- cancelled/no_show (appointments_status_check), and a visit in progress
  -- is still 'booked' with checked_in_at set, so both are checked.
  if v_status in ('completed', 'no_show') or v_checked_in_at is not null then
    raise exception 'This appointment can no longer be changed';
  end if;

  if v_starts_at < now() + (v_notice_hours || ' hours')::interval then
    raise exception 'Too close to the appointment -- please contact the clinic';
  end if;

  update appointments
  set status = 'cancelled'
  where id = p_appointment_id;

  return jsonb_build_object('appointment_id', p_appointment_id, 'cancelled', true);
end;
$$;

revoke execute on function cancel_patient_appointment(uuid) from public;
grant execute on function cancel_patient_appointment(uuid) to authenticated;

-- Moves the existing row rather than cancelling and inserting a new one,
-- so the appointment keeps its identity: its visit notes, its
-- external_reference, and anything already attached to it stay attached.
create or replace function reschedule_patient_appointment(p_appointment_id uuid, p_starts_at timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_patient_id uuid;
  v_account_id uuid;
  v_enabled boolean;
  v_notice_hours int;
  v_starts_at timestamptz;
  v_ends_at timestamptz;
  v_status text;
  v_checked_in_at timestamptz;
  v_practitioner_id uuid;
  v_clinic_id uuid;
  v_duration interval;
  v_new_ends_at timestamptz;
  v_room_id uuid;
begin
  select id, account_id into v_patient_id, v_account_id from patients where user_id = auth.uid();
  if v_patient_id is null then
    raise exception 'Not found';
  end if;

  select patient_app_reschedule_enabled, patient_app_change_notice_hours
    into v_enabled, v_notice_hours
  from accounts where id = v_account_id;
  if not coalesce(v_enabled, false) then
    raise exception 'Rescheduling from the app is not enabled for this clinic';
  end if;

  select starts_at, ends_at, status, checked_in_at, practitioner_id, clinic_id
    into v_starts_at, v_ends_at, v_status, v_checked_in_at, v_practitioner_id, v_clinic_id
  from appointments
  where id = p_appointment_id and patient_id = v_patient_id and deleted_at is null;
  if v_starts_at is null then
    raise exception 'Appointment not found';
  end if;
  if v_status in ('completed', 'no_show', 'cancelled') or v_checked_in_at is not null then
    raise exception 'This appointment can no longer be changed';
  end if;

  -- The notice window applies to BOTH ends: a patient cannot move a visit
  -- that is hours away (the slot can no longer be refilled), and cannot
  -- move one INTO that window either, which would otherwise be a way to
  -- get the same effect in two steps.
  if v_starts_at < now() + (v_notice_hours || ' hours')::interval then
    raise exception 'Too close to the appointment -- please contact the clinic';
  end if;
  if p_starts_at < now() + (v_notice_hours || ' hours')::interval then
    raise exception 'Please choose a time further ahead, or contact the clinic';
  end if;

  v_duration := v_ends_at - v_starts_at;
  v_new_ends_at := p_starts_at + v_duration;

  if exists (
    select 1 from appointments
    where practitioner_id = v_practitioner_id
      and id <> p_appointment_id
      and status <> 'cancelled'
      and deleted_at is null
      and starts_at < v_new_ends_at
      and ends_at > p_starts_at
  ) then
    raise exception 'That time is no longer available';
  end if;

  -- The old room may be taken at the new time; re-pick rather than
  -- carrying a booking into an occupied room.
  select cr.id into v_room_id
  from calendar_resources cr
  where cr.clinic_id = v_clinic_id
    and not exists (
      select 1 from appointments a
      where a.room_id = cr.id
        and a.id <> p_appointment_id
        and a.status <> 'cancelled'
        and a.starts_at < v_new_ends_at
        and a.ends_at > p_starts_at
    )
  order by cr.name
  limit 1;

  -- rescheduled = true is what the staff calendar reads to show the row as
  -- moved. Unlike the bulk PracticeHub re-sync (which moves times silently
  -- on purpose), a patient moving their own appointment is exactly the
  -- case the flag exists to surface.
  update appointments
  set starts_at = p_starts_at,
      ends_at = v_new_ends_at,
      room_id = v_room_id,
      rescheduled = true
  where id = p_appointment_id;

  return jsonb_build_object('appointment_id', p_appointment_id, 'starts_at', p_starts_at, 'ends_at', v_new_ends_at);
end;
$$;

revoke execute on function reschedule_patient_appointment(uuid, timestamptz) from public;
grant execute on function reschedule_patient_appointment(uuid, timestamptz) to authenticated;

-- ---------------------------------------------------------------------
-- Broadcast log
-- ---------------------------------------------------------------------

-- A record of what the clinic pushed to its patients, and to how many.
-- A broadcast reaches every patient's lock screen at once and cannot be
-- recalled, so "who sent that, when, and what did it say" needs an answer
-- that does not depend on someone remembering.
create table patient_push_broadcasts (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  sent_by uuid references team_members(id) on delete set null,
  title text not null,
  body text not null,
  -- null = everyone; otherwise the patients actually targeted.
  patient_ids uuid[],
  recipients_count integer not null default 0,
  delivered_count integer not null default 0,
  created_at timestamptz not null default now()
);

create index patient_push_broadcasts_account_idx on patient_push_broadcasts (account_id, created_at desc);

alter table patient_push_broadcasts enable row level security;

-- Sending is done by the server route with the service role after checking
-- the permission, so there is no insert policy here -- only reading the
-- log back. communication_config is the same permission that gates the
-- Inbox and the WhatsApp settings.
create policy "staff read patient_push_broadcasts" on patient_push_broadcasts
for select using (
  account_id in (select public.my_member_account_ids())
  and account_id in (select public.my_permitted_accounts('communication_config'))
);

-- ---------------------------------------------------------------------
-- The app needs to know which of the switches above are on
-- ---------------------------------------------------------------------

-- Patients have no RLS read on accounts (correctly -- it holds the clinic's
-- Stripe keys and WhatsApp tokens), so the app cannot read these flags
-- directly. get_patient_booking_info() is already the patient-side view of
-- "what may I do here", so the switches go there rather than in a second
-- RPC that would have to repeat its patient lookup.
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
    'settings', (
      select jsonb_build_object(
        'booking_enabled', a.patient_app_booking_enabled,
        'cancel_enabled', a.patient_app_cancel_enabled,
        'reschedule_enabled', a.patient_app_reschedule_enabled,
        'change_notice_hours', a.patient_app_change_notice_hours,
        'clinic_name', a.name
      )
      from accounts a where a.id = v_account_id
    ),
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
  );
end;
$$;

revoke execute on function get_patient_booking_info() from public;
grant execute on function get_patient_booking_info() to authenticated;
