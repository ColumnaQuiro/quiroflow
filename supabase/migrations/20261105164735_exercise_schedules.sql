-- Exercises by visit: a practitioner plans a patient's home exercises ahead,
-- as steps that each start at a visit of their care -- "from visit 1 these,
-- from visit 6 these, from visit 24 (maintenance) these" -- and each step is
-- given to the patient by itself when they reach that visit.
--
--   exercise_schedules            the clinic's reusable templates ("pautas"),
--                                 kept in Settings > Exercise Library
--   patient_exercise_schedules    one patient's copy, adjusted for them; at
--                                 most one active (ended_at null) at a time
--   patient_exercises.patient_schedule_id
--                                 which schedule gave an assignment, so a
--                                 step replaces only what the schedule gave
--                                 and never something assigned by hand
--
-- Visits are counted, not dated, as the care plan's re-exam markers are: the
-- Nth visit the patient has ATTENDED (completed or checked in -- the rule the
-- lead stages use) since counts_from, which the record fills with the start
-- of the current care plan. A step is due once that many visits are
-- attended, so the patient leaves visit 6 with visit 6's exercises. Counting
-- from a date of the schedule's own, rather than reading the latest
-- care_plans row, means "Edit plan" (which starts a new care_plans row)
-- does not restart the count halfway through.
--
-- Steps are a jsonb column, like care_plans.visit_markers: a schedule is
-- saved and copied as a whole, and nothing points at a step. Each one:
--
--   {"id": "<uuid>", "from_visit": 6, "label": "Semana 2",
--    "keep_previous": false,
--    "items": [{"exercise_id": "<uuid>", "sets": 2, "reps": "10",
--               "frequency": "A diario", "notes": null, "progressive": false}],
--    "applied_at": "<timestamptz>"}      -- the patient's copy only
--
-- A step replaces the exercises the schedule gave before it unless it keeps
-- them (keep_previous); one that is in both carries on with the new dose,
-- keeping its ticks. Giving the steps is apply_patient_exercise_schedule,
-- called when the practitioner saves and from the same-day cron every 15
-- minutes after that (apply_due_exercise_schedules), which also sends the
-- patient's "Nuevos ejercicios para casa" push. No new cron job to schedule.

create or replace function public.exercise_schedule_steps_valid(p jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $function$
declare
  s jsonb;
  i jsonb;
  uuid_re constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
begin
  if p is null or jsonb_typeof(p) <> 'array' or jsonb_array_length(p) > 12 then
    return false;
  end if;
  for s in select value from jsonb_array_elements(p) loop
    if jsonb_typeof(s) <> 'object' then return false; end if;
    if jsonb_typeof(s->'id') is distinct from 'string' or (s->>'id') !~* uuid_re then return false; end if;
    if jsonb_typeof(s->'from_visit') is distinct from 'number'
       or (s->>'from_visit')::numeric <> trunc((s->>'from_visit')::numeric)
       or (s->>'from_visit')::numeric not between 1 and 999 then
      return false;
    end if;
    if coalesce(jsonb_typeof(s->'label'), 'null') <> 'null'
       and (jsonb_typeof(s->'label') <> 'string' or length(s->>'label') > 40) then
      return false;
    end if;
    if coalesce(jsonb_typeof(s->'keep_previous'), 'boolean') <> 'boolean' then return false; end if;
    if coalesce(jsonb_typeof(s->'applied_at'), 'null') not in ('null', 'string') then return false; end if;
    if jsonb_typeof(s->'items') is distinct from 'array'
       or jsonb_array_length(s->'items') not between 1 and 30 then
      return false;
    end if;
    for i in select value from jsonb_array_elements(s->'items') loop
      if jsonb_typeof(i) <> 'object' then return false; end if;
      if jsonb_typeof(i->'exercise_id') is distinct from 'string' or (i->>'exercise_id') !~* uuid_re then return false; end if;
      if coalesce(jsonb_typeof(i->'sets'), 'null') <> 'null'
         and (jsonb_typeof(i->'sets') <> 'number'
              or (i->>'sets')::numeric <> trunc((i->>'sets')::numeric)
              or (i->>'sets')::numeric not between 1 and 99) then
        return false;
      end if;
      if coalesce(jsonb_typeof(i->'reps'), 'null') not in ('null', 'string')
         or coalesce(jsonb_typeof(i->'frequency'), 'null') not in ('null', 'string')
         or coalesce(jsonb_typeof(i->'notes'), 'null') not in ('null', 'string')
         or coalesce(jsonb_typeof(i->'progressive'), 'boolean') <> 'boolean' then
        return false;
      end if;
    end loop;
  end loop;
  return true;
end;
$function$;

create table public.exercise_schedules (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  description text,
  steps jsonb not null default '[]'::jsonb
    constraint exercise_schedules_steps_valid check (public.exercise_schedule_steps_valid(steps)),
  created_by uuid references public.team_members(id) on delete set null,
  created_at timestamptz not null default now()
);
create index exercise_schedules_account_id_idx on public.exercise_schedules (account_id);
create index exercise_schedules_created_by_idx on public.exercise_schedules (created_by);

create table public.patient_exercise_schedules (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  -- The template it was copied from, if any; a copy, so editing or deleting
  -- the template changes nothing here.
  schedule_id uuid references public.exercise_schedules(id) on delete set null,
  name text not null check (length(trim(name)) > 0),
  counts_from date not null,
  steps jsonb not null
    constraint patient_exercise_schedules_steps_valid check (public.exercise_schedule_steps_valid(steps)),
  -- The visit the next step not yet given starts at; null once all are given.
  -- Kept by the functions below, so the cron reads only schedules with
  -- something left to give.
  next_from_visit integer,
  created_by uuid references public.team_members(id) on delete set null,
  created_at timestamptz not null default now(),
  ended_at timestamptz
);
create index patient_exercise_schedules_account_id_idx on public.patient_exercise_schedules (account_id);
create index patient_exercise_schedules_patient_id_idx on public.patient_exercise_schedules (patient_id);
create index patient_exercise_schedules_schedule_id_idx on public.patient_exercise_schedules (schedule_id);
create index patient_exercise_schedules_created_by_idx on public.patient_exercise_schedules (created_by);
create unique index patient_exercise_schedules_one_active
  on public.patient_exercise_schedules (patient_id) where ended_at is null;
create index patient_exercise_schedules_pending_idx
  on public.patient_exercise_schedules (next_from_visit) where ended_at is null and next_from_visit is not null;

alter table public.patient_exercises
  add column patient_schedule_id uuid references public.patient_exercise_schedules(id) on delete set null;
create index patient_exercises_patient_schedule_id_idx on public.patient_exercises (patient_schedule_id);

alter table public.exercise_schedules enable row level security;
alter table public.patient_exercise_schedules enable row level security;

create policy "staff manage exercise_schedules" on public.exercise_schedules for all
  using (account_id in (select public.my_member_account_ids()))
  with check (account_id in (select public.my_member_account_ids()));

-- Staff reach a patient's schedule as they reach the patient's exercises.
-- Patients never read it: they see the exercises it gives them.
create policy "staff manage patient_exercise_schedules" on public.patient_exercise_schedules for all
  using (
    account_id in (select public.my_member_account_ids())
    and ((select public.my_patients_scope()) = 'all'
      or ((select public.my_patients_scope()) = 'own' and patient_id in (select public.my_own_patient_ids())))
  )
  with check (
    account_id in (select public.my_member_account_ids())
    and ((select public.my_patients_scope()) = 'all'
      or ((select public.my_patients_scope()) = 'own' and patient_id in (select public.my_own_patient_ids())))
    and exists (select 1 from public.patients p where p.id = patient_id and p.account_id = patient_exercise_schedules.account_id)
  );

select public.require_two_factor_on('public.exercise_schedules');
select public.require_two_factor_on('public.patient_exercise_schedules');
select public.grant_data_api('public.exercise_schedules');
select public.grant_data_api('public.patient_exercise_schedules');

-- A patient's exercise plan is clinical: every change goes on the audit trail.
do $$
declare
  v_types text[];
begin
  select array_agg(distinct m[1]) into v_types
  from pg_constraint c, regexp_matches(pg_get_constraintdef(c.oid), '([a-z][a-z_]*)', 'g') m
  where c.conname = 'audit_logs_entity_type_check' and c.conrelid = 'public.audit_logs'::regclass
    and m[1] not in ('entity_type', 'text');
  v_types := array(select distinct x from unnest(coalesce(v_types, '{}') || array['exercise_schedule']) x order by 1);

  alter table public.audit_logs drop constraint audit_logs_entity_type_check;
  execute format('alter table public.audit_logs add constraint audit_logs_entity_type_check check (entity_type = any (%L::text[]))', v_types);
end;
$$;

create trigger trg_audit_patient_exercise_schedules after insert or update or delete on public.patient_exercise_schedules
  for each row execute function public.fn_audit_log('exercise_schedule', 'next_from_visit');

-- Visits attended since a date: completed or checked in, not deleted.
create or replace function public.exercise_schedule_attended_visits(p_patient_id uuid, p_counts_from date)
returns integer
language sql
stable
security definer
set search_path = ''
as $function$
  select count(*)::integer
  from public.appointments a
  where a.patient_id = p_patient_id
    and a.deleted_at is null
    and a.starts_at >= p_counts_from
    and (a.status = 'completed' or a.checked_in_at is not null);
$function$;
revoke all on function public.exercise_schedule_attended_visits(uuid, date) from public, anon, authenticated;

-- Gives every step of one patient schedule that is due and not yet given,
-- and returns the ids of the patient_exercises it created (for the push).
--
-- Several steps due at once (a schedule set up halfway through care) are
-- worked out together and only the result is written, so nothing is created
-- and ended in the same moment. The starting point is what the schedule has
-- given that is still on, so an exercise the practitioner removed by hand is
-- not put back by a step that keeps the previous ones.
--
-- SECURITY DEFINER because the count has to see every visit, including ones
-- with a colleague an 'own'-calendar practitioner cannot read (the reason
-- care_plan_visit_facts is). With a signed-in caller it makes the checks RLS
-- would; the service role (the cron) has no auth.uid() and passes.
create or replace function public.apply_patient_exercise_schedule(p_id uuid)
returns uuid[]
language plpgsql
security definer
set search_path = ''
as $function$
declare
  s public.patient_exercise_schedules%rowtype;
  v_attended integer;
  v_desired jsonb;
  v_steps jsonb;
  v_step record;
  v_due boolean := false;
  v_added uuid[];
begin
  select * into s from public.patient_exercise_schedules where id = p_id and ended_at is null for update;
  if not found then
    return '{}'::uuid[];
  end if;
  if auth.uid() is not null then
    if not public.mfa_satisfied() then
      raise exception 'Two-factor authentication required';
    end if;
    if s.account_id not in (select public.my_member_account_ids())
       or not (public.my_patients_scope() = 'all'
               or (public.my_patients_scope() = 'own' and s.patient_id in (select public.my_own_patient_ids()))) then
      raise exception 'Exercise schedule not found';
    end if;
  end if;

  v_attended := public.exercise_schedule_attended_visits(s.patient_id, s.counts_from);

  select coalesce(jsonb_agg(jsonb_build_object(
           'exercise_id', pe.exercise_id, 'sets', pe.sets, 'reps', pe.reps, 'frequency', pe.frequency,
           'notes', pe.notes, 'progressive', pe.progressive)), '[]'::jsonb)
  into v_desired
  from public.patient_exercises pe
  where pe.patient_schedule_id = s.id and pe.ended_at is null;

  v_steps := s.steps;
  for v_step in
    select st.value as step, st.ord
    from jsonb_array_elements(s.steps) with ordinality as st(value, ord)
    where coalesce(jsonb_typeof(st.value->'applied_at'), 'null') = 'null'
      and (st.value->>'from_visit')::integer <= v_attended
    order by (st.value->>'from_visit')::integer, st.ord
  loop
    v_due := true;
    if coalesce((v_step.step->>'keep_previous')::boolean, false) then
      -- The new step's dose wins for an exercise in both.
      select coalesce(jsonb_agg(d.value), '[]'::jsonb) || (v_step.step->'items')
      into v_desired
      from jsonb_array_elements(v_desired) d
      where not exists (
        select 1 from jsonb_array_elements(v_step.step->'items') n
        where n.value->>'exercise_id' = d.value->>'exercise_id'
      );
    else
      v_desired := v_step.step->'items';
    end if;
    v_steps := jsonb_set(v_steps, array[(v_step.ord - 1)::text, 'applied_at'], to_jsonb(now()));
  end loop;

  if v_due then
    update public.patient_exercises pe
    set ended_at = now()
    where pe.patient_schedule_id = s.id
      and pe.ended_at is null
      and not exists (select 1 from jsonb_array_elements(v_desired) d where (d.value->>'exercise_id')::uuid = pe.exercise_id);

    update public.patient_exercises pe
    set sets = nullif(d.value->>'sets', '')::integer,
        reps = nullif(btrim(d.value->>'reps'), ''),
        frequency = nullif(btrim(d.value->>'frequency'), ''),
        notes = nullif(btrim(d.value->>'notes'), ''),
        progressive = coalesce((d.value->>'progressive')::boolean, false)
    from jsonb_array_elements(v_desired) d
    where pe.patient_schedule_id = s.id
      and pe.ended_at is null
      and pe.exercise_id = (d.value->>'exercise_id')::uuid;

    -- One the patient already has on (given by hand, or twice in a step) is
    -- not given again; one no longer in the clinic's library is skipped.
    with wanted as (
      select distinct on ((d.value->>'exercise_id')::uuid) (d.value->>'exercise_id')::uuid as exercise_id, d.value as item
      from jsonb_array_elements(v_desired) d
      order by (d.value->>'exercise_id')::uuid
    ),
    ins as (
      insert into public.patient_exercises (account_id, patient_id, exercise_id, sets, reps, frequency, notes, progressive, assigned_by, patient_schedule_id)
      select s.account_id, s.patient_id, w.exercise_id,
             nullif(w.item->>'sets', '')::integer, nullif(btrim(w.item->>'reps'), ''), nullif(btrim(w.item->>'frequency'), ''),
             nullif(btrim(w.item->>'notes'), ''), coalesce((w.item->>'progressive')::boolean, false),
             s.created_by, s.id
      from wanted w
      join public.exercises e on e.id = w.exercise_id and e.account_id = s.account_id
      where not exists (
        select 1 from public.patient_exercises pe
        where pe.patient_id = s.patient_id and pe.exercise_id = w.exercise_id and pe.ended_at is null
      )
      returning id
    )
    select array_agg(id) into v_added from ins;
  end if;

  update public.patient_exercise_schedules
  set steps = v_steps,
      next_from_visit = (
        select min((st.value->>'from_visit')::integer)
        from jsonb_array_elements(v_steps) st
        where coalesce(jsonb_typeof(st.value->'applied_at'), 'null') = 'null'
      )
  where id = s.id;

  return coalesce(v_added, '{}'::uuid[]);
end;
$function$;
revoke all on function public.apply_patient_exercise_schedule(uuid) from public, anon;
grant execute on function public.apply_patient_exercise_schedule(uuid) to authenticated;

-- Saves a patient's schedule and gives whatever is already due, in one go.
-- p_id null starts a new one (ending any the patient had on); otherwise the
-- active one is edited. A step already given keeps its applied_at whatever
-- the client sends -- matched by the step's id -- so an edit never gives a
-- step twice. Returns {id, added}: added are the new patient_exercises, for
-- the patient's push. Security invoker: the writes run under the caller's
-- RLS and two-factor, as the table writes it replaces would.
create or replace function public.save_patient_exercise_schedule(
  p_account_id uuid,
  p_patient_id uuid,
  p_id uuid,
  p_schedule_id uuid,
  p_name text,
  p_counts_from date,
  p_steps jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_id uuid;
  v_old jsonb;
  v_steps jsonb;
  v_previous uuid;
begin
  if length(trim(coalesce(p_name, ''))) = 0 then
    raise exception 'A schedule needs a name';
  end if;
  if p_counts_from is null then
    raise exception 'A schedule needs a date to count visits from';
  end if;
  if p_id is not null then
    select steps into v_old from public.patient_exercise_schedules where id = p_id and patient_id = p_patient_id and ended_at is null;
    if not found then
      raise exception 'Exercise schedule not found';
    end if;
  end if;

  select coalesce(jsonb_agg(
           (st.value - 'applied_at') || coalesce(
             (select jsonb_build_object('applied_at', o.value->'applied_at')
              from jsonb_array_elements(coalesce(v_old, '[]'::jsonb)) o
              where o.value->>'id' = st.value->>'id' and coalesce(jsonb_typeof(o.value->'applied_at'), 'null') = 'string'
              limit 1),
             '{}'::jsonb)
           order by st.ord), '[]'::jsonb)
  into v_steps
  from jsonb_array_elements(coalesce(p_steps, '[]'::jsonb)) with ordinality as st(value, ord);

  if p_id is null then
    update public.patient_exercise_schedules set ended_at = now() where patient_id = p_patient_id and ended_at is null
    returning id into v_previous;
    insert into public.patient_exercise_schedules (account_id, patient_id, schedule_id, name, counts_from, steps, created_by)
    values (
      p_account_id, p_patient_id, p_schedule_id, trim(p_name), p_counts_from, v_steps,
      (select tm.id from public.team_members tm where tm.account_id = p_account_id and tm.user_id = auth.uid() limit 1)
    )
    returning id into v_id;
    -- A new schedule takes over what the one before it gave and is still on
    -- (care moving on to maintenance), so its first step replaces those
    -- rather than leaving them behind. Exercises given by hand stay put.
    if v_previous is not null then
      update public.patient_exercises set patient_schedule_id = v_id
      where patient_schedule_id = v_previous and ended_at is null;
    end if;
  else
    update public.patient_exercise_schedules
    set name = trim(p_name), counts_from = p_counts_from, steps = v_steps
    where id = p_id
    returning id into v_id;
  end if;

  return jsonb_build_object('id', v_id, 'added', to_jsonb(public.apply_patient_exercise_schedule(v_id)));
end;
$function$;
revoke all on function public.save_patient_exercise_schedule(uuid, uuid, uuid, uuid, text, date, jsonb) from public, anon;
grant execute on function public.save_patient_exercise_schedule(uuid, uuid, uuid, uuid, text, date, jsonb) to authenticated;

-- How many visits a patient schedule has counted so far, for the record.
create or replace function public.patient_exercise_schedule_visits(p_id uuid)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  s public.patient_exercise_schedules%rowtype;
begin
  if not public.mfa_satisfied() then
    raise exception 'Two-factor authentication required';
  end if;
  select * into s from public.patient_exercise_schedules
  where id = p_id
    and account_id in (select public.my_member_account_ids())
    and (public.my_patients_scope() = 'all'
         or (public.my_patients_scope() = 'own' and patient_id in (select public.my_own_patient_ids())));
  if not found then
    return null;
  end if;
  return public.exercise_schedule_attended_visits(s.patient_id, s.counts_from);
end;
$function$;
revoke all on function public.patient_exercise_schedule_visits(uuid) from public, anon;
grant execute on function public.patient_exercise_schedule_visits(uuid) to authenticated;

-- The cron's pass: every active schedule with a step left whose visit has
-- been reached, given. One row per schedule that gave anything. Service role
-- only.
create or replace function public.apply_due_exercise_schedules()
returns table (patient_schedule_id uuid, added uuid[])
language plpgsql
security definer
set search_path = ''
as $function$
declare
  r record;
  v_added uuid[];
begin
  for r in
    select s.id
    from public.patient_exercise_schedules s
    where s.ended_at is null
      and s.next_from_visit is not null
      and public.exercise_schedule_attended_visits(s.patient_id, s.counts_from) >= s.next_from_visit
  loop
    v_added := public.apply_patient_exercise_schedule(r.id);
    patient_schedule_id := r.id;
    added := v_added;
    return next;
  end loop;
end;
$function$;
revoke all on function public.apply_due_exercise_schedules() from public, anon, authenticated;
grant execute on function public.apply_due_exercise_schedules() to service_role;

-- merge_patients moves every patient_id table by hand and then deletes the
-- duplicate (CLAUDE.md). Re-created from 20261023093754 with
-- patient_exercise_schedules moved beside patient_exercises.
create or replace function merge_patients(p_survivor_id uuid, p_duplicate_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_dup_account_id uuid;
  v_moved jsonb := '{}'::jsonb;
  v_count int;
  v_dup_external_reference text;
begin
  if p_survivor_id = p_duplicate_id then
    raise exception 'Cannot merge a patient into itself';
  end if;

  select account_id into v_account_id from patients where id = p_survivor_id;
  select account_id into v_dup_account_id from patients where id = p_duplicate_id;

  if v_account_id is null or v_dup_account_id is null then
    raise exception 'Both patients must exist';
  end if;
  -- Never merge across accounts: that would move one clinic's clinical and
  -- financial records into another's.
  if v_account_id <> v_dup_account_id then
    raise exception 'Both patients must belong to the same account';
  end if;
  if not is_account_member(v_account_id) then
    raise exception 'Not a member of this account';
  end if;
  if not has_permission(v_account_id, 'patients_delete_merge') then
    raise exception 'Missing permission: patients_delete_merge';
  end if;

  -- Ownership of bonos moves first, so the share cleanup below can see which
  -- bonos the survivor ends up owning.
  update package_purchases set patient_id = p_survivor_id where patient_id = p_duplicate_id;
  get diagnostics v_count = row_count;
  v_moved := v_moved || jsonb_build_object('package_purchases', v_count);

  -- `package_purchase_shares` is unique on (package_purchase_id, patient_id),
  -- and two rows of the duplicate's would now violate it or be meaningless:
  -- a bono the survivor already shares, and a bono the survivor now owns
  -- outright (you do not share a bono with yourself). Drop those, move the
  -- rest.
  delete from package_purchase_shares s
  where s.patient_id = p_duplicate_id
    and (
      exists (select 1 from package_purchase_shares o
               where o.package_purchase_id = s.package_purchase_id and o.patient_id = p_survivor_id)
      or exists (select 1 from package_purchases pp
                  where pp.id = s.package_purchase_id and pp.patient_id = p_survivor_id)
    );
  update package_purchase_shares set patient_id = p_survivor_id where patient_id = p_duplicate_id;
  get diagnostics v_count = row_count;
  v_moved := v_moved || jsonb_build_object('package_purchase_shares', v_count);

  -- Stripe allows one customer per patient per account. If the survivor
  -- already has one, keep it -- it is the one any saved card and active
  -- payment schedule is attached to -- and let the duplicate's row go.
  if exists (select 1 from patient_stripe_customers where patient_id = p_survivor_id and account_id = v_account_id) then
    delete from patient_stripe_customers where patient_id = p_duplicate_id;
  else
    update patient_stripe_customers set patient_id = p_survivor_id where patient_id = p_duplicate_id;
  end if;

  update account_credits set patient_id = p_survivor_id where patient_id = p_duplicate_id;
  get diagnostics v_count = row_count;
  v_moved := v_moved || jsonb_build_object('account_credits', v_count);

  update appointments set patient_id = p_survivor_id where patient_id = p_duplicate_id;
  get diagnostics v_count = row_count;
  v_moved := v_moved || jsonb_build_object('appointments', v_count);

  update invoices set patient_id = p_survivor_id where patient_id = p_duplicate_id;
  get diagnostics v_count = row_count;
  v_moved := v_moved || jsonb_build_object('invoices', v_count);

  -- The money itself. `payments.patient_id` is `on delete cascade`, so before
  -- this line the delete at the end of the function destroyed every payment
  -- the duplicate held -- silently, and after reporting the merge a success.
  update payments set patient_id = p_survivor_id where patient_id = p_duplicate_id;
  get diagnostics v_count = row_count;
  v_moved := v_moved || jsonb_build_object('payments', v_count);

  -- Facturas follow their payments onto the survivor. No huella is affected:
  -- the patient is not one of the hashed fields, and factura_records is keyed
  -- by factura, not by patient.
  update facturas set patient_id = p_survivor_id where patient_id = p_duplicate_id;
  get diagnostics v_count = row_count;
  v_moved := v_moved || jsonb_build_object('facturas', v_count);

  update package_sessions set patient_id = p_survivor_id where patient_id = p_duplicate_id;
  get diagnostics v_count = row_count;
  v_moved := v_moved || jsonb_build_object('package_sessions', v_count);

  update care_plans set patient_id = p_survivor_id where patient_id = p_duplicate_id;
  update patient_exercises set patient_id = p_survivor_id where patient_id = p_duplicate_id;
  -- One active exercise schedule per person: the survivor's carries on, the
  -- duplicate's ends (and is kept, ended, with its history).
  if exists (select 1 from patient_exercise_schedules where patient_id = p_survivor_id and ended_at is null) then
    update patient_exercise_schedules set ended_at = now() where patient_id = p_duplicate_id and ended_at is null;
  end if;
  update patient_exercise_schedules set patient_id = p_survivor_id where patient_id = p_duplicate_id;
  update patient_push_log set patient_id = p_survivor_id where patient_id = p_duplicate_id;
  update contact_log set patient_id = p_survivor_id where patient_id = p_duplicate_id;
  update patient_app_messages set patient_id = p_survivor_id where patient_id = p_duplicate_id;
  update patient_contact_numbers set patient_id = p_survivor_id where patient_id = p_duplicate_id;
  update patient_memberships set patient_id = p_survivor_id where patient_id = p_duplicate_id;
  update payment_schedules set patient_id = p_survivor_id where patient_id = p_duplicate_id;
  update photo_upload_tokens set patient_id = p_survivor_id where patient_id = p_duplicate_id;
  update waitlist_entries set patient_id = p_survivor_id where patient_id = p_duplicate_id;
  update whatsapp_messages set patient_id = p_survivor_id where patient_id = p_duplicate_id;

  -- Automation runs follow the person: a patient halfway through a follow-up
  -- sequence carries on from where they were, on the surviving record, rather
  -- than having the run (and its history) cascade away with the duplicate.
  update automation_sequence_runs set patient_id = p_survivor_id where patient_id = p_duplicate_id;
  get diagnostics v_count = row_count;
  v_moved := v_moved || jsonb_build_object('automation_sequence_runs', v_count);

  -- Mi día tasks an automation left about this person stay with the person.
  update staff_tasks set patient_id = p_survivor_id where patient_id = p_duplicate_id;
  get diagnostics v_count = row_count;
  v_moved := v_moved || jsonb_build_object('staff_tasks', v_count);

  -- The birthday guard is unique per (rule, patient, day). A day both records
  -- were already greeted on keeps the survivor's row; the rest move, so a
  -- merge on someone's birthday does not greet them a second time.
  delete from automation_birthday_sends d
   where d.patient_id = p_duplicate_id
     and exists (select 1 from automation_birthday_sends s
                  where s.patient_id = p_survivor_id and s.rule_id = d.rule_id and s.local_date = d.local_date);
  update automation_birthday_sends set patient_id = p_survivor_id where patient_id = p_duplicate_id;

  -- These three are `on delete set null`, so they outlive the duplicate
  -- either way -- but with the link to the person cut. A lead that converted
  -- would stop knowing which patient it became, and a review request would
  -- stop knowing who it was sent to. Same reasoning as whatsapp_messages
  -- above, which has always been moved despite being set null too.
  update email_messages set patient_id = p_survivor_id where patient_id = p_duplicate_id;
  update leads set patient_id = p_survivor_id where patient_id = p_duplicate_id;
  update review_requests set patient_id = p_survivor_id where patient_id = p_duplicate_id;

  update patient_docs set patient_id = p_survivor_id where patient_id = p_duplicate_id;
  get diagnostics v_count = row_count;
  v_moved := v_moved || jsonb_build_object('patient_docs', v_count);

  update patient_files set patient_id = p_survivor_id where patient_id = p_duplicate_id;
  get diagnostics v_count = row_count;
  v_moved := v_moved || jsonb_build_object('patient_files', v_count);

  -- Letters (patient_letters, 20261022185121) arrive in their own branch,
  -- which restates this function too; named only once the table exists, so
  -- whichever of the two applies second keeps both.
  if to_regclass('public.patient_letters') is not null then
    execute 'update public.patient_letters set patient_id = $1 where patient_id = $2' using p_survivor_id, p_duplicate_id;
    get diagnostics v_count = row_count;
    v_moved := v_moved || jsonb_build_object('patient_letters', v_count);
  end if;

  update posture_assessments set patient_id = p_survivor_id where patient_id = p_duplicate_id;
  get diagnostics v_count = row_count;
  v_moved := v_moved || jsonb_build_object('posture_assessments', v_count);

  -- learn_sends arrives in its own migration, which redefines this function
  -- too; whichever lands second keeps both by naming the other's table only
  -- once it exists.
  if to_regclass('public.learn_sends') is not null then
    execute 'update public.learn_sends set patient_id = $1 where patient_id = $2' using p_survivor_id, p_duplicate_id;
    get diagnostics v_count = row_count;
    v_moved := v_moved || jsonb_build_object('learn_sends', v_count);
  end if;

  -- Other patients pointing AT the duplicate -- a child whose tutor is the
  -- duplicate record, someone the duplicate referred. These FKs are
  -- `on delete set null`, so leaving them would silently orphan a minor's
  -- tutor link. Repoint them, except where that would make the survivor its
  -- own tutor or its own referrer.
  update patients set tutor_patient_id = p_survivor_id
   where tutor_patient_id = p_duplicate_id and id <> p_survivor_id;
  update patients set tutor_patient_id = null
   where id = p_survivor_id and tutor_patient_id = p_duplicate_id;
  update patients set referred_by_patient_id = p_survivor_id
   where referred_by_patient_id = p_duplicate_id and id <> p_survivor_id;
  update patients set referred_by_patient_id = null
   where id = p_survivor_id and referred_by_patient_id = p_duplicate_id;

  -- Family links (patient_relations, 20261021171628), stored both ways. The
  -- duplicate's become the survivor's: a link between the two records
  -- themselves goes, and so does one the survivor already has to the same
  -- person, which the unique pair would refuse.
  delete from patient_relations
   where (patient_id = p_duplicate_id and related_patient_id = p_survivor_id)
      or (patient_id = p_survivor_id and related_patient_id = p_duplicate_id);
  delete from patient_relations d
   where d.patient_id = p_duplicate_id
     and exists (select 1 from patient_relations s where s.patient_id = p_survivor_id and s.related_patient_id = d.related_patient_id);
  delete from patient_relations d
   where d.related_patient_id = p_duplicate_id
     and exists (select 1 from patient_relations s where s.related_patient_id = p_survivor_id and s.patient_id = d.patient_id);
  update patient_relations set patient_id = p_survivor_id where patient_id = p_duplicate_id;
  get diagnostics v_count = row_count;
  v_moved := v_moved || jsonb_build_object('patient_relations', v_count);
  update patient_relations set related_patient_id = p_survivor_id where related_patient_id = p_duplicate_id;

  -- Facturas addressed to the duplicate as a minor's tutor (recipient_patient_id,
  -- 20261021173018) are addressed to the survivor. Not a foreign key, so
  -- nothing would have stopped the delete below from leaving them pointing at
  -- a record that no longer exists.
  update facturas set recipient_patient_id = p_survivor_id where recipient_patient_id = p_duplicate_id;
  get diagnostics v_count = row_count;
  v_moved := v_moved || jsonb_build_object('facturas_addressed', v_count);

  -- Third-party cover and what third parties owe for the duplicate's visits
  -- (20261023093754). The charges are RESTRICT, so leaving them here would
  -- fail the delete below rather than lose them; the cover would cascade.
  update patient_third_parties set patient_id = p_survivor_id where patient_id = p_duplicate_id;
  get diagnostics v_count = row_count;
  v_moved := v_moved || jsonb_build_object('patient_third_parties', v_count);
  update third_party_charges set patient_id = p_survivor_id where patient_id = p_duplicate_id;
  get diagnostics v_count = row_count;
  v_moved := v_moved || jsonb_build_object('third_party_charges', v_count);

  -- Reasons for stopping care (patient_care_stops, 20261022171626) are the
  -- person's history: the duplicate's join the survivor's.
  update patient_care_stops set patient_id = p_survivor_id where patient_id = p_duplicate_id;
  get diagnostics v_count = row_count;
  v_moved := v_moved || jsonb_build_object('patient_care_stops', v_count);

  -- Who follows up the patient on Recalls (recall_assignments,
  -- 20261022185125): one row per patient, so of the two records' choices
  -- the more recent one is kept and becomes the survivor's.
  delete from recall_assignments d
   where d.patient_id = p_duplicate_id
     and exists (select 1 from recall_assignments s where s.patient_id = p_survivor_id and s.assigned_at >= d.assigned_at);
  delete from recall_assignments s
   where s.patient_id = p_survivor_id
     and exists (select 1 from recall_assignments d where d.patient_id = p_duplicate_id);
  update recall_assignments set patient_id = p_survivor_id where patient_id = p_duplicate_id;
  get diagnostics v_count = row_count;
  v_moved := v_moved || jsonb_build_object('recall_assignments', v_count);

  -- Custom fields (patient_attribute_values, 20261023053614), one answer per
  -- patient and field. As for the columns below, the survivor keeps the
  -- answers it already has and only its blanks are filled from the
  -- duplicate's.
  delete from patient_attribute_values d
   where d.patient_id = p_duplicate_id
     and exists (select 1 from patient_attribute_values s where s.patient_id = p_survivor_id and s.attribute_id = d.attribute_id);
  update patient_attribute_values set patient_id = p_survivor_id where patient_id = p_duplicate_id;
  get diagnostics v_count = row_count;
  v_moved := v_moved || jsonb_build_object('patient_attribute_values', v_count);

  -- external_reference is unique per account (patients_external_reference_uniq)
  -- and the duplicate is only deleted at the end, so copying its reference
  -- onto the survivor below collided with the duplicate's own copy. That is
  -- the commonest pair there is -- a record made at the front desk and the
  -- PracticeHub import of the same person -- and the merge refused it with
  -- "duplicate key value". Take the reference off the duplicate first; the
  -- field merge reads it from here instead.
  select external_reference into v_dup_external_reference from patients where id = p_duplicate_id;
  if v_dup_external_reference is not null then
    update patients set external_reference = null where id = p_duplicate_id;
  end if;

  -- Field-level merge: the survivor keeps everything it already has, and only
  -- its blanks are filled from the duplicate. That is the direction that can
  -- never lose data the front desk deliberately typed -- picking the
  -- duplicate's value over a populated one would.
  --
  -- Arrays are unioned rather than replaced: a VIP tag or a marketing opt-in
  -- on either record belongs to the person, not to the row.
  --
  -- balance_cents is summed. It is not a live ledger -- it is the account
  -- balance written once at PracticeHub import (patient_live_balances is the
  -- computed one) -- so for two halves of one person the snapshot is the sum.
  update patients s set
    last_name              = coalesce(nullif(s.last_name, ''), d.last_name),
    date_of_birth          = coalesce(s.date_of_birth, d.date_of_birth),
    email                  = coalesce(nullif(s.email, ''), d.email),
    occupation             = coalesce(nullif(s.occupation, ''), d.occupation),
    emergency_contact      = coalesce(nullif(s.emergency_contact, ''), d.emergency_contact),
    referral_source        = coalesce(nullif(s.referral_source, ''), d.referral_source),
    notes                  = coalesce(nullif(s.notes, ''), d.notes),
    external_reference     = coalesce(nullif(s.external_reference, ''), v_dup_external_reference),
    address                = coalesce(nullif(s.address, ''), d.address),
    national_id            = coalesce(nullif(s.national_id, ''), d.national_id),
    sticky_note            = coalesce(nullif(s.sticky_note, ''), d.sticky_note),
    gender                 = coalesce(nullif(s.gender, ''), d.gender),
    chief_complaint        = coalesce(nullif(s.chief_complaint, ''), d.chief_complaint),
    red_flags              = coalesce(nullif(s.red_flags, ''), d.red_flags),
    yellow_flags           = coalesce(nullif(s.yellow_flags, ''), d.yellow_flags),
    diagnosis              = coalesce(nullif(s.diagnosis, ''), d.diagnosis),
    goals                  = coalesce(nullif(s.goals, ''), d.goals),
    postal_code            = coalesce(nullif(s.postal_code, ''), d.postal_code),
    city                   = coalesce(nullif(s.city, ''), d.city),
    country                = coalesce(nullif(s.country, ''), d.country),
    photo_storage_path     = coalesce(nullif(s.photo_storage_path, ''), d.photo_storage_path),
    clinic_id              = coalesce(s.clinic_id, d.clinic_id),
    default_practitioner_id = coalesce(s.default_practitioner_id, d.default_practitioner_id),
    user_id                = coalesce(s.user_id, d.user_id),
    tags                   = (select coalesce(array_agg(distinct x), '{}') from unnest(s.tags || d.tags) x),
    marketing_channels     = (select coalesce(array_agg(distinct x), '{}') from unnest(s.marketing_channels || d.marketing_channels) x),
    -- Who may be contacted, and through whom, belongs to the person: if
    -- either record says minor, the merged one does, and keeps the tutor its
    -- messages go to. Before this a child flagged minor on the record that
    -- was deleted became directly contactable. Never the patient's own tutor
    -- or referrer: the duplicate may point at the survivor.
    is_minor               = s.is_minor or d.is_minor,
    tutor_patient_id       = coalesce(s.tutor_patient_id,
                                      nullif(nullif(d.tutor_patient_id, p_survivor_id), p_duplicate_id)),
    referred_by_patient_id = coalesce(s.referred_by_patient_id,
                                      nullif(nullif(d.referred_by_patient_id, p_survivor_id), p_duplicate_id)),
    app_push_opted_out     = s.app_push_opted_out or d.app_push_opted_out,
    has_phone              = s.has_phone or d.has_phone,
    do_not_contact         = s.do_not_contact or d.do_not_contact,
    balance_cents          = s.balance_cents + d.balance_cents
  from patients d
  where s.id = p_survivor_id and d.id = p_duplicate_id;

  -- Every table keyed off the duplicate has been moved above, so the cascade
  -- has nothing left to take. That sentence was already here and was wrong
  -- for payments; the guard below is what makes it checkable rather than
  -- merely intended.
  --
  -- A table added to `patients` in future and forgotten here lands in exactly
  -- the same trap, and the next one may be as quiet as payments was. RESTRICT
  -- on facturas turns the fiscal case into a loud failure; this turns the
  -- money case into one too, at the cost of one count.
  if exists (select 1 from payments where patient_id = p_duplicate_id) then
    raise exception 'merge_patients would have deleted payments still on the duplicate record (patient %)', p_duplicate_id
      using errcode = 'restrict_violation';
  end if;

  delete from patients where id = p_duplicate_id;

  return v_moved;
end;
$$;


-- anonymize_patient removes the schedule with the exercises. Re-created from
-- 20261017182107 with one line added.
create or replace function public.anonymize_patient(p_patient_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_patient patients%rowtype;
  v_years int;
  v_last timestamptz;
  v_files text[];
  v_photo text;
  v_appts uuid[];
  v_posture text[];
  v_actor_name text;
begin
  select * into v_patient from patients where id = p_patient_id for update;
  if v_patient.id is null or not public.is_account_owner(v_patient.account_id) then
    raise exception 'Only an owner can anonymise a record' using errcode = 'insufficient_privilege';
  end if;
  if v_patient.anonymized_at is not null then
    raise exception 'This record is already anonymised' using errcode = 'check_violation';
  end if;
  select clinical_retention_years into v_years from accounts where id = v_patient.account_id;
  v_last := public.patient_last_activity(p_patient_id);
  if v_last >= now() - make_interval(years => v_years) then
    raise exception 'This record is still inside its retention period' using errcode = 'check_violation';
  end if;
  if v_patient.retention_kept_until is not null and v_patient.retention_kept_until >= current_date then
    raise exception 'This record is being kept until %', v_patient.retention_kept_until using errcode = 'check_violation';
  end if;

  perform set_config('quiroflow.anonymizing_patient', p_patient_id::text, true);

  select array_agg(id) into v_appts from appointments where patient_id = p_patient_id;
  select array_agg(storage_path) filter (where storage_path is not null) into v_files from patient_files where patient_id = p_patient_id;
  v_photo := v_patient.photo_storage_path;

  -- The clinical record.
  delete from visit_notes where appointment_id = any(coalesce(v_appts, '{}'));
  delete from visit_listings where appointment_id = any(coalesce(v_appts, '{}'));
  delete from visit_pain_scores where appointment_id = any(coalesce(v_appts, '{}'));
  delete from satisfaction_surveys where appointment_id = any(coalesce(v_appts, '{}'));
  update appointments set note = null where patient_id = p_patient_id and note is not null;
  delete from patient_files where patient_id = p_patient_id;
  delete from patient_docs where patient_id = p_patient_id;
  delete from patient_exercises where patient_id = p_patient_id;
  delete from patient_exercise_schedules where patient_id = p_patient_id;
  if to_regclass('public.learn_sends') is not null then
    execute 'delete from public.learn_sends where patient_id = $1' using p_patient_id;
  end if;
  -- Posture photos are in storage too: their paths go back with the files.
  if to_regclass('public.posture_assessments') is not null then
    execute $q$select coalesce(array_agg(v.value ->> 'photo') filter (where v.value ->> 'photo' is not null), '{}')
      from public.posture_assessments pa, jsonb_each(pa.views) v where pa.patient_id = $1$q$
      into v_posture using p_patient_id;
    v_files := coalesce(v_files, '{}') || v_posture;
    execute 'delete from public.posture_assessments where patient_id = $1' using p_patient_id;
  end if;
  delete from staff_tasks where patient_id = p_patient_id;

  -- What was said to and by them, and how to reach them.
  delete from patient_app_messages where patient_id = p_patient_id;
  delete from whatsapp_messages where patient_id = p_patient_id;
  delete from email_messages where patient_id = p_patient_id;
  delete from contact_log where patient_id = p_patient_id;
  delete from patient_push_log where patient_id = p_patient_id;
  delete from patient_contact_numbers where patient_id = p_patient_id;
  delete from photo_upload_tokens where patient_id = p_patient_id;
  delete from waitlist_entries where patient_id = p_patient_id;
  delete from review_requests where patient_id = p_patient_id;
  delete from automation_sequence_runs where patient_id = p_patient_id;
  delete from automation_birthday_sends where patient_id = p_patient_id;
  delete from leads where patient_id = p_patient_id;

  -- The person. What stays is a nameless row the money and the visits hang on.
  update patients set
    first_name = 'Paciente',
    last_name = 'anonimizado',
    date_of_birth = null, email = null, occupation = null, emergency_contact = null,
    notes = null, sticky_note = null, address = null, postal_code = null, city = null, country = null,
    national_id = null, gender = null, external_reference = null, photo_storage_path = null,
    chief_complaint = null, diagnosis = null, red_flags = null, yellow_flags = null, goals = null,
    tags = '{}', user_id = null, has_phone = false, do_not_contact = true,
    marketing_channels = '{}', referral_code = null, status = 'inactive',
    retention_kept_until = null, retention_kept_reason = null,
    anonymized_at = now()
  where id = p_patient_id;

  -- The trail keeps who did what and when, not what the record said.
  update audit_logs
  set snapshot = null,
      changes = case when entity_type in ('payment', 'invoice', 'account_credit') then changes else null end,
      summary = case when entity_type in ('payment', 'invoice', 'account_credit') then summary else 'Datos anonimizados' end
  where patient_id = p_patient_id and account_id = v_patient.account_id
    and (snapshot is not null or changes is not null);

  select full_name into v_actor_name from team_members where account_id = v_patient.account_id and user_id = auth.uid() and deleted_at is null limit 1;
  insert into audit_logs (account_id, entity_type, entity_id, action, summary, actor, actor_name, patient_id, team_member_id)
  values (v_patient.account_id, 'patient', p_patient_id, 'updated', 'Historia anonimizada por plazo de conservación cumplido', 'staff', v_actor_name, p_patient_id,
    (select id from team_members where account_id = v_patient.account_id and user_id = auth.uid() and deleted_at is null limit 1));

  -- Closed again at once: nothing later in the same transaction may blank anything.
  perform set_config('quiroflow.anonymizing_patient', '', true);
  return jsonb_build_object('files', coalesce(to_jsonb(v_files), '[]'::jsonb), 'photo', v_photo);
end;
$$;

