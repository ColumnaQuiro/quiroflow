-- "Convert to patient" makes a patient record. It no longer marks the lead
-- Converted.
--
-- It used to set stage = 'converted' on the spot, usually so the front desk
-- could book the person in -- you cannot book someone with no patient
-- record. That put a stranger who had not yet visited into Converted, the
-- end of the funnel and the revenue-attributed figure, and it parked them
-- there for good: leads_follow_appointments() only moves a lead forward, so
-- the booking that followed, and the visit after it, changed nothing.
--
-- Now the button only links the patient (server/utils/leadConversion.ts),
-- and the pipeline follows the calendar as it does for everyone else:
-- an appointment moves the lead to Booked, attending it to Showed, and
-- Converted comes from accounts.lead_convert_after_visits, or by hand.

-- What the calendar already says about a lead's patient, applied at once.
-- Linking a lead to a patient who ALREADY has an appointment since the
-- lead came in would otherwise wait for the next appointment change to be
-- noticed, because the appointments trigger is what moves leads. Same
-- rules as that trigger: forward only, never out of Lost, and only
-- appointments on or after the day the lead arrived.
create or replace function public.lead_catch_up_with_appointments(p_lead_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  l record;
  v_after integer;
  v_type uuid;
  v_visits integer;
  v_attended boolean;
  v_booked boolean;
  v_to text;
begin
  select id, account_id, patient_id, stage, created_at into l
  from leads where id = p_lead_id and deleted_at is null
  for update;
  if not found then
    return null;
  end if;

  -- Callable with a staff session: only for their own clinic's leads. The
  -- service role (no auth.uid()) passes.
  if auth.uid() is not null and not is_account_member(l.account_id) then
    raise exception 'lead % is not in your account', p_lead_id using errcode = '42501';
  end if;

  if l.patient_id is null or l.stage = 'lost' then
    return l.stage;
  end if;

  select a.lead_convert_after_visits, a.lead_convert_appointment_type_id
  into v_after, v_type
  from accounts a where a.id = l.account_id;

  select
    count(*) filter (where ap.status not in ('cancelled', 'no_show')
                       and (ap.checked_in_at is not null or ap.status = 'completed')
                       and (v_type is null or ap.appointment_type_id = v_type)),
    coalesce(bool_or(ap.status not in ('cancelled', 'no_show')
                       and (ap.checked_in_at is not null or ap.status = 'completed')), false),
    coalesce(bool_or(ap.status not in ('cancelled', 'no_show')), false)
  into v_visits, v_attended, v_booked
  from appointments ap
  where ap.patient_id = l.patient_id
    and ap.deleted_at is null
    and ap.starts_at >= date_trunc('day', l.created_at);

  v_to := case
    when v_after is not null and v_visits >= v_after then 'converted'
    when v_attended then 'showed'
    when v_booked then 'booked'
  end;

  if v_to is not null and lead_stage_rank(v_to) > lead_stage_rank(l.stage) then
    perform lead_auto_stage(l.id, l.account_id, l.stage, v_to, case v_to
      when 'converted' then case when v_after = 1 then 'attended their first visit' else 'attended ' || v_visits || ' visits' end
      when 'showed' then 'checked in for an appointment'
      else 'an appointment was booked'
    end);
    return v_to;
  end if;
  return l.stage;
end;
$$;

revoke all on function public.lead_catch_up_with_appointments(uuid) from public, anon;
grant execute on function public.lead_catch_up_with_appointments(uuid) to authenticated, service_role;

-- The leads the button put in Converted. Recognised by the note it left
-- ("Converted to a patient" / "Linked to an existing patient") with no
-- "Moved to Converted" anywhere in their history -- a lead someone dragged
-- to Converted, or that reached it by attending, keeps it.
--
-- Each goes back to the stage it was at before the button (the last
-- "Moved to ..." before that note, or New), says so on its timeline, and
-- then catches up with its appointments -- which is where most of them
-- land, since the button was pressed in order to book them.
do $$
declare
  r record;
  v_before text;
begin
  for r in
    select l.id, l.account_id, n.created_at as converted_note_at
    from leads l
    join lateral (
      select e.created_at from lead_events e
      where e.lead_id = l.id
        and e.kind = 'note'
        and e.title in ('Converted to a patient', 'Linked to an existing patient')
      order by e.created_at
      limit 1
    ) n on true
    where l.stage = 'converted'
      and l.deleted_at is null
      and not exists (
        select 1 from lead_events e
        where e.lead_id = l.id and e.kind = 'stage_change' and e.title like 'Moved to Converted%'
      )
  loop
    -- "Moved to New Lead", "Moved to Booked": the first word is the stage.
    select lower(substring(e.title from '^Moved to (\w+)'))
    into v_before
    from lead_events e
    where e.lead_id = r.id
      and e.kind = 'stage_change'
      and e.created_at <= r.converted_note_at
    order by e.created_at desc
    limit 1;
    if v_before is null or lead_stage_rank(v_before) < 0 and v_before <> 'lost' then
      v_before := 'new';
    end if;

    -- furthest_stage is set explicitly: the leads trigger only ever moves it
    -- forward, and 'converted' is exactly what is being taken back.
    update leads
    set stage = v_before,
        furthest_stage = case when lead_stage_rank(v_before) >= 0 then v_before else 'new' end,
        converted_at = null
    where id = r.id;

    insert into lead_events (account_id, lead_id, kind, title, detail)
    values (
      r.account_id,
      r.id,
      'stage_change',
      'Moved to ' || initcap(v_before),
      'From Converted · becoming a patient no longer counts as converted'
    );

    perform lead_catch_up_with_appointments(r.id);
  end loop;
end;
$$;
