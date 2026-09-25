-- Settings -> Appointment Types, rebuilt as a list plus one page per type:
-- a type that is no longer offered is archived rather than deleted, the list
-- has an order, and the rules the old inline table never checked are now
-- checked here too.
--
-- 1. archived_at. Deleting a type was the only way to stop offering one, and
--    appointments.appointment_type_id is ON DELETE SET NULL: the ✕ on the old
--    table, behind a bare confirm(), took the name off every visit that had
--    ever used it -- the calendar, the patient's history, Income by type and
--    Statistics all lost it at once. An archived type leaves everywhere a type
--    is CHOSEN (the calendar's pickers, online booking, the patient app, the
--    waitlist and automation pickers, the public API's list) and stays
--    everywhere one is SHOWN. The booking functions below are restated to
--    refuse and hide it; the app filters its own pickers.
--
-- 2. Deleting is kept for a type nothing ever used (one made by mistake), and
--    guard_appointment_type_delete is the floor under the page's own check:
--    it refuses while any appointment -- soft-deleted ones included, since
--    those are restorable -- still points at it. Skipped when the account
--    itself is going, the same way guard_clinic_delete is.
--
-- 3. sort_order. The calendar proposes the first type when an appointment is
--    created, and until now "first" meant alphabetical, so a clinic whose
--    everyday visit is "Ajuste" had "Ajuste + masaje" or "Alta" put in front
--    of it. Backfilled alphabetically, so nothing moves until someone drags
--    it; new rows go to the end (appointment_types_sort_order_default).
--    Nullable rather than NOT NULL DEFAULT: a default cannot say "after the
--    last one", and a NOT NULL column with no default would make every
--    existing insert -- the PracticeHub importers, the e2e tasks, the code
--    live until the next release -- start failing.
--
-- 4. Names are unique per account among ACTIVE types, ignoring case and
--    surrounding spaces. Two "Ajuste" in the calendar's picker are two
--    buttons nobody can tell apart, and the one that gets picked decides the
--    price. Archived types are left out so retiring "Ajuste" and creating a
--    new "Ajuste" works -- reactivating the old one then needs a rename first,
--    which the page says. Production had no duplicates on 25 Sep 2026 (14
--    types, 0 clashes), and neither did the local seed; any environment that
--    has some gets the later ones renamed "Name (2)", "Name (3)" rather than
--    merged or archived: both are still on appointments, and renaming is the
--    only change that neither moves a visit to another type nor takes a type
--    out of booking without anyone deciding to.
--
-- 5. Duration 5-480 minutes, price >= 0, deposit between 0 and the price.
--    Added NOT VALID and validated only when no row breaks them (none did in
--    production on 25 Sep 2026), so an environment with an odd row keeps
--    migrating and the rule still holds for every write from now on.
--
-- 6. New types are not bookable online until someone says so. A type created
--    to try something, or by an import, used to appear on the public booking
--    page immediately. Existing rows keep whatever they have.
--
-- 7. The patient app's booking ignored per-practitioner durations and
--    prices: 0162_patient_app_foundations.sql restated create_patient_booking
--    and get_patient_booking_info from before 0072 added overrides, so a
--    practitioner who takes 60 minutes for a first visit was booked for the
--    type's 45 from the app while the web booking page booked 60.
--    mobile/pages/book.vue already reads info.overrides for its slots; the
--    function simply never sent them.
--
-- 8. get_appointment_type_usage, for the "Where it is used" section and the
--    list's counts. Security definer because the counts must be the clinic's,
--    not the viewer's: a manager with clinic_config but calendar_scope "own"
--    would otherwise see only their own appointments, read "0 appointments",
--    and be offered a delete the database then refuses.
--
-- 9. appointment_type_overrides becomes readable by every member, like
--    appointment_types already is. Its only policy (0072) was "staff manage",
--    gated on clinic_config, so for a practitioner or the front desk -- who
--    open the calendar and charge visits, and normally do not configure the
--    clinic -- the select came back empty and every visit was priced at the
--    type's default: the calendar's price, the appointment panel's charge and
--    the mobile app's invoice all ignored the practitioner's own price for
--    exactly the people who charge. Writing stays behind clinic_config.

-- ---------------------------------------------------------------- columns
alter table public.appointment_types add column archived_at timestamptz;
alter table public.appointment_types add column sort_order integer;

update public.appointment_types t
set sort_order = r.n
from (
  select id, row_number() over (partition by account_id order by lower(btrim(name)), created_at, id) as n
  from public.appointment_types
) r
where r.id = t.id;

create or replace function public.appointment_types_sort_order_default()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.sort_order is null then
    select coalesce(max(sort_order), 0) + 1 into new.sort_order
    from appointment_types where account_id = new.account_id;
  end if;
  return new;
end;
$function$;

revoke execute on function public.appointment_types_sort_order_default() from public, anon, authenticated;

drop trigger if exists appointment_types_sort_order_default on public.appointment_types;
create trigger appointment_types_sort_order_default
  before insert on public.appointment_types
  for each row execute function public.appointment_types_sort_order_default();

alter table public.appointment_types alter column online_booking_enabled set default false;

-- ---------------------------------------------------------------- names
do $$
declare
  r record;
  n integer;
begin
  for r in
    select id, account_id, name,
           row_number() over (partition by account_id, lower(btrim(name)) order by created_at, id) as k
    from appointment_types
  loop
    if r.k > 1 then
      n := r.k;
      while exists (
        select 1 from appointment_types
        where account_id = r.account_id and lower(btrim(name)) = lower(btrim(r.name)) || ' (' || n || ')'
      ) loop
        n := n + 1;
      end loop;
      update appointment_types set name = btrim(name) || ' (' || n || ')' where id = r.id;
    end if;
  end loop;
end;
$$;

create unique index appointment_types_active_name_key
  on public.appointment_types (account_id, lower(btrim(name)))
  where archived_at is null;

-- ---------------------------------------------------------------- checks
alter table public.appointment_types
  add constraint appointment_types_duration_range check (duration_minutes between 5 and 480) not valid;
alter table public.appointment_types
  add constraint appointment_types_price_not_negative check (default_price_cents >= 0) not valid;
alter table public.appointment_types
  add constraint appointment_types_deposit_within_price
  check (online_deposit_cents is null or (online_deposit_cents >= 0 and online_deposit_cents <= default_price_cents)) not valid;

do $$
begin
  if not exists (select 1 from appointment_types where duration_minutes not between 5 and 480) then
    alter table appointment_types validate constraint appointment_types_duration_range;
  end if;
  if not exists (select 1 from appointment_types where default_price_cents < 0) then
    alter table appointment_types validate constraint appointment_types_price_not_negative;
  end if;
  if not exists (
    select 1 from appointment_types
    where online_deposit_cents is not null and (online_deposit_cents < 0 or online_deposit_cents > default_price_cents)
  ) then
    alter table appointment_types validate constraint appointment_types_deposit_within_price;
  end if;
end;
$$;

-- ---------------------------------------------------------------- delete
create or replace function public.guard_appointment_type_delete()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  -- The account is being deleted and is taking its types with it.
  if not exists (select 1 from accounts where id = old.account_id) then
    return old;
  end if;
  if exists (select 1 from appointments where appointment_type_id = old.id) then
    raise exception using
      errcode = '23503',
      message = 'This appointment type is on appointments, so it cannot be deleted. Archive it instead: its history is kept.';
  end if;
  return old;
end;
$function$;

revoke execute on function public.guard_appointment_type_delete() from public, anon, authenticated;

drop trigger if exists guard_appointment_type_delete on public.appointment_types;
create trigger guard_appointment_type_delete
  before delete on public.appointment_types
  for each row execute function public.guard_appointment_type_delete();

-- ---------------------------------------------------------------- reorder
-- One statement, so a reorder lands whole or not at all. Security invoker:
-- the "staff manage appointment_types" policy (clinic_config) decides who may,
-- exactly as it does for any other edit of a type.
create or replace function public.reorder_appointment_types(p_ids uuid[])
returns void
language sql
security invoker
set search_path to 'public'
as $function$
  update appointment_types
  set sort_order = array_position(p_ids, id)
  where id = any(p_ids);
$function$;

revoke all on function public.reorder_appointment_types(uuid[]) from public, anon;
grant execute on function public.reorder_appointment_types(uuid[]) to authenticated;

-- ---------------------------------------------------------------- usage
-- One row per type of the account: appointments ever (soft-deleted included,
-- because that is what blocks a delete), those from today on, waitlist
-- entries still waiting or offered, the automations whose filters name it,
-- and whether the Growth receptionist may book it.
create or replace function public.get_appointment_type_usage(p_account_id uuid)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', at.id,
    'appointments', (select count(*) from appointments a where a.appointment_type_id = at.id),
    'upcoming', (
      select count(*) from appointments a
      where a.appointment_type_id = at.id and a.deleted_at is null
        and a.status not in ('cancelled', 'no_show') and a.starts_at >= date_trunc('day', now())
    ),
    'waitlist', (
      select count(*) from waitlist_entries w
      where (w.appointment_type_id = at.id or w.offered_appointment_type_id = at.id)
        and w.status in ('waiting', 'offered')
    ),
    'automations', coalesce((
      select jsonb_agg(r.name order by r.name) from automation_rules r
      where r.account_id = at.account_id
        and (r.filters -> 'appointment_type_ids' ? at.id::text or r.filters ->> 'appointment_type_id' = at.id::text)
    ), '[]'::jsonb),
    'receptionist', exists (
      select 1 from receptionist_config c
      where c.account_id = at.account_id and at.id = any(c.bookable_appointment_type_ids)
    )
  )), '[]'::jsonb)
  from appointment_types at
  where at.account_id = p_account_id
    and public.is_account_member(p_account_id)
    and public.has_permission(p_account_id, 'clinic_config')
    and public.mfa_satisfied();
$function$;

revoke all on function public.get_appointment_type_usage(uuid) from public, anon;
grant execute on function public.get_appointment_type_usage(uuid) to authenticated;

-- ---------------------------------------------------------------- overrides
create policy "staff read appointment_type_overrides" on public.appointment_type_overrides
  for select using (public.is_account_member(account_id));

-- ---------------------------------------------------------------- web booking
-- 20260924164000's text; an archived type is left out, and types come in the
-- clinic's order rather than alphabetically.
create or replace function get_public_booking_info(p_slug text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
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
        'logo_storage_path', c.logo_storage_path, 'phone', c.phone, 'email', c.email
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

-- 20260924134128's text; the only change is that an archived type is refused,
-- for a booking page that was loaded before it was archived.
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

-- ---------------------------------------------------------------- patient app
-- 0162's text; archived types are left out, types come in the clinic's order,
-- and the per-practitioner overrides are sent (see 7 above).
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
      ) order by at.sort_order nulls last, at.name)
      from appointment_types at
      where at.account_id = v_account_id and at.online_booking_enabled = true and at.archived_at is null
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

-- 0162's text; an archived type is refused, and the practitioner's own
-- duration is used when they have one.
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
  where id = p_appointment_type_id and account_id = v_account_id and online_booking_enabled = true
    and archived_at is null;
  if v_duration is null then
    raise exception 'Appointment type not available';
  end if;

  -- The practitioner's own length for this type, as create_public_booking
  -- has applied it since 0072.
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
