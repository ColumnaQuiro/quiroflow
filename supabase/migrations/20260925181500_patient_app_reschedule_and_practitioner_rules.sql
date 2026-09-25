-- The patient app, second pass against the public booking page (/book/<slug>,
-- get_public_booking_info + create_public_booking). 20260925161500 made the
-- app obey a type's who-may-book, horizon and payment rules when BOOKING.
-- Three things were still different:
--
-- 1. RESCHEDULING had no horizon. reschedule_patient_appointment (0162)
--    checked the clinic's change-notice window at both ends and nothing
--    else, so an appointment the clinic only lets patients book 7 days out
--    could be moved to next year from the app. It now applies the same
--    comparison create_patient_booking applies -- the new start against
--    now() + the appointment type's online_max_days_ahead, else the clinic's
--    online_booking_max_days_ahead -- taken from the type the appointment
--    already has.
--
--    The other booking rules were considered and deliberately NOT applied to
--    a move. The web page has no reschedule path at all (the patient portal
--    sends a patient to the app or the phone to move a visit), so there is
--    nothing there to mirror; the question is which rules are about CHOOSING
--    a time and which are about CREATING a booking:
--      - past time: already covered -- the new start must be at least the
--        notice window from now, which is never earlier than now.
--      - who may book (new / existing patients): about who may create the
--        booking. It exists; moving it does not change who it is for.
--      - online payment: moving creates no charge, and whatever invoice the
--        booking raised stays on it.
--      - type/clinic/practitioner offered online, archived type, "patient
--        does not choose a practitioner": the appointment keeps its type,
--        clinic and practitioner (the function has never changed them), and
--        staff may have booked it with ones that are not offered online.
--        Refusing to move those would be a new restriction on
--        patient_app_reschedule_enabled, not a rule the web page applies.
--
-- 2. WHO IS OFFERED AS A PRACTITIONER. get_patient_booking_info listed every
--    team member with online_booking_enabled -- which defaults to TRUE for
--    every team member, so receptionists and managers who never see a
--    patient were offered, and create_patient_booking would book them.
--    get_public_booking_info and create_public_booking have required
--    is_practitioner as well. Both app functions now do, plus
--    deleted_at is null: deactivating someone switches their online booking
--    off (/api/team-members/[id]/deactivate), but closing your own login
--    (/api/account/delete) only sets deleted_at, so the flag alone does not
--    keep a departed colleague off the list. The list also comes in the web
--    page's order (the clinic's online_booking_practitioner_order:
--    alphabetical, else the order they were added) rather than always
--    alphabetical, because 3 depends on which one is first.
--
--    Clinics: the web page leaves out an archived clinic; the app list now
--    does too.
--
-- 3. "PATIENT DOESN'T CHOOSE A PRACTITIONER" (appointment_types.
--    online_bypass_practitioner). The web page shows no practitioner choice
--    for such a type and books it with the first practitioner, in that
--    order, who works at the chosen clinic:
--
--      if (bypassPractitioner.value) teamMemberId.value = availablePractitioners.value[0]?.id ?? ''
--
--    get_patient_booking_info now sends the flag so the app can do the same,
--    and create_patient_booking refuses any other practitioner for such a
--    type -- naming the one it would take, so somebody on an app version
--    that still shows the picker can choose them and book. Refused rather
--    than silently swapped: an older app's confirm screen has already said
--    "with <whoever they picked>", and booking someone else under that would
--    be a surprise at the door. The pick lives in
--    patient_app_assigned_practitioner so the list and the check cannot
--    disagree about who is first.
--
-- Discount codes are not added to the app. In create_public_booking a code
-- is read only inside `if v_payment_required and v_effective_price > 0`, and
-- all it changes is v_charge_amount, the amount of the unpaid invoice the
-- Stripe step then collects. It is not stored on the appointment and changes
-- no price recorded anywhere else, and the app refuses every booking that
-- would reach that branch with a charge (20260925161500). A code has nothing
-- to act on in a booking the app can make.
--
-- get_patient_booking_info and create_patient_booking are copied from
-- 20260925161500, reschedule_patient_appointment from 0162 (md5 of prosrc
-- checked against the database before editing); everything not named above
-- is unchanged.

-- The practitioner a "patient doesn't choose" type is booked with at this
-- clinic: the first one get_patient_booking_info lists for it.
create or replace function public.patient_app_assigned_practitioner(p_account_id uuid, p_clinic_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select tm.id
  from team_members tm
  join team_member_clinics tmc on tmc.team_member_id = tm.id and tmc.clinic_id = p_clinic_id
  where tm.account_id = p_account_id
    and tm.online_booking_enabled = true and tm.is_practitioner = true and tm.deleted_at is null
  order by
    case when (select online_booking_practitioner_order from accounts where id = p_account_id) = 'alphabetical'
      then tm.full_name end,
    tm.created_at, tm.id
  limit 1;
$$;

revoke execute on function public.patient_app_assigned_practitioner(uuid, uuid) from public, anon, authenticated;

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
        'clinic_name', a.name,
        -- The clinic's default booking horizon, for a type that sets none.
        'max_days_ahead', a.online_booking_max_days_ahead,
        -- For the link to /book/<slug>, where a type needing payment can be
        -- booked and paid.
        'booking_slug', a.slug
      )
      from accounts a where a.id = v_account_id
    ),
    'clinics', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'name', c.name, 'address', c.address, 'business_hours', c.business_hours
      ) order by c.name)
      from clinics c
      where c.account_id = v_account_id and c.online_booking_enabled = true and c.archived_at is null
    ), '[]'::jsonb),
    'appointment_types', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', at.id, 'name', at.name, 'duration_minutes', at.duration_minutes,
        'color', at.color, 'default_price_cents', at.default_price_cents,
        'online_max_days_ahead', at.online_max_days_ahead,
        -- The patient does not choose: booked with the first practitioner
        -- below who works at the chosen clinic.
        'online_bypass_practitioner', at.online_bypass_practitioner
      ) order by at.sort_order nulls last, at.name)
      from appointment_types at
      where at.account_id = v_account_id and at.online_booking_enabled = true and at.archived_at is null
        -- An app user always has a patient record: never a new patient.
        and at.online_bookable_by <> 'new_patients'
        and not public.patient_app_type_needs_payment(at.id)
    ), '[]'::jsonb),
    'online_payment_types', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', at.id, 'name', at.name,
        'default_price_cents', at.default_price_cents,
        'online_deposit_cents', at.online_deposit_cents
      ) order by at.sort_order nulls last, at.name)
      from appointment_types at
      where at.account_id = v_account_id and at.online_booking_enabled = true and at.archived_at is null
        and at.online_bookable_by <> 'new_patients'
        and public.patient_app_type_needs_payment(at.id)
    ), '[]'::jsonb),
    'team_members', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', tm.id, 'full_name', tm.full_name, 'color', tm.color,
        'clinic_ids', (
          select coalesce(jsonb_agg(tmc.clinic_id), '[]'::jsonb)
          from team_member_clinics tmc where tmc.team_member_id = tm.id
        )
      ) order by
        -- The web page's order, and patient_app_assigned_practitioner's.
        case when (select online_booking_practitioner_order from accounts where id = v_account_id) = 'alphabetical'
          then tm.full_name end,
        tm.created_at, tm.id)
      from team_members tm
      where tm.account_id = v_account_id and tm.online_booking_enabled = true
        and tm.is_practitioner = true and tm.deleted_at is null
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
  v_type_price int;
  v_override_price int;
  v_effective_price int;
  v_payment_required boolean;
  v_bookable_by text;
  v_max_days_ahead int;
  v_type_max_days_ahead int;
  v_deposit_cents int;
  v_bypass_practitioner boolean;
  v_assigned_practitioner uuid;
  v_ends_at timestamptz;
  v_appointment_id uuid;
  v_room_id uuid;
begin
  select id, account_id into v_patient_id, v_account_id from patients where user_id = auth.uid();
  if v_patient_id is null then
    raise exception 'Not found';
  end if;

  -- The gate 0162 added.
  if not exists (select 1 from accounts where id = v_account_id and patient_app_booking_enabled = true) then
    raise exception 'Booking from the app is not enabled for this clinic';
  end if;

  select online_booking_max_days_ahead into v_max_days_ahead from accounts where id = v_account_id;

  if not exists (
    select 1 from clinics
    where id = p_clinic_id and account_id = v_account_id and online_booking_enabled = true
  ) then
    raise exception 'Clinic not available for online booking';
  end if;

  select duration_minutes, default_price_cents, online_payment_required,
         online_bookable_by, online_max_days_ahead, online_deposit_cents,
         online_bypass_practitioner
    into v_duration, v_type_price, v_payment_required,
         v_bookable_by, v_type_max_days_ahead, v_deposit_cents,
         v_bypass_practitioner
  from appointment_types
  where id = p_appointment_type_id and account_id = v_account_id and online_booking_enabled = true
    and archived_at is null;
  if v_duration is null then
    raise exception 'Appointment type not available';
  end if;

  -- Who may book it, as create_public_booking decides it: a patient record
  -- already exists (it is the one this booking is for), so this is never a
  -- new patient, and 'existing_patients' always passes.
  if v_bookable_by = 'new_patients' then
    raise exception 'This appointment type is only available to new patients';
  end if;

  -- How far ahead, as create_public_booking checks it.
  if v_type_max_days_ahead is not null then
    v_max_days_ahead := v_type_max_days_ahead;
  end if;
  if p_starts_at > now() + (v_max_days_ahead || ' days')::interval then
    raise exception 'That date is too far in advance to book online';
  end if;

  -- The practitioner's own length and price for this type, as
  -- create_public_booking has applied them since 0072.
  select duration_minutes, price_cents into v_override_duration, v_override_price
  from appointment_type_overrides
  where appointment_type_id = p_appointment_type_id and team_member_id = p_team_member_id;
  if v_override_duration is not null then
    v_duration := v_override_duration;
  end if;
  v_effective_price := coalesce(v_override_price, v_type_price);

  -- The web page would charge for this booking; the app cannot take the
  -- payment, so it does not book it unpaid.
  if v_payment_required and v_effective_price > 0 and coalesce(v_deposit_cents, v_effective_price) > 0 then
    raise exception 'This appointment type has to be paid online when booking, which the app cannot do yet. Book it on the clinic''s booking page or contact the clinic.';
  end if;

  -- Somebody who sees patients, as create_public_booking requires, and who
  -- is still with the clinic.
  if not exists (
    select 1 from team_members tm
    join team_member_clinics tmc on tmc.team_member_id = tm.id
    where tm.id = p_team_member_id and tm.account_id = v_account_id
      and tm.online_booking_enabled = true and tm.is_practitioner = true and tm.deleted_at is null
      and tmc.clinic_id = p_clinic_id
  ) then
    raise exception 'Practitioner not available';
  end if;

  -- "Patient doesn't choose a practitioner": the one the web page would
  -- book, and nobody else. Named, so an app that still shows a picker can
  -- be answered by choosing them.
  if v_bypass_practitioner then
    v_assigned_practitioner := public.patient_app_assigned_practitioner(v_account_id, p_clinic_id);
    if p_team_member_id is distinct from v_assigned_practitioner then
      raise exception 'For this appointment type the clinic assigns the practitioner: please choose %',
        (select full_name from team_members where id = v_assigned_practitioner);
    end if;
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
  v_max_days_ahead int;
  v_type_max_days_ahead int;
  v_starts_at timestamptz;
  v_ends_at timestamptz;
  v_status text;
  v_checked_in_at timestamptz;
  v_practitioner_id uuid;
  v_clinic_id uuid;
  v_appointment_type_id uuid;
  v_duration interval;
  v_new_ends_at timestamptz;
  v_room_id uuid;
begin
  select id, account_id into v_patient_id, v_account_id from patients where user_id = auth.uid();
  if v_patient_id is null then
    raise exception 'Not found';
  end if;

  select patient_app_reschedule_enabled, patient_app_change_notice_hours, online_booking_max_days_ahead
    into v_enabled, v_notice_hours, v_max_days_ahead
  from accounts where id = v_account_id;
  if not coalesce(v_enabled, false) then
    raise exception 'Rescheduling from the app is not enabled for this clinic';
  end if;

  select starts_at, ends_at, status, checked_in_at, practitioner_id, clinic_id, appointment_type_id
    into v_starts_at, v_ends_at, v_status, v_checked_in_at, v_practitioner_id, v_clinic_id, v_appointment_type_id
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

  -- How far ahead, as create_patient_booking checks it: the appointment's
  -- own type's horizon, else the clinic's.
  select online_max_days_ahead into v_type_max_days_ahead
  from appointment_types where id = v_appointment_type_id;
  if v_type_max_days_ahead is not null then
    v_max_days_ahead := v_type_max_days_ahead;
  end if;
  if p_starts_at > now() + (v_max_days_ahead || ' days')::interval then
    raise exception 'That date is too far in advance to book online';
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
