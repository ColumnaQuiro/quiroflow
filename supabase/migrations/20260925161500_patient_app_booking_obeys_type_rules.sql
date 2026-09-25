-- The patient app books an appointment type under the same three rules the
-- public booking page (/book/<slug>, create_public_booking) already applies.
-- Until now create_patient_booking checked only that the type was bookable
-- online and not archived, so from the app:
--
-- 1. WHO MAY BOOK IT (appointment_types.online_bookable_by: 'all',
--    'new_patients', 'existing_patients'). The web page decides "new" by
--    whether a patients row with that email already exists in the account:
--
--      select id into v_patient_id from patients
--      where account_id = v_account_id and lower(email) = lower(trim(p_email)) ...
--      if v_bookable_by = 'new_patients' and v_patient_id is not null then
--        raise exception 'This appointment type is only available to new patients';
--
--    Somebody signed in to the app ALWAYS has that row: claim_patient_profile
--    only ever links an existing patients row by email and never creates one,
--    and create_patient_booking starts by reading it. By the web page's own
--    test every app user is an existing patient, so a 'new_patients' type
--    (typically the first visit, often at an introductory price) is refused
--    and not offered, and 'existing_patients' always passes. The same person
--    typing the same email into /book/<slug> gets the same answer.
--
-- 2. HOW FAR AHEAD (appointment_types.online_max_days_ahead, falling back to
--    accounts.online_booking_max_days_ahead). Same comparison as the web
--    page: the start time against now() + that many days. The app's calendar
--    never had an upper bound at all. There is no minimum-notice setting on
--    either side -- the web page refuses only a time in the past, and so does
--    this, as it already did.
--
-- 3. ONLINE PAYMENT (online_payment_required, online_deposit_cents). The web
--    page creates the appointment, raises an unpaid invoice for the deposit or
--    the full (practitioner's own) price, and sends the patient to a Stripe
--    payment step. The app has no payment step: its only money-handling is the
--    staff checkout in mobile/pages/calendar/[id].vue, which RECORDS a cash,
--    card or credit payment taken at the desk. So a type that would charge is
--    not bookable from the app at all, rather than booked unpaid -- booking it
--    unpaid is exactly the outcome the setting exists to prevent (a no-show on
--    a slot the clinic asked to be secured with money). The condition is the
--    web page's own, on the effective price:
--
--      if v_payment_required and v_effective_price > 0 then
--        v_charge_amount := coalesce(v_deposit_cents, v_effective_price);
--        ... if v_charge_amount > 0 then <invoice> ...
--
--    so a type whose deposit is 0, or which is free with the chosen
--    practitioner, still books from the app, because the web page would not
--    have charged for it either. The discount-code path is not mirrored: the
--    app has no code field, so a code that would bring the charge to zero is
--    only usable on the web page, where it is entered.
--
--    get_patient_booking_info leaves those types out of appointment_types --
--    which is what hides them from app versions already installed, since
--    those render that list as it comes -- and lists them separately under
--    online_payment_types so the current app can say why they are missing
--    and point at the web page, where they can be booked and paid. A type is
--    left out when it would charge with ANY practitioner (the type's price or
--    any practitioner's own price above zero): the app picks the type before
--    the practitioner, and offering a type that then fails at the last step
--    for most practitioners is worse than not offering it.
--
-- Both functions are copied from 20260925140512 (md5 of prosrc checked
-- against the database before editing); everything not named above is
-- unchanged.

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
      where c.account_id = v_account_id and c.online_booking_enabled = true
    ), '[]'::jsonb),
    'appointment_types', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', at.id, 'name', at.name, 'duration_minutes', at.duration_minutes,
        'color', at.color, 'default_price_cents', at.default_price_cents,
        'online_max_days_ahead', at.online_max_days_ahead
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

-- Whether booking this type online charges the patient with at least one
-- practitioner: create_public_booking's condition (payment required, an
-- effective price above zero, and a deposit that is not zero), taken over the
-- type's own price and every practitioner's own price for it. Used only to
-- decide what get_patient_booking_info offers; create_patient_booking applies
-- the exact condition for the practitioner actually chosen.
create or replace function public.patient_app_type_needs_payment(p_appointment_type_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from appointment_types at
    where at.id = p_appointment_type_id
      and at.online_payment_required
      and coalesce(at.online_deposit_cents, 1) > 0
      and (
        at.default_price_cents > 0
        or exists (
          select 1 from appointment_type_overrides o
          where o.appointment_type_id = at.id and o.price_cents > 0
        )
      )
  );
$$;

revoke execute on function public.patient_app_type_needs_payment(uuid) from public, anon, authenticated;

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
         online_bookable_by, online_max_days_ahead, online_deposit_cents
    into v_duration, v_type_price, v_payment_required,
         v_bookable_by, v_type_max_days_ahead, v_deposit_cents
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
