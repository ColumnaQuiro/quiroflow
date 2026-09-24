-- Online booking checks that the phone number is one.
--
-- plpgsql cannot amend a function in place, so this restates
-- 20260921160000's definition unchanged apart from the guard. The reason for
-- the guard is in the function itself.

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
  p_country_code text default 'ES',
  p_discount_code text default null
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
  v_bookable_by text;
  v_max_days_ahead int;
  v_type_max_days_ahead int;
  v_deposit_cents int;
  v_charge_amount int;
  v_discount_id uuid;
  v_percent_off int;
  v_amount_off_cents int;
  v_max_uses int;
  v_times_used int;
  v_discount_applied_cents int := 0;
  v_ends_at timestamptz;
  v_patient_id uuid;
  v_appointment_id uuid;
  v_invoice_id uuid;
  v_invoice_number text;
  v_phone_raw text;
  v_phone_digits text;
  v_phone_country text;
begin

  -- A booking the clinic cannot answer is worth less than no booking, and
  -- both ways of reaching the patient were optional here. The form marked
  -- only the email required, and this function accepted a blank phone in
  -- silence:
  --
  --   if p_phone is not null and trim(p_phone) <> '' then ... insert ...
  --
  -- Three of the first twenty-six online bookings arrived with no number,
  -- and nobody found out until reception tried to ring them.
  --
  -- Enforced HERE and not only in the form, because this function is
  -- security definer and anon can call it directly: `required` on an input
  -- is a courtesy to whoever is typing, never a rule.
  if p_email is null or trim(p_email) = '' or position('@' in p_email) = 0 then
    raise exception 'An email address is required to book';
  end if;
  if p_phone is null or trim(p_phone) = '' then
    raise exception 'A phone number is required to book';
  end if;

  -- ...and it has to look like one, not merely be non-empty. On 24 Sep 2026 a
  -- patient booked having picked +34 from the dropdown and typed "6" into the
  -- number field: `required` and type="tel" between them accept one
  -- character, so the clinic got a confirmed appointment and no way to ring
  -- the person who made it. Nothing downstream can recover from that -- the
  -- E.164 builder happily produces "346", WhatsApp accepts the send, and it
  -- goes nowhere.
  --
  -- These are the same three rules as looksLikePhoneNumber in utils/phone.ts,
  -- restated here for the same reason the guard above is: this function is
  -- security definer and anon can call it without going near the form. Keep
  -- the two in step by hand.
  v_phone_raw := btrim(p_phone);
  v_phone_digits := regexp_replace(v_phone_raw, '\D', '', 'g');
  v_phone_country := coalesce(p_country_code, 'ES');

  -- A number written with its own "+34" is the same number as one without it.
  -- Only Spain's prefix is recognised here: COUNTRIES lives in the app, and
  -- guessing at any other dial code is the mistake utils/countries.ts was
  -- written to stop -- a Belgian number read as a Spanish one belonging to
  -- somebody else.
  if v_phone_country = 'ES' and left(v_phone_raw, 1) = '+' and left(v_phone_digits, 2) = '34' then
    v_phone_digits := substr(v_phone_digits, 3);
    v_phone_raw := v_phone_digits;
  end if;

  if v_phone_country = 'ES' and left(v_phone_raw, 1) <> '+' then
    -- Spain gets an exact length because it is where these patients are and
    -- the rule is unambiguous: every Spanish number, mobile or landline, is
    -- nine digits. The leading digit is deliberately not checked -- the form
    -- says "movil", but someone who only has a landline still wants the
    -- appointment.
    if length(v_phone_digits) <> 9 then
      raise exception 'That phone number does not look right';
    end if;
  -- Everywhere else, and any number carrying a foreign prefix, gets a floor
  -- and an E.164 ceiling rather than a per-country length. Ninety numbering
  -- plans is not a list this repo can keep honest, and a wrong guess refuses
  -- a real patient at the last step of a booking.
  elsif length(v_phone_digits) < 6 or length(v_phone_digits) > 15 then
    raise exception 'That phone number does not look right';
  end if;
  -- The email guard also closes a way onto a stranger's record: the lookup
  -- below matches on lower(email) = lower(trim(p_email)), and an empty email
  -- matches the first patient who has none -- of which 670 arrived from
  -- PracticeHub. An empty email could book onto somebody else entirely and
  -- file a phone number against them.

  select id, online_booking_max_days_ahead into v_account_id, v_max_days_ahead
  from accounts where slug = p_account_slug;
  if v_account_id is null then
    raise exception 'Not found';
  end if;

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
  where id = p_appointment_type_id and account_id = v_account_id and online_booking_enabled = true;
  if v_duration is null then
    raise exception 'Appointment type not available';
  end if;

  if v_type_max_days_ahead is not null then
    v_max_days_ahead := v_type_max_days_ahead;
  end if;
  if p_starts_at > now() + (v_max_days_ahead || ' days')::interval then
    raise exception 'That date is too far in advance to book online';
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
      and tm.online_booking_enabled = true and tm.is_practitioner = true and tmc.clinic_id = p_clinic_id
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

  if v_bookable_by = 'new_patients' and v_patient_id is not null then
    raise exception 'This appointment type is only available to new patients';
  elsif v_bookable_by = 'existing_patients' and v_patient_id is null then
    raise exception 'This appointment type is only available to existing patients';
  end if;

  if v_patient_id is null then
    insert into patients (account_id, clinic_id, first_name, last_name, email)
    values (
      v_account_id, p_clinic_id, trim(p_first_name),
      nullif(trim(coalesce(p_last_name, '')), ''),
      lower(trim(p_email))
    )
    returning id into v_patient_id;
  end if;

  if p_phone is not null and trim(p_phone) <> '' and not exists (
    select 1 from patient_contact_numbers where patient_id = v_patient_id and number = trim(p_phone)
  ) then
    insert into patient_contact_numbers (account_id, patient_id, number, country_code)
    values (v_account_id, v_patient_id, trim(p_phone), coalesce(p_country_code, 'ES'));
  end if;

  -- Somebody who books has converted themselves, and the lead they came from
  -- should stop being chased.
  --
  -- Conversion was a staff action only -- POST /api/growth/leads/:id/convert,
  -- clicked by a person -- so a lead who books online stayed at 'new' with no
  -- patient_id, and the drip sequence kept running. sequenceStopReason() is a
  -- backstop rather than a link: it compares lead.email to patients.email on
  -- the next cron pass, which is both late and email-only.
  --
  -- Both of those cost something real. Alberto Rueda Mansilla booked on 14 Sep
  -- and received a seven-step sequence between the 16th and the 18th, because
  -- his lead says ruedamansilla@ and his patient record says rudamansilla@
  -- -- one letter, and the backstop never fired. Sergio Bielsa booked four
  -- minutes after his sequence started and it ran for another day before
  -- the cron noticed.
  --
  -- So: match on email OR phone, here, at the moment of booking.
  --
  -- 'booked' rather than 'converted': they have an appointment, they have not
  -- attended it. Setting patient_id is what stops the sequence either way.
  -- A lead already further along keeps its stage -- this can only move
  -- somebody forward, never back.
  update leads l
  set patient_id = v_patient_id,
      stage = case when l.stage in ('new', 'contacted', 'qualified') then 'booked' else l.stage end,
      stage_changed_at = now()
  where l.account_id = v_account_id
    and l.deleted_at is null
    and l.patient_id is null
    and (
      lower(l.email) = lower(trim(p_email))
      -- Digits only, last nine compared: a lead from a Meta form carries
      -- '34612345678' while the booking sends a bare '612345678' with the
      -- country in its own field, and a patient typing their own number puts
      -- spaces wherever they like.
      or (
        l.phone is not null
        and length(regexp_replace(l.phone, '\D', '', 'g')) >= 9
        and length(regexp_replace(trim(p_phone), '\D', '', 'g')) >= 9
        and right(regexp_replace(l.phone, '\D', '', 'g'), 9)
            = right(regexp_replace(trim(p_phone), '\D', '', 'g'), 9)
      )
    );

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
    v_charge_amount := coalesce(v_deposit_cents, v_effective_price);

    if p_discount_code is not null and trim(p_discount_code) <> '' then
      select id, percent_off, amount_off_cents, max_uses, times_used
        into v_discount_id, v_percent_off, v_amount_off_cents, v_max_uses, v_times_used
      from online_booking_discount_codes
      where account_id = v_account_id and code = trim(p_discount_code) and active = true
        and (expires_at is null or expires_at > now())
      for update;

      if v_discount_id is null then
        raise exception 'Invalid or expired discount code';
      end if;
      if v_max_uses is not null and v_times_used >= v_max_uses then
        raise exception 'This discount code has reached its usage limit';
      end if;

      if v_percent_off is not null then
        v_discount_applied_cents := v_discount_applied_cents + (v_charge_amount * v_percent_off / 100);
      end if;
      if v_amount_off_cents is not null then
        v_discount_applied_cents := v_discount_applied_cents + v_amount_off_cents;
      end if;
      v_discount_applied_cents := least(v_discount_applied_cents, v_charge_amount);
      v_charge_amount := v_charge_amount - v_discount_applied_cents;

      update online_booking_discount_codes set times_used = times_used + 1 where id = v_discount_id;
    end if;

    if v_charge_amount > 0 then
      select 'INV-' || lpad((count(*) + 1)::text, 4, '0') into v_invoice_number from invoices;

      insert into invoices (account_id, patient_id, appointment_id, invoice_number, status, total_cents)
      values (v_account_id, v_patient_id, v_appointment_id, v_invoice_number, 'unpaid', v_charge_amount)
      returning id into v_invoice_id;

      insert into invoice_line_items (account_id, invoice_id, description, quantity, price_cents)
      select v_account_id, v_invoice_id,
             at.name || case when v_deposit_cents is not null then ' (deposit)' else '' end,
             1, v_charge_amount
      from appointment_types at where at.id = p_appointment_type_id;
    end if;
  end if;

  return jsonb_build_object(
    'appointment_id', v_appointment_id,
    'starts_at', p_starts_at,
    'ends_at', v_ends_at,
    'invoice_id', v_invoice_id,
    'payment_required_cents', case when v_invoice_id is not null then v_charge_amount else 0 end,
    'discount_applied_cents', v_discount_applied_cents
  );
end;
$$;
