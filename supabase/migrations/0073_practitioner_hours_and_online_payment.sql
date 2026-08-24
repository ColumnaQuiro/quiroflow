-- Per-practitioner working hours (opt-in override of the clinic's own
-- business_hours -- null/empty means "no restriction", same convention as
-- clinics.business_hours) and online-payment-at-booking for the public
-- booking widget.

alter table team_members add column business_hours jsonb;
alter table appointment_types add column online_payment_required boolean not null default false;

alter table payments add column stripe_payment_intent_id text;
-- Partial (not full) unique index -- most rows are staff-recorded manual
-- payments with no PaymentIntent id at all; only online payments need the
-- uniqueness guarantee, since Stripe redelivers webhook events and this is
-- what makes a redelivered payment_intent.succeeded a safe no-op.
create unique index payments_stripe_payment_intent_id_idx on payments (stripe_payment_intent_id) where stripe_payment_intent_id is not null;

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
        'color', at.color, 'default_price_cents', at.default_price_cents,
        'online_payment_required', at.online_payment_required
      ) order by at.name)
      from appointment_types at
      where at.account_id = v_account_id and at.online_booking_enabled = true
    ), '[]'::jsonb),
    'team_members', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', tm.id, 'full_name', tm.full_name, 'color', tm.color, 'business_hours', tm.business_hours,
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

revoke all on function get_public_booking_info(text) from public;
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
        'color', at.color, 'default_price_cents', at.default_price_cents,
        'online_payment_required', at.online_payment_required
      ) order by at.name)
      from appointment_types at
      where at.account_id = v_account_id and at.online_booking_enabled = true
    ), '[]'::jsonb),
    'team_members', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', tm.id, 'full_name', tm.full_name, 'color', tm.color, 'business_hours', tm.business_hours,
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

revoke all on function get_patient_booking_info() from public;
grant execute on function get_patient_booking_info() to authenticated;

-- Adds: effective-price computation (mirrors the existing effective-duration
-- override lookup just above it) and, when the appointment type requires
-- online payment, creates a pending invoice + line item in the same
-- transaction as the appointment -- booking always succeeds first; payment
-- is a separate step the client drives afterward against the returned
-- invoice_id, so a dropped connection after a successful charge can never
-- leave a paid customer with no trace of a booking.
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
  v_type_price int;
  v_override_price int;
  v_effective_price int;
  v_payment_required boolean;
  v_ends_at timestamptz;
  v_patient_id uuid;
  v_appointment_id uuid;
  v_invoice_id uuid;
  v_invoice_number text;
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

  select duration_minutes, default_price_cents, online_payment_required
    into v_duration, v_type_price, v_payment_required
  from appointment_types
  where id = p_appointment_type_id and account_id = v_account_id and online_booking_enabled = true;
  if v_duration is null then
    raise exception 'Appointment type not available';
  end if;

  select duration_minutes, price_cents into v_override_duration, v_override_price
  from appointment_type_overrides
  where appointment_type_id = p_appointment_type_id and team_member_id = p_team_member_id;
  if v_override_duration is not null then
    v_duration := v_override_duration;
  end if;
  v_effective_price := coalesce(v_override_price, v_type_price);

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
    insert into patients (account_id, clinic_id, first_name, last_name, email)
    values (
      v_account_id, p_clinic_id, trim(p_first_name),
      nullif(trim(coalesce(p_last_name, '')), ''),
      lower(trim(p_email))
    )
    returning id into v_patient_id;
  end if;

  -- patients has no phone column (0007_extend_patients_profile_fields.sql) --
  -- numbers live in patient_contact_numbers, same as everywhere else in the
  -- app. This function's phone handling had already been fixed once
  -- (0013_fix_public_booking_phone.sql) but the 0072 create-or-replace that
  -- added appointment_type_overrides support silently reverted it back to
  -- inserting into the dropped patients.phone column, breaking every public
  -- booking. Restoring the 0013 fix here alongside the rest of this
  -- function's changes.
  if p_phone is not null and trim(p_phone) <> '' and not exists (
    select 1 from patient_contact_numbers where patient_id = v_patient_id and number = trim(p_phone)
  ) then
    insert into patient_contact_numbers (account_id, patient_id, number)
    values (v_account_id, v_patient_id, trim(p_phone));
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

  if v_payment_required and v_effective_price > 0 then
    select 'INV-' || lpad((count(*) + 1)::text, 4, '0') into v_invoice_number from invoices;

    insert into invoices (account_id, patient_id, appointment_id, invoice_number, status, total_cents)
    values (v_account_id, v_patient_id, v_appointment_id, v_invoice_number, 'unpaid', v_effective_price)
    returning id into v_invoice_id;

    insert into invoice_line_items (account_id, invoice_id, description, quantity, price_cents)
    select v_account_id, v_invoice_id, at.name, 1, v_effective_price
    from appointment_types at where at.id = p_appointment_type_id;
  end if;

  return jsonb_build_object(
    'appointment_id', v_appointment_id,
    'starts_at', p_starts_at,
    'ends_at', v_ends_at,
    'invoice_id', v_invoice_id,
    'payment_required_cents', case when v_invoice_id is not null then v_effective_price else 0 end
  );
end;
$$;

revoke all on function create_public_booking(text, uuid, uuid, uuid, timestamptz, text, text, text, text, text) from public;
grant execute on function create_public_booking(text, uuid, uuid, uuid, timestamptz, text, text, text, text, text) to anon, authenticated;
