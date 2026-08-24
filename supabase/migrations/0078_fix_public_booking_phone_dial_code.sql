-- create_public_booking stored the phone as a single "+34 612345678" string
-- (the client already concatenates dial code + number before sending) with
-- country_code left at its default 'ES', while every display site
-- (DetailSidebar.vue, ContactNumbersEditor.vue) prepends
-- countryByCode(country_code).dial + number itself -- producing "+34 +34
-- 612345678". Every other entry point in the app already stores
-- country_code and the bare number separately; this brings the public
-- booking RPC in line and backfills the rows it already broke.

-- Backfill: only rows where country_code is still the default 'ES' AND
-- number itself starts with a dial code can only have come from this exact
-- bug (every other insert path already splits country_code/number
-- correctly, so it would never produce a '+'-prefixed number).
update patient_contact_numbers
set country_code = 'PT', number = trim(substring(number from 5))
where country_code = 'ES' and number like '+351 %';

update patient_contact_numbers
set country_code = 'FR', number = trim(substring(number from 4))
where country_code = 'ES' and number like '+33 %';

update patient_contact_numbers
set country_code = 'GB', number = trim(substring(number from 4))
where country_code = 'ES' and number like '+44 %';

update patient_contact_numbers
set country_code = 'US', number = trim(substring(number from 3))
where country_code = 'ES' and number like '+1 %';

update patient_contact_numbers
set country_code = 'DE', number = trim(substring(number from 4))
where country_code = 'ES' and number like '+49 %';

update patient_contact_numbers
set country_code = 'IT', number = trim(substring(number from 4))
where country_code = 'ES' and number like '+39 %';

-- Spain last since '+34 ' would also (harmlessly) match nothing above, but
-- do it last regardless to keep the ordering obviously safe.
update patient_contact_numbers
set number = trim(substring(number from 4))
where country_code = 'ES' and number like '+34 %';

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
  p_note text,
  p_country_code text default 'ES'
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

  -- number stored bare (no dial prefix) with its own country_code, matching
  -- every other entry point in the app (ContactNumbersEditor.vue etc).
  if p_phone is not null and trim(p_phone) <> '' and not exists (
    select 1 from patient_contact_numbers where patient_id = v_patient_id and number = trim(p_phone)
  ) then
    insert into patient_contact_numbers (account_id, patient_id, number, country_code)
    values (v_account_id, v_patient_id, trim(p_phone), coalesce(p_country_code, 'ES'));
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

revoke all on function create_public_booking(text, uuid, uuid, uuid, timestamptz, text, text, text, text, text, text) from public;
grant execute on function create_public_booking(text, uuid, uuid, uuid, timestamptz, text, text, text, text, text, text) to anon, authenticated;

-- The old 10-arg signature is now shadowed by the 11-arg one above (new
-- param has a default so callers don't need to change), but drop it
-- explicitly so PostgREST doesn't expose two overloads for the same RPC name.
drop function if exists create_public_booking(text, uuid, uuid, uuid, timestamptz, text, text, text, text, text);
