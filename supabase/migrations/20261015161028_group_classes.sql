-- Group classes: an appointment type can be a class with a number of places
-- ("Escuela de espalda", 8 places, Tuesdays 19:00). Design: the "Clases en
-- grupo" row of the QuiroFlow canvas (ClassesCalendar, ClassesBooking).
--
-- A class on the calendar is a class_sessions row: the type, the
-- practitioner, the room, the time and how many places it has. Each place
-- taken is an ordinary appointment of that type, linked to its session by
-- appointments.class_session_id -- so reminders, confirmations, billing,
-- bonos, no-shows, check-in and every automation work on it exactly as they
-- do on a visit, without knowing it is part of a class.
--
-- The rules live in the database, because a place can be taken from the
-- calendar, from online booking (anon) or from the API:
--
--   * appointments_class_place: a place takes its session's time,
--     practitioner, clinic, room and type; it is refused when the session is
--     full or cancelled (under a lock on the session, so two people cannot
--     take the last place); and an appointment of a class type cannot be made
--     outside a session.
--   * One place per patient per session (a unique index).
--   * Online booking books a session's start (create_public_booking, below)
--     and offers only sessions (get_public_class_sessions); and a session
--     keeps its practitioner busy for individual bookings
--     (get_booking_busy_times, create_public_booking's clash check).
--
-- No patient_id here: class_sessions has none, and the places are
-- appointments, which merge_patients already moves.

alter table public.appointment_types
  add column class_capacity integer check (class_capacity between 2 and 200);

create table public.class_sessions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  appointment_type_id uuid not null references public.appointment_types(id),
  practitioner_id uuid not null references public.team_members(id),
  room_id uuid references public.calendar_resources(id) on delete set null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  capacity integer not null check (capacity between 1 and 200),
  cancelled_at timestamptz,
  created_by uuid references public.team_members(id) on delete set null,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index class_sessions_clinic_time on public.class_sessions (clinic_id, starts_at);
create index class_sessions_practitioner_time on public.class_sessions (practitioner_id, starts_at);
create unique index class_sessions_one_per_slot on public.class_sessions (practitioner_id, appointment_type_id, starts_at) where cancelled_at is null;

alter table public.class_sessions enable row level security;
-- Who can see and change the calendar can see and change its classes.
create policy "staff select class_sessions" on public.class_sessions
  for select using (public.is_account_member(account_id) and public.permission_scope(account_id, 'calendar_scope') <> 'none');
create policy "staff insert class_sessions" on public.class_sessions
  for insert with check (public.is_account_member(account_id) and public.permission_scope(account_id, 'calendar_scope') <> 'none' and not public.has_restriction(account_id, 'calendar_read_only'));
create policy "staff update class_sessions" on public.class_sessions
  for update using (public.is_account_member(account_id) and public.permission_scope(account_id, 'calendar_scope') <> 'none' and not public.has_restriction(account_id, 'calendar_read_only'))
  with check (public.is_account_member(account_id) and public.permission_scope(account_id, 'calendar_scope') <> 'none' and not public.has_restriction(account_id, 'calendar_read_only'));
select public.require_two_factor_on('public.class_sessions');

-- compat-ok: appointments -> class_sessions adds no second path between any
-- pair an existing embed names. invoices -> appointments (with
-- appointment_types, clinic_id) and satisfaction_surveys -> appointments
-- (with clinics, patients) were each requested from PostgREST with this
-- migration applied and resolved as before, no PGRST201; class_sessions'
-- own two team_members keys are named where they are embedded.
alter table public.appointments
  add column class_session_id uuid references public.class_sessions(id);
create index appointments_class_session on public.appointments (class_session_id) where class_session_id is not null;
create unique index appointments_one_place_per_patient on public.appointments (class_session_id, patient_id)
  where class_session_id is not null and status <> 'cancelled' and deleted_at is null;

create or replace function public.appointments_class_place()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_session class_sessions;
  v_taken int;
  v_was_live boolean;
begin
  if new.class_session_id is null then
    if tg_op = 'INSERT' and exists (select 1 from appointment_types t where t.id = new.appointment_type_id and t.class_capacity is not null) then
      raise exception 'A class place is booked into one of its sessions' using errcode = '22023';
    end if;
    return new;
  end if;

  select * into v_session from class_sessions where id = new.class_session_id for update;
  if v_session.id is null or v_session.account_id <> new.account_id then
    raise exception 'No such class' using errcode = '22023';
  end if;

  -- The place is the session's: same time, practitioner, room, type.
  new.starts_at := v_session.starts_at;
  new.ends_at := v_session.ends_at;
  new.practitioner_id := v_session.practitioner_id;
  new.clinic_id := v_session.clinic_id;
  new.room_id := v_session.room_id;
  new.appointment_type_id := v_session.appointment_type_id;

  -- Taking a place (a new one, or one coming back from cancelled or
  -- deleted) needs one free.
  v_was_live := tg_op = 'UPDATE' and old.class_session_id is not distinct from new.class_session_id
    and old.status <> 'cancelled' and old.deleted_at is null;
  if new.status <> 'cancelled' and new.deleted_at is null and not v_was_live then
    if v_session.cancelled_at is not null then
      raise exception 'That class has been cancelled' using errcode = '22023';
    end if;
    select count(*) into v_taken from appointments
    where class_session_id = v_session.id and status <> 'cancelled' and deleted_at is null and id <> new.id;
    if v_taken >= v_session.capacity then
      raise exception 'That class is full' using errcode = '22023';
    end if;
  end if;
  return new;
end;
$$;
create trigger appointments_class_place before insert or update of class_session_id, status, deleted_at, starts_at, ends_at, practitioner_id on public.appointments
  for each row execute function public.appointments_class_place();

-- A class keeps its practitioner busy for online booking of anything else.
create or replace function public.get_booking_busy_times(p_clinic_id uuid, p_team_member_id uuid, p_from timestamp with time zone, p_to timestamp with time zone)
returns table(starts_at timestamp with time zone, ends_at timestamp with time zone)
language sql
security definer
set search_path to 'public'
as $function$
  -- The practitioner's appointments at EVERY clinic of the account, not only
  -- the one being booked: somebody who works at two is busy at this one
  -- while they are seeing a patient at the other. Only the times go out --
  -- no patient, clinic or type -- since anon calls this.
  --
  -- The clinic being booked is still what opens the door: it has to take
  -- online bookings, and the practitioner has to belong to its account, so
  -- a practitioner id from another account reads nothing through it.
  select a.starts_at, a.ends_at
  from clinics c
  join team_members tm on tm.id = p_team_member_id and tm.account_id = c.account_id
  join appointments a on a.practitioner_id = tm.id and a.account_id = c.account_id
  where c.id = p_clinic_id
    and c.online_booking_enabled = true
    and a.status <> 'cancelled'
    -- "Eliminar cita" sets deleted_at and leaves status 'booked'.
    and a.deleted_at is null
    and a.starts_at < p_to
    and a.ends_at > p_from
  union all
  -- And the classes they give, booked into or not yet.
  select s.starts_at, s.ends_at
  from clinics c
  join team_members tm on tm.id = p_team_member_id and tm.account_id = c.account_id
  join class_sessions s on s.practitioner_id = tm.id and s.account_id = c.account_id
  where c.id = p_clinic_id
    and c.online_booking_enabled = true
    and s.cancelled_at is null
    and s.starts_at < p_to
    and s.ends_at > p_from;
$function$;

-- Online booking of a class: its coming sessions at a clinic, with the places
-- left. { is_class: false } for a type that is not a class, so the booking
-- page knows to offer its usual calendar. Only what the page shows goes out.
create or replace function public.get_public_class_sessions(p_slug text, p_clinic_id uuid, p_appointment_type_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_account uuid;
  v_type appointment_types;
  v_until timestamptz;
begin
  select a.id into v_account from accounts a
  join clinics c on c.account_id = a.id and c.id = p_clinic_id and c.online_booking_enabled
  where a.slug = p_slug;
  if v_account is null then
    return jsonb_build_object('is_class', false, 'sessions', '[]'::jsonb);
  end if;
  select * into v_type from appointment_types t
  where t.id = p_appointment_type_id and t.account_id = v_account and t.online_booking_enabled and t.archived_at is null;
  if v_type.id is null or v_type.class_capacity is null then
    return jsonb_build_object('is_class', false, 'sessions', '[]'::jsonb);
  end if;
  v_until := now() + make_interval(days => coalesce(v_type.online_max_days_ahead, (select online_booking_max_days_ahead from accounts where id = v_account), 60));
  return jsonb_build_object('is_class', true, 'sessions', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', s.id,
      'starts_at', s.starts_at,
      'ends_at', s.ends_at,
      'practitioner_id', s.practitioner_id,
      'practitioner_name', tm.full_name,
      'room_name', r.name,
      'places_left', greatest(0, s.capacity - (
        select count(*) from appointments a
        where a.class_session_id = s.id and a.status <> 'cancelled' and a.deleted_at is null
      ))
    ) order by s.starts_at)
    from class_sessions s
    join team_members tm on tm.id = s.practitioner_id
    left join calendar_resources r on r.id = s.room_id
    where s.clinic_id = p_clinic_id
      and s.appointment_type_id = v_type.id
      and s.cancelled_at is null
      and s.starts_at > now()
      and s.starts_at <= v_until
  ), '[]'::jsonb));
end;
$$;
revoke all on function public.get_public_class_sessions(text, uuid, uuid) from public;
grant execute on function public.get_public_class_sessions(text, uuid, uuid) to anon, authenticated;

-- create_public_booking, as 20261003134946_online_booking_identity.sql left
-- it, with a class booked into its session: see the comments at
-- v_class_capacity, the clash check and the insert.
CREATE OR REPLACE FUNCTION public.create_public_booking(p_account_slug text, p_clinic_id uuid, p_team_member_id uuid, p_appointment_type_id uuid, p_starts_at timestamp with time zone, p_first_name text, p_last_name text, p_email text, p_phone text, p_note text, p_country_code text DEFAULT 'ES'::text, p_discount_code text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_class_capacity int;
  v_session_id uuid;
  v_session_ends timestamptz;
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
  -- A class (appointment_types.class_capacity) is booked into one of its
  -- sessions: the time and the practitioner are the session's, and it is
  -- the clinic that put it on, at whatever hour, so the working-hours check
  -- is not asked of it. Whether a place is left is the appointments
  -- trigger's question (appointments_class_place), under the session's lock.
  select class_capacity into v_class_capacity from appointment_types where id = p_appointment_type_id;
  if v_class_capacity is not null then
    select cs.id, cs.ends_at into v_session_id, v_session_ends
    from class_sessions cs
    where cs.clinic_id = p_clinic_id
      and cs.practitioner_id = p_team_member_id
      and cs.appointment_type_id = p_appointment_type_id
      and cs.starts_at = p_starts_at
      and cs.cancelled_at is null;
    if v_session_id is null then
      raise exception 'That class is not on at that time';
    end if;
    v_ends_at := v_session_ends;
  else
    perform public.assert_booking_slot_open(p_clinic_id, p_team_member_id, p_starts_at, v_ends_at);
  end if;

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
      -- The other places in the same class are not a clash.
      and (v_session_id is null or class_session_id is distinct from v_session_id)
  ) or (
    -- A class on at that time keeps its practitioner busy for anything else,
    -- even before anyone has booked a place in it.
    v_session_id is null and exists (
      select 1 from class_sessions cs
      where cs.practitioner_id = p_team_member_id
        and cs.cancelled_at is null
        and cs.starts_at < v_ends_at
        and cs.ends_at > p_starts_at
    )
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
  -- Both of those cost something real. One lead booked on 14 Sep and
  -- received a seven-step sequence between the 16th and the 18th, because
  -- the email on their lead and the one on their patient record differ by
  -- one letter, and the backstop never fired. Another booked four minutes
  -- after their sequence started and it ran for another day before the cron
  -- noticed.
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
    starts_at, ends_at, status, source, class_session_id
  )
  values (
    v_account_id, p_clinic_id, p_team_member_id, v_patient_id, p_appointment_type_id,
    p_starts_at, v_ends_at, 'booked', 'online', v_session_id
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

-- The patient app's booking (get_patient_booking_info) books at a free time,
-- not into a session, so it leaves group classes out until it offers them.
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
        -- Not group classes: a class place is booked into one of its sessions,
        -- which the app does not offer yet (the web's booking page does).
        and at.class_capacity is null
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
        -- Not group classes: a class place is booked into one of its sessions,
        -- which the app does not offer yet (the web's booking page does).
        and at.class_capacity is null
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
revoke all on function public.get_patient_booking_info() from public, anon;
grant execute on function public.get_patient_booking_info() to authenticated;
