-- Online booking obeys the calendar it is booking into.
--
-- Everything here is a rule the booking page and the patient app already
-- follow when they build the slots they OFFER, and which the functions that
-- actually BOOK did not check. create_public_booking is security definer and
-- anon can call it without loading the page; the app is not built by CI and
-- every installed version calls these same functions. So the rule has to live
-- here, not only in whichever screen happened to render the choice.
--
-- 1. Opening hours, days off and closures. None of create_public_booking,
--    create_patient_booking or reschedule_patient_appointment looked at
--    business hours or availability_blocks. The app built its slots from the
--    clinic's hours only -- no practitioner hours, no blocks -- so it offered
--    a practitioner's day off and a bank-holiday closure, and the function
--    booked them. assert_booking_slot_open below is the page's own rule:
--    practitionerWindowsForDay (utils/businessHours.ts) -- the practitioner's
--    week if they have set one, the clinic's otherwise, NOT the two
--    intersected (that file explains why) -- read in the CLINIC's time zone,
--    plus every block for the whole clinic or for that practitioner, as
--    get_booking_blocked_times hands them to the page.
--
-- 2. Deleted appointments. "Eliminar cita" sets deleted_at and leaves status
--    'booked'. get_booking_busy_times and the clash checks here counted such
--    a row as busy, so a deleted appointment kept its slot off the booking
--    page for good. reschedule_patient_appointment already skipped them.
--
-- 3. Two patients, one slot. Every path checked for a clash and then
--    inserted, with nothing in between to stop a second booking passing the
--    same check. Serialised per practitioner with a transaction-scoped
--    advisory lock. Not an exclusion constraint: staff double-book on purpose
--    and existing data already overlaps.
--
-- 4. create_public_booking numbered its deposit invoices with count(*) + 1
--    over EVERY account's invoices (security definer sees them all). It now
--    takes the next number from the account's own series, as everything else
--    does.
--
-- 5. create_public_booking booked an archived clinic for anybody holding its
--    id; get_public_booking_info had stopped listing it.
--
-- Plus two additive fields the screens need to build slots the way the check
-- reads them: each clinic's time zone (both info functions) and each
-- practitioner's own hours (get_patient_booking_info). Nothing is removed and
-- every signature is unchanged, so the code already live keeps working: an
-- older page or app simply ignores the new keys.
--
-- Bodies are the latest definitions (20260925140512 for create_public_booking
-- and get_public_booking_info, 20260925181500 for the three patient-app
-- functions, 0012 for get_booking_busy_times) with only the changes above.

-- Raises unless [p_starts_at, p_ends_at) is a time the booking page would
-- offer for this practitioner at this clinic: inside one of their working
-- windows that day, and clear of every availability block.
--
-- The windows are practitionerWindowsForDay (utils/businessHours.ts): the
-- practitioner's own week once they have set any hours at all -- a day they
-- left empty is then a day off -- and the clinic's week for somebody who has
-- never set one. Hours are wall-clock strings in the clinic's time zone, so
-- the day and the window edges are read there, never in UTC and never in the
-- visitor's zone. Nothing configured anywhere means no window, which is also
-- what the page offers.
--
-- Blocks as get_booking_blocked_times gives them to the page: one naming this
-- practitioner, or one naming nobody, which closes the clinic for everyone.
--
-- Not security definer and not callable by clients: it is only ever run from
-- inside the booking functions, as their owner.
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

  if exists (
    select 1 from availability_blocks b
    where b.clinic_id = p_clinic_id
      and (b.practitioner_id is null or b.practitioner_id = p_team_member_id)
      and b.starts_at < p_ends_at
      and b.ends_at > p_starts_at
  ) then
    raise exception 'That time is not available for booking';
  end if;
end;
$function$;

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
  -- Both of those cost something real. One lead booked on 14 Sep and
  -- received a seven-step sequence between the 16th and the 18th, because
  -- the email on their lead and the one on their patient record differ by
  -- one letter, and the backstop never fired. Another booked four minutes
  -- after their sequence started and it ran for another day before the cron
  -- noticed.
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

CREATE OR REPLACE FUNCTION public.create_patient_booking(p_clinic_id uuid, p_team_member_id uuid, p_appointment_type_id uuid, p_starts_at timestamp with time zone, p_note text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  -- Inside the hours this practitioner works and clear of every closure, as
  -- create_public_booking checks it. The app offered a practitioner's days
  -- off and blocked time, and this booked them.
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

  select cr.id into v_room_id
  from calendar_resources cr
  where cr.clinic_id = p_clinic_id
    and not exists (
      select 1 from appointments a
      where a.room_id = cr.id
        and a.status <> 'cancelled'
        and a.deleted_at is null
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
$function$;

CREATE OR REPLACE FUNCTION public.reschedule_patient_appointment(p_appointment_id uuid, p_starts_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  -- Inside the hours the practitioner works and clear of every closure, as a
  -- new booking is.
  perform public.assert_booking_slot_open(v_clinic_id, v_practitioner_id, p_starts_at, v_new_ends_at);

  -- One booking at a time per practitioner. The overlap check below and the
  -- insert after it are two statements, and two patients picking the same
  -- free slot a moment apart both passed the check before either insert was
  -- visible, so both got the appointment. The lock is held to the end of the
  -- transaction, so whoever takes it second re-runs the check against the
  -- first one's committed row and is refused. Same key in create_public_booking,
  -- create_patient_booking and reschedule_patient_appointment.
  perform pg_advisory_xact_lock(hashtext('appointment_slot'), hashtext(coalesce(v_practitioner_id, v_clinic_id)::text));

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
        and a.deleted_at is null
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
$function$;

CREATE OR REPLACE FUNCTION public.get_booking_busy_times(p_clinic_id uuid, p_team_member_id uuid, p_from timestamp with time zone, p_to timestamp with time zone)
 RETURNS TABLE(starts_at timestamp with time zone, ends_at timestamp with time zone)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select a.starts_at, a.ends_at
  from appointments a
  join clinics c on c.id = a.clinic_id and c.online_booking_enabled = true
  where a.clinic_id = p_clinic_id
    and a.practitioner_id = p_team_member_id
    and a.status <> 'cancelled'
    -- "Eliminar cita" sets deleted_at and leaves status 'booked', so a deleted
    -- appointment kept its slot off the booking page for good.
    and a.deleted_at is null
    and a.starts_at < p_to
    and a.ends_at > p_from;
$function$;

CREATE OR REPLACE FUNCTION public.get_public_booking_info(p_slug text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    'account', (
      select jsonb_build_object(
        'id', a.id, 'name', a.name,
        'online_booking_max_days_ahead', a.online_booking_max_days_ahead,
        'online_booking_gtm_id', a.online_booking_gtm_id,
        'online_booking_referral_url', a.online_booking_referral_url,
        'online_booking_success_url', a.online_booking_success_url,
        'online_booking_primary_color', a.online_booking_primary_color,
        'online_booking_secondary_color', a.online_booking_secondary_color,
        'online_booking_background_color', a.online_booking_background_color,
        'online_booking_hide_logo', a.online_booking_hide_logo,
        'default_phone_country', a.default_phone_country,
        'online_booking_practitioner_order', a.online_booking_practitioner_order,
        'online_booking_text_overrides', a.online_booking_text_overrides,
        'appointment_confirmation_enabled', a.appointment_confirmation_enabled,
        'appointment_confirmation_channels', a.appointment_confirmation_channels,
        'discount_codes_enabled', exists (
          select 1 from online_booking_discount_codes d where d.account_id = a.id and d.active = true
        )
      )
      from accounts a where a.id = v_account_id
    ),
    'clinics', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'name', c.name, 'address', c.address, 'business_hours', c.business_hours,
        'logo_storage_path', c.logo_storage_path, 'phone', c.phone, 'email', c.email,
        -- business_hours are wall-clock times in this zone. The page built
        -- slots in the VISITOR's zone, so a patient abroad was offered 09:00
        -- their time as if it were the clinic's.
        'timezone', c.timezone
      ) order by c.name)
      from clinics c
      where c.account_id = v_account_id and c.online_booking_enabled = true and c.archived_at is null
    ), '[]'::jsonb),
    'appointment_types', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', at.id, 'name', at.name, 'duration_minutes', at.duration_minutes,
        'color', at.color, 'default_price_cents', at.default_price_cents,
        'online_payment_required', at.online_payment_required,
        'online_bookable_by', at.online_bookable_by,
        'online_bypass_practitioner', at.online_bypass_practitioner,
        'online_max_days_ahead', at.online_max_days_ahead,
        'online_deposit_cents', at.online_deposit_cents
      ) order by at.sort_order nulls last, at.name)
      from appointment_types at
      where at.account_id = v_account_id and at.online_booking_enabled = true and at.archived_at is null
    ), '[]'::jsonb),
    'team_members', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', tm.id, 'full_name', tm.full_name, 'color', tm.color, 'business_hours', tm.business_hours,
        'photo_storage_path', tm.photo_storage_path,
        'clinic_ids', (
          select coalesce(jsonb_agg(tmc.clinic_id), '[]'::jsonb)
          from team_member_clinics tmc where tmc.team_member_id = tm.id
        )
      ) order by
        case when (select online_booking_practitioner_order from accounts where id = v_account_id) = 'alphabetical'
          then tm.full_name end,
        tm.created_at)
      from team_members tm
      where tm.account_id = v_account_id and tm.online_booking_enabled = true and tm.is_practitioner = true
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
$function$;

CREATE OR REPLACE FUNCTION public.get_patient_booking_info()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
        'id', c.id, 'name', c.name, 'address', c.address, 'business_hours', c.business_hours,
        'timezone', c.timezone
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
        -- The practitioner's own week, which decides their slots on the web
        -- page (practitionerWindowsForDay). Without it the app offered the
        -- clinic's hours on a practitioner's days off.
        'business_hours', tm.business_hours,
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
$function$;

-- create or replace keeps each function's grants; restated so this file says
-- who may call what.
revoke all on function public.assert_booking_slot_open(uuid, uuid, timestamptz, timestamptz) from public, anon, authenticated;

grant execute on function public.create_public_booking(text, uuid, uuid, uuid, timestamptz, text, text, text, text, text, text, text) to anon, authenticated;
grant execute on function public.get_booking_busy_times(uuid, uuid, timestamptz, timestamptz) to anon, authenticated;
grant execute on function public.get_public_booking_info(text) to anon, authenticated;

revoke all on function public.create_patient_booking(uuid, uuid, uuid, timestamptz, text) from public, anon;
grant execute on function public.create_patient_booking(uuid, uuid, uuid, timestamptz, text) to authenticated;
revoke all on function public.reschedule_patient_appointment(uuid, timestamptz) from public, anon;
grant execute on function public.reschedule_patient_appointment(uuid, timestamptz) to authenticated;
revoke all on function public.get_patient_booking_info() from public, anon;
grant execute on function public.get_patient_booking_info() to authenticated;
