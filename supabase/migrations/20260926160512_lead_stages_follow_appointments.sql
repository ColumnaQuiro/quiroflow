-- Leads move through the pipeline on their own, from what happens in the
-- clinic calendar, and carry a value when nobody typed one.
--
-- Before this, the only automatic move anywhere was the public booking page
-- setting 'booked' on a lead it matched (create_public_booking). Booked at
-- the desk, in the patient app or through the API, a lead stayed in New; and
-- nothing ever set Showed or Converted, so the board's last two columns only
-- held what someone had dragged there by hand.
--
-- Now, from any path that writes an appointment:
--
--   booked    -- an appointment is made for the lead's patient.
--   showed    -- the patient attends one: checked in, or marked completed.
--   converted -- they have attended as many visits as the clinic says makes
--                a patient (accounts.lead_convert_after_visits), of the type
--                it names (lead_convert_appointment_type_id; null = any).
--
-- A lead is found by patient_id, and linked first if it has none: by email,
-- or by the last nine digits of a phone, the same match the booking page
-- makes -- because a Meta lead arrives with '34612345678' and the desk types
-- '612 34 56 78'.
--
-- Two rules keep it from doing damage:
--   * Forward only, never out of Lost. A lead further along keeps its stage,
--     and a lead someone marked Lost is theirs to reopen.
--   * Only appointments on or after the day the lead came in. A patient of
--     five years who fills in an ad form has not "shown up" because of a
--     visit in 2023; and an import of historical appointments must not sweep
--     every matching lead to Converted.
--
-- Done in the database rather than the API because check-in and "completed"
-- are written straight from the calendar with the staff member's own client
-- (components/calendar/AppointmentPanel.vue), and bookings arrive by five
-- routes. A trigger on appointments is the one place all of them pass.

alter table accounts
  -- What a lead is worth when it came in without a figure of its own -- a
  -- Meta lead never has one. Read at display time, not copied onto the lead,
  -- so changing it re-values every lead still on its default and none that
  -- has its own.
  add column lead_default_value_cents integer
    check (lead_default_value_cents is null or lead_default_value_cents >= 0),
  -- Null = never automatic; Converted stays a manual move, as before.
  add column lead_convert_after_visits integer
    check (lead_convert_after_visits is null or lead_convert_after_visits between 1 and 50),
  add column lead_convert_appointment_type_id uuid references appointment_types(id) on delete set null;

-- Moves one lead, and says so on its timeline as a drag does
-- (server/api/growth/leads/[id].patch.ts writes the same kind of entry).
-- stage_changed_at and furthest_stage are the leads trigger's to set.
create or replace function public.lead_auto_stage(p_lead_id uuid, p_account_id uuid, p_from text, p_to text, p_why text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update leads
  set stage = p_to,
      converted_at = case when p_to = 'converted' then coalesce(converted_at, now()) else converted_at end
  where id = p_lead_id;

  insert into lead_events (account_id, lead_id, kind, title, detail)
  values (
    p_account_id,
    p_lead_id,
    'stage_change',
    'Moved to ' || initcap(p_to),
    'From ' || initcap(p_from) || ' · ' || p_why
  );
end;
$$;

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

  -- Link the patient's unlinked leads.
  select nullif(lower(trim(p.email)), '') into v_email from patients p where p.id = new.patient_id;
  select coalesce(array_agg(distinct right(d, 9)), '{}') into v_phones
  from (
    select regexp_replace(p.phone, '\D', '', 'g') as d from patients p where p.id = new.patient_id
    union all
    select regexp_replace(n.number, '\D', '', 'g') from patient_contact_numbers n where n.patient_id = new.patient_id
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
        or (l.phone is not null and right(regexp_replace(l.phone, '\D', '', 'g'), 9) = any(v_phones))
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

  return new;
end;
$$;

-- Neither is an RPC. The helper takes an account id as an argument, so left
-- executable it would let any signed-in user move another clinic's leads.
revoke all on function public.lead_auto_stage(uuid, uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.leads_follow_appointments() from public, anon, authenticated;

drop trigger if exists leads_follow_appointments on appointments;
create trigger leads_follow_appointments
  after insert or update of status, checked_in_at on appointments
  for each row execute function public.leads_follow_appointments();
