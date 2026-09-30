-- The public API and the waitlist book only what is free.
--
-- 20260930141539 made the booking page and the patient app check for a clash
-- and write the appointment under one per-practitioner advisory lock. Two
-- more paths into the diary still checked in one request and wrote in
-- another:
--
-- 1. The public API (POST /appointments, PATCH /appointments/{id}). Its
--    overlap check was a PostgREST select and the insert or update a second
--    request, so parallel calls for one slot all passed the check. Six at once
--    booked six appointments.
-- 2. A waitlist claim, which checked only the offered room and never the
--    practitioner or their blocked time.
--
-- save_appointment_if_free is the check and the write in one transaction,
-- under the SAME lock key the booking functions take, so the booking page,
-- the patient app, the API and the waitlist all queue behind one another for
-- a practitioner rather than each only behind itself. It is the server's
-- function: the API and the waitlist run as the service role, and nobody
-- else may call it. Not security definer -- the service role already reads
-- and writes everything it touches, so borrowing the owner's rights would add
-- nothing but risk.
--
-- The values are the columns to set, as the API already builds them, and only
-- those: a column left out keeps its default on an insert and its value on an
-- update, exactly as the PostgREST call it replaces did. Which checks run is
-- the caller's decision, because the rules differ: the API refuses only a
-- practitioner's overlap (staff double-book on purpose, and an integration is
-- held to the clinic's own rules, not the booking page's), while a waitlist
-- claim is somebody booking themselves into a slot the clinic offered, which
-- has to be genuinely free -- room and blocked time included.
--
-- Refusals are raised with a fixed message the server maps back to the API's
-- own answer ('appointment_overlap' -> 409 conflict, with the clashing times
-- in DETAIL as JSON so the message can name them as it always has).
--
-- 3. appointments.source had no room for 'waitlist', which is what a claim
--    has always written. Every claim therefore failed the check constraint,
--    rolled the offer back to 'offered' and answered 500: nobody has ever
--    been able to take a waitlist slot. Widening a check constraint is
--    additive; nothing live writes or expects anything else.

alter table public.appointments drop constraint if exists appointments_source_check;
alter table public.appointments add constraint appointments_source_check
  check (source in ('staff', 'online', 'api', 'waitlist'));

create or replace function public.save_appointment_if_free(
  p_account_id uuid,
  p_appointment_id uuid,
  p_values jsonb,
  p_check_overlap boolean default true,
  p_check_room boolean default false,
  p_check_blocks boolean default false
)
returns uuid
language plpgsql
volatile
set search_path to 'public'
as $function$
declare
  v_allowed text[] := array[
    'patient_id', 'clinic_id', 'practitioner_id', 'practitioner_name', 'appointment_type_id', 'room_id',
    'starts_at', 'ends_at', 'status', 'note', 'external_reference', 'source', 'rescheduled'
  ];
  v_unknown text;
  v_existing appointments%rowtype;
  v_row appointments%rowtype;
  v_cols text;
  v_clash record;
  v_id uuid;
begin
  select k into v_unknown from jsonb_object_keys(p_values) k where k <> all (v_allowed) limit 1;
  if v_unknown is not null then
    raise exception 'save_appointment_if_free cannot set %', v_unknown;
  end if;

  -- The row as it will be once written: the values given over what is there
  -- now, or over nothing for a new one. Every check reads this, so a PATCH
  -- that moves only the practitioner is checked at the time the visit keeps.
  if p_appointment_id is not null then
    select * into v_existing from appointments
    where id = p_appointment_id and account_id = p_account_id and deleted_at is null;
    if not found then
      raise exception 'appointment_not_found';
    end if;
    v_row := jsonb_populate_record(v_existing, p_values);
  else
    v_row := jsonb_populate_record(null::appointments, p_values || jsonb_build_object('account_id', p_account_id));
  end if;

  if p_check_overlap or p_check_room or p_check_blocks then
    -- The key create_public_booking, create_patient_booking and
    -- reschedule_patient_appointment take (20260930141539), unassigned time
    -- queued per clinic as they queue it.
    perform pg_advisory_xact_lock(hashtext('appointment_slot'), hashtext(coalesce(v_row.practitioner_id, v_row.clinic_id)::text));
  end if;

  if p_check_overlap and v_row.practitioner_id is not null then
    select a.starts_at, a.ends_at into v_clash
    from appointments a
    where a.account_id = p_account_id
      and a.practitioner_id = v_row.practitioner_id
      -- A deleted appointment keeps status 'booked'; it holds no time.
      and a.deleted_at is null
      and a.status <> 'cancelled'
      -- Half-open: back-to-back visits do not clash.
      and a.starts_at < v_row.ends_at
      and a.ends_at > v_row.starts_at
      and (p_appointment_id is null or a.id <> p_appointment_id)
    order by a.starts_at
    limit 1;
    if found then
      raise exception 'appointment_overlap'
        using detail = jsonb_build_object('starts_at', v_clash.starts_at, 'ends_at', v_clash.ends_at)::text;
    end if;
  end if;

  if p_check_room and v_row.room_id is not null and exists (
    select 1 from appointments a
    where a.room_id = v_row.room_id
      and a.deleted_at is null
      and a.status <> 'cancelled'
      and a.starts_at < v_row.ends_at
      and a.ends_at > v_row.starts_at
      and (p_appointment_id is null or a.id <> p_appointment_id)
  ) then
    raise exception 'room_taken';
  end if;

  -- Blocks as the booking page reads them: one for this practitioner, or one
  -- naming nobody, which closes the clinic for everyone.
  if p_check_blocks and exists (
    select 1 from availability_blocks b
    where b.clinic_id = v_row.clinic_id
      and (b.practitioner_id is null or b.practitioner_id = v_row.practitioner_id)
      and b.starts_at < v_row.ends_at
      and b.ends_at > v_row.starts_at
  ) then
    raise exception 'slot_blocked';
  end if;

  select string_agg(quote_ident(k), ', ') into v_cols from jsonb_object_keys(p_values) k;

  if p_appointment_id is null then
    execute format(
      'insert into public.appointments (%1$s) select %1$s from (select ($1).*) r returning id',
      'account_id' || coalesce(', ' || v_cols, '')
    ) using v_row into v_id;
    return v_id;
  end if;

  if v_cols is not null then
    execute format(
      'update public.appointments a set (%1$s) = (select %1$s from (select ($1).*) r) where a.id = $2 and a.account_id = $3',
      v_cols
    ) using v_row, p_appointment_id, p_account_id;
  end if;
  return p_appointment_id;
end;
$function$;

revoke all on function public.save_appointment_if_free(uuid, uuid, jsonb, boolean, boolean, boolean) from public, anon, authenticated;
grant execute on function public.save_appointment_if_free(uuid, uuid, jsonb, boolean, boolean, boolean) to service_role;
