-- Who an online booking is FOR, decided from what the person typed.
--
-- Stacked on 20260930160011_booking_other_clinic_and_departed_staff.sql: the
-- body below is that file's create_public_booking with only the changes
-- described here.
--
-- create_public_booking is security definer and anon calls it, so every
-- argument is a claim made by whoever is at the keyboard. It treated the email
-- as proof of identity on its own:
--
-- 1. A known email booked onto that patient's record and then filed the
--    caller's phone number against them -- the number confirmations,
--    reminders and WhatsApp then go to. Typing somebody's address with your
--    own number made you a contact of theirs.
-- 2. "Existing patients only" (online_bookable_by = 'existing_patients') was
--    satisfied by any address belonging to a patient of the clinic.
-- 3. A lead was moved to 'booked', and linked to the booking patient, by the
--    last nine digits of a phone number alone.
--
-- The rules now:
--
-- * The email still finds the record. It is what a returning patient books
--   with; and since the confirmation goes to the address on the record,
--   somebody booking under another person's email tells that person rather
--   than hiding it. Among records sharing one address (families) the one
--   whose number was given wins, then the one whose first name was given, then
--   the oldest -- not whichever `limit 1` happened to return.
-- * A phone number is written to the patient's record only when this booking
--   created the record. An existing record keeps its own numbers; one it has
--   not got goes on the appointment as a visit note, in Spanish, for reception
--   to check. A number already on file -- spaced, prefixed or not -- adds
--   nothing; it used to add a second copy whenever the spacing differed.
-- * "Existing patients only" needs the email AND a number on file for that
--   record (digits compared, last nine). The refusal is the same message
--   whichever half failed, so it cannot be used to test addresses. A real
--   returning patient who books with their usual email and number is
--   unaffected; one with no number on file is asked to ring, which is what the
--   clinic would want before handing out an existing-patients slot anyway.
-- * A lead is advanced by its email, as before, or by its phone number AND
--   first name together (first word, accents and case aside). The phone alone
--   is something anybody can type.
--
--   leads_follow_appointments (20260926160512) makes the same link from the
--   appointment trigger, using the numbers on the patient's record -- which,
--   for a record this booking created, are the number the caller typed. So
--   for an appointment whose source is 'online' it applies the same rule;
--   every other route (desk, app, API, waitlist) keeps matching on the number
--   alone, since there the number was entered by the clinic or by the
--   signed-in patient. Its body below is 20260926160512's with only that
--   change.
--
-- Signatures, return shapes, security definer and search_path are unchanged,
-- so the live booking page keeps working; grants are restated below.

CREATE OR REPLACE FUNCTION public.create_public_booking(p_account_slug text, p_clinic_id uuid, p_team_member_id uuid, p_appointment_type_id uuid, p_starts_at timestamp with time zone, p_first_name text, p_last_name text, p_email text, p_phone text, p_note text, p_country_code text DEFAULT 'ES'::text, p_discount_code text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  v_phone_key text;
  v_first_name_key text;
  v_phone_on_file boolean := false;
  v_number_kept_off_record boolean := false;
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
  -- What two numbers are compared by, here and against leads: digits only,
  -- the last nine when there are that many. A lead from a Meta form carries
  -- '34612345678', a record imported from PracticeHub '612 345 678', and the
  -- form a bare '612345678' with the country in its own field.
  v_phone_key := case when length(v_phone_digits) >= 9 then right(v_phone_digits, 9) else v_phone_digits end;
  -- And a first name by its first word, accents and case aside: "Ramón" on
  -- the form is "Ramon Anuncio" on the lead.
  v_first_name_key := split_part(regexp_replace(public.unaccent_lower(btrim(p_first_name)), '\s+', ' ', 'g'), ' ', 1);

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
      -- An archived clinic is closed. get_public_booking_info stopped listing
      -- one, but this still booked it for anybody holding its id.
      and archived_at is null
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
      -- Somebody who has left. Leaving switches online booking off, but the
      -- switch stays on their settings page and can be ticked again.
      and tm.deleted_at is null
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

  -- Inside the hours this practitioner works and clear of every closure --
  -- what the page offers, restated because anon can call this directly.
  perform public.assert_booking_slot_open(p_clinic_id, p_team_member_id, p_starts_at, v_ends_at);

  -- One booking at a time per practitioner. The overlap check below and the
  -- insert after it are two statements, and two patients picking the same
  -- free slot a moment apart both passed the check before either insert was
  -- visible, so both got the appointment. The lock is held to the end of the
  -- transaction, so whoever takes it second re-runs the check against the
  -- first one's committed row and is refused. Same key in create_public_booking,
  -- create_patient_booking and reschedule_patient_appointment.
  perform pg_advisory_xact_lock(hashtext('appointment_slot'), hashtext(p_team_member_id::text));

  if exists (
    select 1 from appointments
    where practitioner_id = p_team_member_id
      and status <> 'cancelled'
      -- A deleted appointment keeps status 'booked'; it holds no time.
      and deleted_at is null
      and starts_at < v_ends_at
      and ends_at > p_starts_at
  ) then
    raise exception 'That time is no longer available';
  end if;

  -- Who this booking is for. Everything the caller sent is a claim: anon
  -- calls this function, so an email address is something anybody can type.
  --
  -- The email still finds the record, as it always has -- it is what a
  -- returning patient books with, and the confirmation goes to the address on
  -- that record, so somebody booking under another person's email tells that
  -- person rather than hiding it from them. What changed (20261003134946) is
  -- what the email alone is allowed to do:
  --
  --   - Among records sharing the address -- a family booked under one
  --     parent's email is common -- the one whose number was given wins, then
  --     the one whose first name was given, then the oldest. It used to be
  --     `limit 1`, i.e. whichever the planner found first.
  --   - "Existing patients only" needs the email AND a number on file for
  --     that record. The email alone opened it to anybody who knew the
  --     address of one patient of the clinic. The refusal reads the same
  --     whichever half failed, so it cannot be used to test addresses.
  --   - A number is added to the record only when the record is new. An
  --     existing record keeps its numbers -- they are where confirmations,
  --     reminders and WhatsApp go -- and a number it has not got is written
  --     on the appointment as a visit note instead, for reception to check
  --     and add to the record by hand if it is really theirs.
  select p.id,
         exists (
           select 1 from patient_contact_numbers c
           where c.patient_id = p.id
             and v_phone_key <> ''
             and (case when length(regexp_replace(c.number, '\D', '', 'g')) >= 9
                       then right(regexp_replace(c.number, '\D', '', 'g'), 9)
                       else regexp_replace(c.number, '\D', '', 'g') end) = v_phone_key
         )
    into v_patient_id, v_phone_on_file
  from patients p
  where p.account_id = v_account_id and lower(p.email) = lower(trim(p_email))
  order by
    exists (
      select 1 from patient_contact_numbers c
      where c.patient_id = p.id
        and v_phone_key <> ''
        and (case when length(regexp_replace(c.number, '\D', '', 'g')) >= 9
                  then right(regexp_replace(c.number, '\D', '', 'g'), 9)
                  else regexp_replace(c.number, '\D', '', 'g') end) = v_phone_key
    ) desc,
    (split_part(regexp_replace(public.unaccent_lower(btrim(p.first_name)), '\s+', ' ', 'g'), ' ', 1) = v_first_name_key) desc,
    p.created_at,
    p.id
  limit 1;
  -- No record at all leaves both targets null.
  v_phone_on_file := coalesce(v_phone_on_file, false);

  if v_bookable_by = 'new_patients' and v_patient_id is not null then
    raise exception 'This appointment type is only available to new patients';
  elsif v_bookable_by = 'existing_patients' and (v_patient_id is null or not v_phone_on_file) then
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

    -- A record made by this booking is the caller's own, so their number is
    -- its number.
    insert into patient_contact_numbers (account_id, patient_id, number, country_code)
    values (v_account_id, v_patient_id, trim(p_phone), coalesce(p_country_code, 'ES'));
  elsif not v_phone_on_file then
    -- An existing record, and a number it has not got: kept on the
    -- appointment (below), not filed against the patient.
    v_number_kept_off_record := true;
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
  -- The phone together with the first name, since 20261003134946. A number on
  -- its own is something anybody can type, and a last-nine-digit match moved
  -- somebody else's lead to booked and linked it to whoever was booking. The
  -- email is matched alone as before: it is what the lead's own form sent.
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
        and v_first_name_key <> ''
        and split_part(regexp_replace(public.unaccent_lower(btrim(l.full_name)), '\s+', ' ', 'g'), ' ', 1) = v_first_name_key
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

  if v_number_kept_off_record then
    -- In Spanish: it is read by reception at a Spanish clinic, on the visit.
    insert into visit_notes (account_id, appointment_id, body, created_by)
    values (
      v_account_id, v_appointment_id,
      format(
        'Reserva online: el teléfono indicado (%s, %s) no coincide con los de la ficha, así que no se ha añadido. Compruébelo antes de usarlo.',
        trim(p_phone), coalesce(p_country_code, 'ES')
      ),
      null
    );
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
      -- The account's own receipt series, as every other invoice is numbered
      -- (0168). This used to be
      --
      --   select 'INV-' || lpad((count(*) + 1)::text, 4, '0') from invoices
      --
      -- which, in a security definer function, counts EVERY clinic's invoices:
      -- a deposit invoice got a number from nobody's series, colliding with
      -- or skipping past the clinic's own, and moved by other clinics' billing.
      --
      -- The statement next_invoice_number() runs, rather than a call to it:
      -- that function refuses a signed-in caller who is not a member of the
      -- account, and a patient signed in to the portal who books on this page
      -- is exactly that. Both go through the same row, so they serialise.
      insert into invoice_number_sequences (account_id, prefix, next_number)
      values (v_account_id, 'INV-', 2)
      on conflict (account_id, prefix) do update
        set next_number = invoice_number_sequences.next_number + 1,
            updated_at = now()
      returning 'INV-' || lpad((next_number - 1)::text, 4, '0') into v_invoice_number;

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
$function$;

revoke all on function public.create_public_booking(text, uuid, uuid, uuid, timestamptz, text, text, text, text, text, text, text) from public;
grant execute on function public.create_public_booking(text, uuid, uuid, uuid, timestamptz, text, text, text, text, text, text, text) to anon, authenticated;

create or replace function public.leads_follow_appointments()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_attended boolean := new.checked_in_at is not null or new.status = 'completed';
  v_was_attended boolean := tg_op = 'UPDATE' and (old.checked_in_at is not null or old.status = 'completed');
  v_email text;
  v_phones text[];
  v_first_name_key text;
  v_convert_after integer;
  v_convert_type uuid;
  v_visits integer;
  r record;
begin
  -- Only a new booking or a first attendance moves anything. Every other
  -- edit to an appointment -- a reschedule, a note, a cancellation -- leaves
  -- the pipeline alone.
  if new.deleted_at is not null or new.status in ('cancelled', 'no_show') then
    return new;
  end if;
  if tg_op = 'UPDATE' and not (v_attended and not v_was_attended) then
    return new;
  end if;
  -- Most accounts have no leads at all; they pay one indexed lookup.
  if not exists (select 1 from leads where account_id = new.account_id and deleted_at is null) then
    return new;
  end if;

  -- The pipeline is bookkeeping; the appointment is the clinic's actual
  -- work. Whatever goes wrong below is logged and swallowed, so it can never
  -- be the reason a booking or a check-in fails -- the block's own
  -- subtransaction rolls back any lead it half-moved.
  begin

  -- Link the patient's unlinked leads. A patient's numbers live only in
  -- patient_contact_numbers (patients.phone went in 0007).
  select nullif(lower(trim(p.email)), ''),
         split_part(regexp_replace(public.unaccent_lower(btrim(p.first_name)), '\s+', ' ', 'g'), ' ', 1)
    into v_email, v_first_name_key
  from patients p where p.id = new.patient_id;
  select coalesce(array_agg(distinct right(d, 9)), '{}') into v_phones
  from (
    select regexp_replace(n.number, '\D', '', 'g') as d from patient_contact_numbers n where n.patient_id = new.patient_id
  ) numbers
  where length(d) >= 9;

  if v_email is not null or cardinality(v_phones) > 0 then
    update leads l
    set patient_id = new.patient_id
    where l.account_id = new.account_id
      and l.deleted_at is null
      and l.patient_id is null
      and (
        lower(l.email) = v_email
        or (
          l.phone is not null and right(regexp_replace(l.phone, '\D', '', 'g'), 9) = any(v_phones)
          -- A booking from the public page made its patient's number out of
          -- whatever the caller typed, so there the number is matched with
          -- the first name, as create_public_booking matches it
          -- (20261003134946). Every other route's numbers were entered by
          -- the clinic or by the signed-in patient, and keep matching alone.
          and (
            new.source is distinct from 'online'
            or (
              coalesce(v_first_name_key, '') <> ''
              and split_part(regexp_replace(public.unaccent_lower(btrim(l.full_name)), '\s+', ' ', 'g'), ' ', 1) = v_first_name_key
            )
          )
        )
      );
  end if;

  select a.lead_convert_after_visits, a.lead_convert_appointment_type_id
  into v_convert_after, v_convert_type
  from accounts a where a.id = new.account_id;

  for r in
    select l.id, l.stage, l.created_at
    from leads l
    where l.account_id = new.account_id
      and l.patient_id = new.patient_id
      and l.deleted_at is null
      and l.stage <> 'lost'
      and new.starts_at >= date_trunc('day', l.created_at)
    for update
  loop
    -- Converted, when this visit makes the count. Counted per lead, from the
    -- day that lead came in.
    if v_attended and v_convert_after is not null and lead_stage_rank(r.stage) < lead_stage_rank('converted') then
      select count(*) into v_visits
      from appointments a
      where a.patient_id = new.patient_id
        and a.deleted_at is null
        and a.status not in ('cancelled', 'no_show')
        and (a.checked_in_at is not null or a.status = 'completed')
        and a.starts_at >= date_trunc('day', r.created_at)
        and (v_convert_type is null or a.appointment_type_id = v_convert_type);
      if v_visits >= v_convert_after then
        perform lead_auto_stage(r.id, new.account_id, r.stage, 'converted',
          case when v_convert_after = 1 then 'attended their first visit' else 'attended ' || v_visits || ' visits' end);
        continue;
      end if;
    end if;

    if v_attended and lead_stage_rank(r.stage) < lead_stage_rank('showed') then
      perform lead_auto_stage(r.id, new.account_id, r.stage, 'showed', 'checked in for an appointment');
    elsif tg_op = 'INSERT' and lead_stage_rank(r.stage) < lead_stage_rank('booked') then
      perform lead_auto_stage(r.id, new.account_id, r.stage, 'booked', 'an appointment was booked');
    end if;
  end loop;

  exception when others then
    raise warning 'leads_follow_appointments: appointment % left the lead pipeline unchanged: % (%)', new.id, sqlerrm, sqlstate;
  end;

  return new;
end;
$$;

-- Neither is an RPC. The helper takes an account id as an argument, so left

revoke all on function public.leads_follow_appointments() from public, anon, authenticated;
