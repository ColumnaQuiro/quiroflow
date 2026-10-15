-- The waitlist for a full group class (follow-up to
-- 20261015161028_group_classes.sql). Design: ClassesBooking on the QuiroFlow
-- canvas -- "Completa: apuntarse a la espera".
--
-- An entry for a class is an ordinary waitlist_entries row that names its
-- session (class_session_id). It is offered only that session's place, and
-- only when a place is free (server/utils/waitlistOffer.ts); the claim books
-- into the session, so the class's own rules (appointments_class_place) still
-- decide. An entry with no session is never offered a class place, and vice
-- versa.
--
-- Joined from the class's panel at the desk, or from online booking when the
-- class is full (join_public_class_waitlist, below).
--
-- No new patient_id: waitlist_entries already has one, and merge_patients
-- already moves it.

alter table public.waitlist_entries
  add column class_session_id uuid references public.class_sessions(id) on delete cascade;
create index waitlist_entries_class_session on public.waitlist_entries (class_session_id, created_at) where class_session_id is not null;
-- Once in the queue per class.
create unique index waitlist_entries_once_per_class on public.waitlist_entries (class_session_id, patient_id)
  where class_session_id is not null and status in ('waiting', 'offered');

-- "Apuntarme a la lista de espera" on the booking page, for a full class.
-- Anon calls it, so everything it is given is a claim, checked as
-- create_public_booking checks the same fields (20261003134946): an email and
-- a real-looking number are required; the email finds an existing record --
-- the one whose number was given first, then whose first name, then the
-- oldest -- and a record is made only when there is none, with the number as
-- its own. A number an existing record has not got is not filed against it;
-- it is kept in the entry's note for reception to check.
--
-- Returns the place in the queue.
create or replace function public.join_public_class_waitlist(
  p_slug text,
  p_session_id uuid,
  p_first_name text,
  p_last_name text,
  p_email text,
  p_phone text,
  p_country_code text default 'ES'
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_session class_sessions;
  v_type appointment_types;
  v_account uuid;
  v_phone_raw text;
  v_phone_digits text;
  v_phone_country text;
  v_phone_key text;
  v_first_name_key text;
  v_patient_id uuid;
  v_phone_on_file boolean;
  v_entry uuid;
  v_created timestamptz;
  v_taken int;
  v_position int;
begin
  select a.id into v_account from accounts a where a.slug = p_slug;
  select * into v_session from class_sessions where id = p_session_id;
  if v_account is null or v_session.id is null or v_session.account_id <> v_account
     or v_session.cancelled_at is not null or v_session.starts_at <= now()
     or not exists (select 1 from clinics c where c.id = v_session.clinic_id and c.online_booking_enabled and c.archived_at is null) then
    raise exception 'That class is not available';
  end if;
  select * into v_type from appointment_types where id = v_session.appointment_type_id;
  if v_type.id is null or not v_type.online_booking_enabled or v_type.archived_at is not null then
    raise exception 'That class is not available';
  end if;
  select count(*) into v_taken from appointments where class_session_id = v_session.id and status <> 'cancelled' and deleted_at is null;
  if v_taken < v_session.capacity then
    raise exception 'That class still has places: book one';
  end if;

  if coalesce(btrim(p_first_name), '') = '' then
    raise exception 'First name required';
  end if;
  if p_email is null or trim(p_email) = '' or position('@' in p_email) = 0 then
    raise exception 'An email address is required';
  end if;
  if p_phone is null or trim(p_phone) = '' then
    raise exception 'A phone number is required';
  end if;
  -- Same three rules as create_public_booking and looksLikePhoneNumber.
  v_phone_raw := btrim(p_phone);
  v_phone_digits := regexp_replace(v_phone_raw, '\D', '', 'g');
  v_phone_country := coalesce(p_country_code, 'ES');
  if v_phone_country = 'ES' and left(v_phone_raw, 1) = '+' and left(v_phone_digits, 2) = '34' then
    v_phone_digits := substr(v_phone_digits, 3);
    v_phone_raw := v_phone_digits;
  end if;
  if v_phone_country = 'ES' and left(v_phone_raw, 1) <> '+' then
    if length(v_phone_digits) <> 9 then
      raise exception 'That phone number does not look right';
    end if;
  elsif length(v_phone_digits) < 6 or length(v_phone_digits) > 15 then
    raise exception 'That phone number does not look right';
  end if;
  v_phone_key := case when length(v_phone_digits) >= 9 then right(v_phone_digits, 9) else v_phone_digits end;
  v_first_name_key := split_part(regexp_replace(public.unaccent_lower(btrim(p_first_name)), '\s+', ' ', 'g'), ' ', 1);

  select p.id,
         exists (
           select 1 from patient_contact_numbers c
           where c.patient_id = p.id
             and (case when length(regexp_replace(c.number, '\D', '', 'g')) >= 9
                       then right(regexp_replace(c.number, '\D', '', 'g'), 9)
                       else regexp_replace(c.number, '\D', '', 'g') end) = v_phone_key
         )
    into v_patient_id, v_phone_on_file
  from patients p
  where p.account_id = v_account and lower(p.email) = lower(trim(p_email))
  order by
    exists (
      select 1 from patient_contact_numbers c
      where c.patient_id = p.id
        and (case when length(regexp_replace(c.number, '\D', '', 'g')) >= 9
                  then right(regexp_replace(c.number, '\D', '', 'g'), 9)
                  else regexp_replace(c.number, '\D', '', 'g') end) = v_phone_key
    ) desc,
    (split_part(regexp_replace(public.unaccent_lower(btrim(p.first_name)), '\s+', ' ', 'g'), ' ', 1) = v_first_name_key) desc,
    p.created_at,
    p.id
  limit 1;
  v_phone_on_file := coalesce(v_phone_on_file, false);

  if v_type.online_bookable_by = 'new_patients' and v_patient_id is not null then
    raise exception 'This appointment type is only available to new patients';
  elsif v_type.online_bookable_by = 'existing_patients' and (v_patient_id is null or not v_phone_on_file) then
    raise exception 'This appointment type is only available to existing patients';
  end if;

  if v_patient_id is null then
    insert into patients (account_id, clinic_id, first_name, last_name, email)
    values (v_account, v_session.clinic_id, trim(p_first_name), nullif(trim(coalesce(p_last_name, '')), ''), lower(trim(p_email)))
    returning id into v_patient_id;
    insert into patient_contact_numbers (account_id, patient_id, number, country_code)
    values (v_account, v_patient_id, trim(p_phone), v_phone_country);
    v_phone_on_file := true;
  end if;

  if exists (select 1 from appointments where class_session_id = v_session.id and patient_id = v_patient_id and status <> 'cancelled' and deleted_at is null) then
    raise exception 'You already have a place in this class';
  end if;

  -- Already waiting: the same place in the queue, not a second entry.
  select id, created_at into v_entry, v_created from waitlist_entries
  where class_session_id = v_session.id and patient_id = v_patient_id and status in ('waiting', 'offered');
  if v_entry is null then
    insert into waitlist_entries (account_id, clinic_id, patient_id, appointment_type_id, practitioner_id, status, source, class_session_id, notes)
    values (
      v_account, v_session.clinic_id, v_patient_id, v_session.appointment_type_id, v_session.practitioner_id, 'waiting', 'online', v_session.id,
      case when not v_phone_on_file then format('Lista de espera online: el teléfono indicado (%s, %s) no coincide con los de la ficha. Compruébelo antes de usarlo.', trim(p_phone), v_phone_country) end
    )
    returning id, created_at into v_entry, v_created;
  end if;

  select count(*) into v_position from waitlist_entries
  where class_session_id = v_session.id and status in ('waiting', 'offered') and created_at <= v_created;
  return jsonb_build_object('position', v_position);
end;
$$;
revoke all on function public.join_public_class_waitlist(text, uuid, text, text, text, text, text) from public;
grant execute on function public.join_public_class_waitlist(text, uuid, text, text, text, text, text) to anon, authenticated;
