-- A care plan that changes cadence partway: "2 visits a week for 8 visits,
-- then 1 a week for 4". Until now the second half could only be set up by
-- hand once the first was over -- through the end-of-plan review or "Edit
-- plan" -- so the clinic had to remember, and the patient was chased at the
-- old cadence in between.
--
-- A plan now carries the phases still to come, in order:
--
--   [{"visits_per_period": 1, "frequency_value": 1, "frequency_unit": "week", "total_visits": 4}]
--
-- When the visit that finishes the current phase is marked done, the first of
-- them starts as an ORDINARY care_plans row, the day after that visit, with
-- the rest queued on it. That is the whole design: every reader of "the
-- patient's plan" (Care Plan Alerts, the periods row, the calendar series,
-- the staff app, segments, the receptionist) still reads one cadence at a
-- time, exactly as when a phase was started by hand, and needed no change.
--
-- A column rather than a table, as visit_markers is: no new table keyed to
-- patients for merge_patients, anonymize_patient, RLS or the two-factor
-- policy to miss.

create or replace function public.care_plan_next_phases_valid(p jsonb)
returns boolean
language plpgsql
immutable
as $function$
declare
  ph jsonb;
  n integer;
  i integer := 0;
begin
  if p is null or jsonb_typeof(p) <> 'array' then return false; end if;
  n := jsonb_array_length(p);
  if n > 6 then return false; end if;
  for ph in select value from jsonb_array_elements(p) loop
    i := i + 1;
    if jsonb_typeof(ph) <> 'object' then return false; end if;
    if jsonb_typeof(ph->'visits_per_period') is distinct from 'number'
       or (ph->>'visits_per_period')::numeric <> trunc((ph->>'visits_per_period')::numeric)
       or (ph->>'visits_per_period')::numeric not between 1 and 7 then
      return false;
    end if;
    if jsonb_typeof(ph->'frequency_value') is distinct from 'number'
       or (ph->>'frequency_value')::numeric <> trunc((ph->>'frequency_value')::numeric)
       or (ph->>'frequency_value')::numeric not between 1 and 52 then
      return false;
    end if;
    if (ph->>'frequency_unit') is null or (ph->>'frequency_unit') not in ('week', 'month') then
      return false;
    end if;
    -- No end: only the last. One before another would never finish.
    if coalesce(jsonb_typeof(ph->'total_visits'), 'null') = 'null' then
      if i < n then return false; end if;
    elsif jsonb_typeof(ph->'total_visits') <> 'number'
       or (ph->>'total_visits')::numeric <> trunc((ph->>'total_visits')::numeric)
       or (ph->>'total_visits')::numeric not between 1 and 200 then
      return false;
    end if;
  end loop;
  return true;
end;
$function$;

alter table public.care_plans
  add column next_phases jsonb not null default '[]'::jsonb
  constraint care_plans_next_phases_valid check (public.care_plan_next_phases_valid(next_phases)),
  -- A plan with no end never finishes, so nothing queued after it would start.
  add constraint care_plans_next_phases_need_an_end check (total_visits is not null or next_phases = '[]'::jsonb);

comment on column public.care_plans.next_phases is
  'Phases still to come, in order: [{visits_per_period, frequency_value, frequency_unit, total_visits}]. The first starts as a new plan when this one''s last visit is completed (care_plan_start_next_phase).';

-- ---------------------------------------------------------------------------
-- Starting the next phase. A trigger on appointments, because a visit is
-- marked done from the calendar, the visit screen, the staff app, check-out
-- and the importers alike; this is the one place all of them pass.
--
-- The plan it advances is the patient's latest (by created_at), the one
-- every reader treats as current. Its visits are counted as
-- care_plan_visit_facts counts them: completed, not deleted, on or after the
-- plan's start. The next phase starts the day after the last of them (UTC,
-- the day the counts compare against), so that visit is not counted twice.
--
-- Security definer: the person completing the visit may not be the one who
-- could write the plan (a server route, the importer), and the new plan is
-- the clinic's, not theirs. It copies the name, how it is paid and the
-- re-exam markers, as "Edit plan" does, and created_by is null: nobody made
-- it by hand.
--
-- A failure never stops the visit being marked done: it is logged and the
-- phase is left for the clinic to start by hand, as before this existed.
create or replace function public.care_plan_start_next_phase()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  cp care_plans%rowtype;
  v_done bigint;
  v_last timestamptz;
  v_next jsonb;
begin
  if new.status <> 'completed' or new.deleted_at is not null then return null; end if;
  if tg_op = 'UPDATE' and old.status = 'completed' and old.deleted_at is not distinct from new.deleted_at then return null; end if;

  begin
    select * into cp
    from care_plans
    where patient_id = new.patient_id
    order by created_at desc
    limit 1
    for update;
    if not found or cp.total_visits is null or jsonb_array_length(cp.next_phases) = 0 then return null; end if;
    if new.starts_at < cp.started_at then return null; end if;
    -- Two visits completed at once both wait on the lock above; the second
    -- then finds the phase the first started and does nothing.
    if exists (select 1 from care_plans where patient_id = new.patient_id and created_at > cp.created_at) then return null; end if;

    select count(*), max(a.starts_at) into v_done, v_last
    from appointments a
    where a.patient_id = new.patient_id
      and a.deleted_at is null
      and a.status = 'completed'
      and a.starts_at >= cp.started_at;
    if v_done < cp.total_visits then return null; end if;

    v_next := cp.next_phases -> 0;
    insert into care_plans (
      account_id, patient_id, name,
      visits_per_period, frequency_value, frequency_unit, total_visits,
      started_at, payment_kind, package_purchase_id, patient_membership_id,
      visit_markers, next_phases, created_by, created_at
    ) values (
      cp.account_id, cp.patient_id, cp.name,
      (v_next->>'visits_per_period')::smallint, (v_next->>'frequency_value')::integer, v_next->>'frequency_unit', (v_next->>'total_visits')::integer,
      (v_last at time zone 'UTC')::date + 1, cp.payment_kind, cp.package_purchase_id, cp.patient_membership_id,
      cp.visit_markers, cp.next_phases - 0, null,
      -- Strictly after the phase it follows. The default, now(), is the
      -- transaction's start: an import that completes a whole phase and the
      -- next in one transaction would give every phase the same created_at,
      -- and "the latest plan" -- here and in every reader -- would be a coin
      -- toss.
      greatest(clock_timestamp(), cp.created_at + interval '1 millisecond')
    );
  exception when others then
    raise warning 'care_plan_start_next_phase: appointment % left plan % in its phase: % (%)', new.id, cp.id, sqlerrm, sqlstate;
  end;

  return null;
end;
$function$;

-- A trigger function, not an RPC.
revoke all on function public.care_plan_start_next_phase() from public, anon, authenticated;

drop trigger if exists care_plan_start_next_phase on public.appointments;
create trigger care_plan_start_next_phase
  after insert or update of status, deleted_at on public.appointments
  for each row execute function public.care_plan_start_next_phase();
