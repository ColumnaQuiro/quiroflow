-- The Exercises section, and patient types that bring their exercises with
-- them.
--
--   exercises_manage            a role permission of its own for the exercise
--                               library, programmes, schedules, what each
--                               patient type brings, and assigning in bulk.
--                               Until now the library sat behind
--                               clinic_config (Settings) in the UI and behind
--                               nothing at all in the database.
--   patient_types               categories a clinic defines once (Joven,
--                               Mayor de 65, Deportista...). Unlike tags,
--                               which are free text, a type is a row: it can
--                               be renamed without rewriting every record,
--                               and it can carry defaults.
--   patient_type_members        which patients have which types. Several per
--                               patient: "Mayor de 65" and "Lumbar crónico"
--                               are not alternatives.
--   patient_exercises.source_type_id
--   patient_exercise_schedules.source_type_id
--                               which type gave an exercise or a schedule. An
--                               exercise the type gave and a practitioner
--                               then ended keeps it, which is how a later
--                               "update everyone with this type" knows not to
--                               put it back.
--
-- The writes go through functions (assign_exercises_to_patients,
-- set_patient_types, sync_patient_type...) that run as the caller, so the
-- patient scope, two-factor and the audit trail apply exactly as they do to
-- the table writes they replace. With no auth.uid() -- an automation step,
-- running as the service role -- the permission checks are skipped, as every
-- other function here does for the service role.

-- ------------------------------------------------------------ permission

-- Who gets it: Owners and Practitioners by default; any role that could
-- already open the library (clinic_config); and any role that writes visit
-- notes, which is what a clinician's role looks like in a clinic that has
-- renamed or added its own. Front Desk does not.
update public.account_roles
set permissions = permissions || '{"exercises_manage": true}'::jsonb
where (
    name in ('Owner', 'Practitioner')
    or coalesce((permissions->>'clinic_config')::boolean, false)
    or coalesce((permissions->>'visit_notes_edit')::boolean, false)
  )
  and not coalesce((permissions->>'exercises_manage')::boolean, false);

-- The library itself. Reading stays open to every member (the picker on a
-- patient's record reads it). Adding stays open too: a practitioner assigns
-- a new exercise, or one from QuiroFlow's catalogue, from the record, and
-- that writes a library row (useStaffExercises, useExerciseCatalog).
-- Changing or removing one, and programmes and schedule templates, need the
-- permission.
drop policy if exists "staff manage exercises" on public.exercises;
create policy "staff read exercises" on public.exercises for select
  using (account_id in (select public.my_member_account_ids()));
create policy "staff add exercises" on public.exercises for insert
  with check (account_id in (select public.my_member_account_ids()));
create policy "exercise managers update exercises" on public.exercises for update
  using (account_id in (select public.my_permitted_accounts('exercises_manage')))
  with check (account_id in (select public.my_permitted_accounts('exercises_manage')));
create policy "exercise managers delete exercises" on public.exercises for delete
  using (account_id in (select public.my_permitted_accounts('exercises_manage')));

drop policy if exists "staff manage exercise_programs" on public.exercise_programs;
create policy "staff read exercise_programs" on public.exercise_programs for select
  using (account_id in (select public.my_member_account_ids()));
create policy "exercise managers write exercise_programs" on public.exercise_programs for all
  using (account_id in (select public.my_permitted_accounts('exercises_manage')))
  with check (account_id in (select public.my_permitted_accounts('exercises_manage')));

drop policy if exists "staff manage exercise_program_items" on public.exercise_program_items;
create policy "staff read exercise_program_items" on public.exercise_program_items for select
  using (account_id in (select public.my_member_account_ids()));
create policy "exercise managers write exercise_program_items" on public.exercise_program_items for all
  using (account_id in (select public.my_permitted_accounts('exercises_manage')))
  with check (
    account_id in (select public.my_permitted_accounts('exercises_manage'))
    and exists (select 1 from public.exercise_programs g where g.id = program_id and g.account_id = exercise_program_items.account_id)
    and exists (select 1 from public.exercises e where e.id = exercise_id and e.account_id = exercise_program_items.account_id)
  );

drop policy if exists "staff manage exercise_schedules" on public.exercise_schedules;
create policy "staff read exercise_schedules" on public.exercise_schedules for select
  using (account_id in (select public.my_member_account_ids()));
create policy "exercise managers write exercise_schedules" on public.exercise_schedules for all
  using (account_id in (select public.my_permitted_accounts('exercises_manage')))
  with check (account_id in (select public.my_permitted_accounts('exercises_manage')));

-- ------------------------------------------------------------ patient types

create table public.patient_types (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 40),
  color text not null default 'indigo'
    check (color in ('indigo', 'green', 'amber', 'rose', 'violet', 'sky', 'orange', 'slate')),
  -- What a patient given this type gets: a programme now, and a schedule by
  -- visit. Either may be empty.
  exercise_program_id uuid references public.exercise_programs(id) on delete set null,
  exercise_schedule_id uuid references public.exercise_schedules(id) on delete set null,
  archived_at timestamptz,
  created_by uuid references public.team_members(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index patient_types_name_unique on public.patient_types (account_id, lower(btrim(name))) where archived_at is null;
create index patient_types_account_id_idx on public.patient_types (account_id);
create index patient_types_exercise_program_id_idx on public.patient_types (exercise_program_id);
create index patient_types_exercise_schedule_id_idx on public.patient_types (exercise_schedule_id);
create index patient_types_created_by_idx on public.patient_types (created_by);

create table public.patient_type_members (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  type_id uuid not null references public.patient_types(id) on delete cascade,
  added_by uuid references public.team_members(id) on delete set null,
  added_at timestamptz not null default now(),
  unique (patient_id, type_id)
);
create index patient_type_members_account_id_idx on public.patient_type_members (account_id);
create index patient_type_members_type_id_idx on public.patient_type_members (type_id);
create index patient_type_members_added_by_idx on public.patient_type_members (added_by);

alter table public.patient_exercises
  add column source_type_id uuid references public.patient_types(id) on delete set null;
create index patient_exercises_source_type_id_idx on public.patient_exercises (source_type_id);
alter table public.patient_exercise_schedules
  add column source_type_id uuid references public.patient_types(id) on delete set null;
create index patient_exercise_schedules_source_type_id_idx on public.patient_exercise_schedules (source_type_id);

alter table public.patient_types enable row level security;
alter table public.patient_type_members enable row level security;

-- Every member reads the clinic's types (the record shows them, the list
-- filters by them). Creating, renaming, archiving and deleting is clinic
-- configuration; choosing what a type brings is exercises_manage. The guard
-- below splits an update between the two by the columns it changes.
create policy "staff read patient_types" on public.patient_types for select
  using (account_id in (select public.my_member_account_ids()));
create policy "config writers insert patient_types" on public.patient_types for insert
  with check (account_id in (select public.my_permitted_accounts('clinic_config')));
create policy "config or exercise writers update patient_types" on public.patient_types for update
  using (account_id in (select public.my_permitted_accounts('clinic_config')) or account_id in (select public.my_permitted_accounts('exercises_manage')))
  with check (account_id in (select public.my_permitted_accounts('clinic_config')) or account_id in (select public.my_permitted_accounts('exercises_manage')));
create policy "config writers delete patient_types" on public.patient_types for delete
  using (account_id in (select public.my_permitted_accounts('clinic_config')));

create or replace function public.patient_types_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  -- A programme or schedule of another clinic would hand its exercises over.
  if new.exercise_program_id is not null
     and not exists (select 1 from public.exercise_programs g where g.id = new.exercise_program_id and g.account_id = new.account_id) then
    raise exception 'Exercise programme not found';
  end if;
  if new.exercise_schedule_id is not null
     and not exists (select 1 from public.exercise_schedules s where s.id = new.exercise_schedule_id and s.account_id = new.account_id) then
    raise exception 'Exercise schedule not found';
  end if;

  if tg_op = 'UPDATE' then
    new.updated_at := now();
    if (select auth.uid()) is not null then
      if (new.name, new.color, new.archived_at) is distinct from (old.name, old.color, old.archived_at)
         and not public.has_permission(new.account_id, 'clinic_config') then
        raise exception 'Your role cannot rename or archive patient types' using errcode = '42501';
      end if;
      if (new.exercise_program_id, new.exercise_schedule_id) is distinct from (old.exercise_program_id, old.exercise_schedule_id)
         and not public.has_permission(new.account_id, 'exercises_manage') then
        raise exception 'Your role cannot change the exercises a patient type brings' using errcode = '42501';
      end if;
    end if;
  end if;
  return new;
end;
$function$;
revoke execute on function public.patient_types_guard() from public, anon, authenticated;
create trigger patient_types_guard before insert or update on public.patient_types
  for each row execute function public.patient_types_guard();

-- A patient's types are part of their record: read and changed by whoever
-- reaches the record, changed only with patients_edit.
create policy "staff read patient_type_members" on public.patient_type_members for select
  using (
    account_id in (select public.my_member_account_ids())
    and ((select public.my_patients_scope()) = 'all'
      or ((select public.my_patients_scope()) = 'own' and patient_id in (select public.my_own_patient_ids())))
  );
create policy "patient editors add patient_type_members" on public.patient_type_members for insert
  with check (
    account_id in (select public.my_permitted_accounts('patients_edit'))
    and ((select public.my_patients_scope()) = 'all'
      or ((select public.my_patients_scope()) = 'own' and patient_id in (select public.my_own_patient_ids())))
    and exists (select 1 from public.patients p where p.id = patient_id and p.account_id = patient_type_members.account_id)
    and exists (select 1 from public.patient_types ty where ty.id = type_id and ty.account_id = patient_type_members.account_id)
  );
create policy "patient editors remove patient_type_members" on public.patient_type_members for delete
  using (
    account_id in (select public.my_permitted_accounts('patients_edit'))
    and ((select public.my_patients_scope()) = 'all'
      or ((select public.my_patients_scope()) = 'own' and patient_id in (select public.my_own_patient_ids())))
  );

select public.require_two_factor_on('public.patient_types');
select public.require_two_factor_on('public.patient_type_members');
select public.grant_data_api('public.patient_types');
select public.grant_data_api('public.patient_type_members');

do $$
declare
  v_types text[];
begin
  select array_agg(distinct m[1]) into v_types
  from pg_constraint c, regexp_matches(pg_get_constraintdef(c.oid), '([a-z][a-z_]*)', 'g') m
  where c.conname = 'audit_logs_entity_type_check' and c.conrelid = 'public.audit_logs'::regclass
    and m[1] not in ('entity_type', 'text');
  v_types := array(select distinct x from unnest(coalesce(v_types, '{}') || array['patient_type', 'patient_type_member']) x order by 1);

  alter table public.audit_logs drop constraint audit_logs_entity_type_check;
  execute format('alter table public.audit_logs add constraint audit_logs_entity_type_check check (entity_type = any (%L::text[]))', v_types);
end;
$$;

create trigger trg_audit_patient_types after insert or update or delete on public.patient_types
  for each row execute function public.fn_audit_log('patient_type', 'updated_at');
create trigger trg_audit_patient_type_members after insert or update or delete on public.patient_type_members
  for each row execute function public.fn_audit_log('patient_type_member');

-- Anonymising a record takes its types with it: "Embarazada" is health data.
-- A trigger, as habit_checkins and recall_assignments do, rather than another
-- copy of anonymize_patient.
create or replace function public.patients_drop_types_on_anonymize()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.anonymized_at is null and new.anonymized_at is not null then
    delete from public.patient_type_members where patient_id = new.id;
  end if;
  return new;
end;
$$;
revoke execute on function public.patients_drop_types_on_anonymize() from public, anon, authenticated;
create trigger patients_drop_types_on_anonymize
  after update of anonymized_at on public.patients
  for each row execute function public.patients_drop_types_on_anonymize();

-- ------------------------------------------------------------ bulk helpers

-- The patients a bulk action is about: the ids picked, or everyone matching
-- the list's filters ("all N that match"), as the lists' bulk add does.
-- Read as the caller, so a patient they cannot see is never among them.
create or replace function public.bulk_patient_ids(p_patient_ids uuid[], p_filters jsonb, p_clinic_id uuid)
returns uuid[]
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  v_ids uuid[];
begin
  if p_patient_ids is not null then
    select array_agg(p.id) into v_ids from public.patients p where p.id = any (p_patient_ids);
  else
    select array_agg(m.id) into v_ids from public.patients_matching(coalesce(p_filters, '{}'::jsonb), p_clinic_id) m;
  end if;
  if coalesce(cardinality(v_ids), 0) > 5000 then
    raise exception 'Too many patients at once (%). Narrow the filter.', cardinality(v_ids);
  end if;
  return coalesce(v_ids, '{}'::uuid[]);
end;
$function$;
revoke all on function public.bulk_patient_ids(uuid[], jsonb, uuid) from public, anon;
grant execute on function public.bulk_patient_ids(uuid[], jsonb, uuid) to authenticated, service_role;

-- The caller's team member in this account, for assigned_by / added_by.
create or replace function public.my_team_member_in(p_account_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $function$
  select tm.id from public.team_members tm
  where tm.account_id = p_account_id and tm.user_id = auth.uid() and tm.deleted_at is null
  limit 1;
$function$;
revoke all on function public.my_team_member_in(uuid) from public, anon;
grant execute on function public.my_team_member_in(uuid) to authenticated, service_role;

-- Gives each patient each exercise in p_items, with the item's dose, and
-- returns what it created: [{patient_id, ids: [...]}] (for the pushes).
--
-- An exercise a patient already has on is not given twice. With a type
-- (p_source_type_id), one the type gave them and someone then ended is not
-- given back either: that was a decision about this person.
--
-- No permission of its own: it writes exactly what the patient_exercises
-- policy already lets the caller write from a patient's record. The callers
-- below check theirs.
create or replace function public.give_exercise_items(p_account_id uuid, p_patient_ids uuid[], p_items jsonb, p_source_type_id uuid default null)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_by uuid := public.my_team_member_in(p_account_id);
  v_out jsonb;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    return '[]'::jsonb;
  end if;
  if jsonb_array_length(p_items) > 50 then
    raise exception 'Too many exercises at once';
  end if;

  with items as (
    select distinct on ((i.value->>'exercise_id')::uuid) (i.value->>'exercise_id')::uuid as exercise_id, i.value as item
    from jsonb_array_elements(p_items) i
    order by (i.value->>'exercise_id')::uuid
  ),
  ins as (
    insert into public.patient_exercises (account_id, patient_id, exercise_id, sets, reps, frequency, notes, progressive, assigned_by, source_type_id)
    select p_account_id, pid, it.exercise_id,
           nullif(it.item->>'sets', '')::integer,
           nullif(btrim(it.item->>'reps'), ''),
           nullif(btrim(it.item->>'frequency'), ''),
           nullif(btrim(it.item->>'notes'), ''),
           coalesce((it.item->>'progressive')::boolean, false),
           v_by, p_source_type_id
    from unnest(p_patient_ids) pid
    cross join items it
    join public.exercises e on e.id = it.exercise_id and e.account_id = p_account_id and e.archived_at is null
    where not exists (
        select 1 from public.patient_exercises pe
        where pe.patient_id = pid and pe.exercise_id = it.exercise_id and pe.ended_at is null
      )
      and (p_source_type_id is null or not exists (
        select 1 from public.patient_exercises pe
        where pe.patient_id = pid and pe.exercise_id = it.exercise_id and pe.source_type_id = p_source_type_id and pe.ended_at is not null
      ))
    returning patient_id, id
  )
  select coalesce(jsonb_agg(jsonb_build_object('patient_id', g.patient_id, 'ids', g.ids)), '[]'::jsonb)
  into v_out
  from (select patient_id, jsonb_agg(id) as ids from ins group by patient_id) g;
  return v_out;
end;
$function$;
revoke all on function public.give_exercise_items(uuid, uuid[], jsonb, uuid) from public, anon;
grant execute on function public.give_exercise_items(uuid, uuid[], jsonb, uuid) to authenticated, service_role;

-- A programme's items in the shape give_exercise_items takes.
create or replace function public.exercise_program_item_list(p_program_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $function$
  select coalesce(jsonb_agg(jsonb_build_object(
           'exercise_id', i.exercise_id, 'sets', i.sets, 'reps', i.reps, 'frequency', i.frequency,
           'notes', i.notes, 'progressive', i.progressive) order by i.position), '[]'::jsonb)
  from public.exercise_program_items i
  where i.program_id = p_program_id;
$function$;
revoke all on function public.exercise_program_item_list(uuid) from public, anon;
grant execute on function public.exercise_program_item_list(uuid) to authenticated, service_role;

-- Starts a schedule template for each patient who has no schedule on (one at
-- a time per patient, patient_exercise_schedules_one_active), counting visits
-- from the start of their latest care plan, or today -- what the record
-- offers by default -- and gives whatever is already due. Returns
-- {started, skipped, added: [{patient_id, ids}]}; skipped are those who had
-- one on already, which is left as it is.
create or replace function public.start_exercise_schedule_for(p_account_id uuid, p_patient_ids uuid[], p_schedule_id uuid, p_source_type_id uuid default null)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  t public.exercise_schedules%rowtype;
  v_by uuid := public.my_team_member_in(p_account_id);
  v_pid uuid;
  v_id uuid;
  v_ids uuid[];
  v_started integer := 0;
  v_skipped integer := 0;
  v_added jsonb := '[]'::jsonb;
begin
  select * into t from public.exercise_schedules where id = p_schedule_id and account_id = p_account_id;
  if not found then
    raise exception 'Exercise schedule not found';
  end if;
  foreach v_pid in array coalesce(p_patient_ids, '{}'::uuid[]) loop
    if exists (select 1 from public.patient_exercise_schedules s where s.patient_id = v_pid and s.ended_at is null) then
      v_skipped := v_skipped + 1;
      continue;
    end if;
    insert into public.patient_exercise_schedules (account_id, patient_id, schedule_id, name, counts_from, steps, created_by, source_type_id)
    values (
      p_account_id, v_pid, t.id, t.name,
      coalesce((select cp.started_at::date from public.care_plans cp where cp.patient_id = v_pid order by cp.created_at desc limit 1), current_date),
      (select coalesce(jsonb_agg(st.value - 'applied_at' order by st.ord), '[]'::jsonb) from jsonb_array_elements(t.steps) with ordinality st(value, ord)),
      v_by, p_source_type_id
    )
    returning id into v_id;
    v_started := v_started + 1;
    v_ids := public.apply_patient_exercise_schedule(v_id);
    if coalesce(cardinality(v_ids), 0) > 0 then
      v_added := v_added || jsonb_build_array(jsonb_build_object('patient_id', v_pid, 'ids', to_jsonb(v_ids)));
    end if;
  end loop;
  return jsonb_build_object('started', v_started, 'skipped', v_skipped, 'added', v_added);
end;
$function$;
revoke all on function public.start_exercise_schedule_for(uuid, uuid[], uuid, uuid) from public, anon;
grant execute on function public.start_exercise_schedule_for(uuid, uuid[], uuid, uuid) to authenticated, service_role;

-- ------------------------------------------------------------ bulk assign

-- The Exercises section's "Assign exercises" for many patients at once:
-- loose exercises or a programme (p_items), or a schedule by visit
-- (p_schedule_id). Returns {patients, added: [{patient_id, ids}], started,
-- skipped}.
create or replace function public.assign_exercises_to_patients(
  p_account_id uuid,
  p_patient_ids uuid[],
  p_filters jsonb,
  p_clinic_id uuid,
  p_items jsonb,
  p_schedule_id uuid default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_ids uuid[];
  v_added jsonb := '[]'::jsonb;
  v_sched jsonb;
begin
  if (select auth.uid()) is not null and not public.has_permission(p_account_id, 'exercises_manage') then
    raise exception 'Your role cannot assign exercises in bulk' using errcode = '42501';
  end if;
  v_ids := public.bulk_patient_ids(p_patient_ids, p_filters, p_clinic_id);
  select coalesce(array_agg(p.id), '{}') into v_ids from public.patients p where p.id = any (v_ids) and p.account_id = p_account_id;

  if p_schedule_id is not null then
    v_sched := public.start_exercise_schedule_for(p_account_id, v_ids, p_schedule_id);
    return jsonb_build_object('patients', cardinality(v_ids), 'added', v_sched->'added', 'started', v_sched->'started', 'skipped', v_sched->'skipped');
  end if;

  v_added := public.give_exercise_items(p_account_id, v_ids, p_items);
  return jsonb_build_object('patients', cardinality(v_ids), 'added', v_added, 'started', 0, 'skipped', 0);
end;
$function$;
revoke all on function public.assign_exercises_to_patients(uuid, uuid[], jsonb, uuid, jsonb, uuid) from public, anon;
grant execute on function public.assign_exercises_to_patients(uuid, uuid[], jsonb, uuid, jsonb, uuid) to authenticated, service_role;

-- What a bulk assignment is about to do, for the dialog: how many patients,
-- how many of them will not see it (no app), and how many already have every
-- one of these exercises on.
create or replace function public.assign_exercises_preview(p_account_id uuid, p_patient_ids uuid[], p_filters jsonb, p_clinic_id uuid, p_exercise_ids uuid[])
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  v_ids uuid[];
begin
  v_ids := public.bulk_patient_ids(p_patient_ids, p_filters, p_clinic_id);
  return jsonb_build_object(
    'patients', (select count(*) from public.patients p where p.id = any (v_ids) and p.account_id = p_account_id),
    'without_app', (
      select count(*) from public.patients p
      where p.id = any (v_ids) and p.account_id = p_account_id
        and not exists (select 1 from public.app_opens o where o.account_id = p.account_id and o.user_id = p.user_id)
    ),
    'already_have', (
      select count(*) from public.patients p
      where p.id = any (v_ids) and p.account_id = p_account_id
        and coalesce(cardinality(p_exercise_ids), 0) > 0
        and exists (
          select 1 from public.patient_exercises pe
          where pe.patient_id = p.id and pe.ended_at is null and pe.exercise_id = any (p_exercise_ids)
        )
    ),
    'with_schedule', (
      select count(*) from public.patient_exercise_schedules s
      where s.patient_id = any (v_ids) and s.ended_at is null
    )
  );
end;
$function$;
revoke all on function public.assign_exercises_preview(uuid, uuid[], jsonb, uuid, uuid[]) from public, anon;
grant execute on function public.assign_exercises_preview(uuid, uuid[], jsonb, uuid, uuid[]) to authenticated;

-- "End exercises..." for many: every exercise they have on, or only these.
-- Ended, not deleted: their ticks stay. Returns how many were ended.
create or replace function public.end_exercises_for_patients(p_account_id uuid, p_patient_ids uuid[], p_filters jsonb, p_clinic_id uuid, p_exercise_ids uuid[] default null)
returns integer
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_ids uuid[];
  v_count integer;
begin
  if (select auth.uid()) is not null and not public.has_permission(p_account_id, 'exercises_manage') then
    raise exception 'Your role cannot end exercises in bulk' using errcode = '42501';
  end if;
  v_ids := public.bulk_patient_ids(p_patient_ids, p_filters, p_clinic_id);
  update public.patient_exercises pe
  set ended_at = now()
  where pe.account_id = p_account_id
    and pe.patient_id = any (v_ids)
    and pe.ended_at is null
    and (p_exercise_ids is null or pe.exercise_id = any (p_exercise_ids));
  get diagnostics v_count = row_count;
  return v_count;
end;
$function$;
revoke all on function public.end_exercises_for_patients(uuid, uuid[], jsonb, uuid, uuid[]) from public, anon;
grant execute on function public.end_exercises_for_patients(uuid, uuid[], jsonb, uuid, uuid[]) to authenticated;

-- ------------------------------------------------------------ types on patients

-- Gives a type's defaults to patients who have just been given it.
create or replace function public.give_patient_type_defaults(p_account_id uuid, p_type_id uuid, p_patient_ids uuid[])
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  ty public.patient_types%rowtype;
  v_added jsonb := '[]'::jsonb;
  v_sched jsonb;
begin
  select * into ty from public.patient_types where id = p_type_id and account_id = p_account_id;
  if not found or coalesce(cardinality(p_patient_ids), 0) = 0 then
    return '[]'::jsonb;
  end if;
  if ty.exercise_program_id is not null then
    v_added := public.give_exercise_items(p_account_id, p_patient_ids, public.exercise_program_item_list(ty.exercise_program_id), ty.id);
  end if;
  if ty.exercise_schedule_id is not null then
    v_sched := public.start_exercise_schedule_for(p_account_id, p_patient_ids, ty.exercise_schedule_id, ty.id);
    v_added := v_added || (v_sched->'added');
  end if;
  return v_added;
end;
$function$;
revoke all on function public.give_patient_type_defaults(uuid, uuid, uuid[]) from public, anon;
grant execute on function public.give_patient_type_defaults(uuid, uuid, uuid[]) to authenticated, service_role;

-- Adds and removes types on one patient or many. A type added brings its
-- exercises and schedule; a type removed, when p_end_type_exercises, ends
-- the exercises and the schedule it brought (what was added by hand stays).
-- Returns {patients, added: [{patient_id, type_id}], removed: [...],
-- exercises: [{patient_id, ids}]} -- the first two for the automations that
-- start on a type, the last for the patients' pushes.
create or replace function public.set_patient_types(
  p_account_id uuid,
  p_patient_ids uuid[],
  p_filters jsonb,
  p_clinic_id uuid,
  p_add uuid[],
  p_remove uuid[],
  p_end_type_exercises boolean default true
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_ids uuid[];
  v_by uuid := public.my_team_member_in(p_account_id);
  v_added jsonb;
  v_removed jsonb;
  v_exercises jsonb := '[]'::jsonb;
  v_type uuid;
  v_type_patients uuid[];
begin
  if (select auth.uid()) is not null and not public.has_permission(p_account_id, 'patients_edit') then
    raise exception 'Your role cannot change patient types' using errcode = '42501';
  end if;
  if exists (select 1 from unnest(coalesce(p_add, '{}'::uuid[]) || coalesce(p_remove, '{}'::uuid[])) x
             where not exists (select 1 from public.patient_types ty where ty.id = x and ty.account_id = p_account_id)) then
    raise exception 'Patient type not found';
  end if;
  if exists (select 1 from public.patient_types ty where ty.id = any (coalesce(p_add, '{}'::uuid[])) and ty.archived_at is not null) then
    raise exception 'That patient type is archived';
  end if;

  v_ids := public.bulk_patient_ids(p_patient_ids, p_filters, p_clinic_id);
  select coalesce(array_agg(p.id), '{}') into v_ids from public.patients p where p.id = any (v_ids) and p.account_id = p_account_id;

  with del as (
    delete from public.patient_type_members m
    where m.patient_id = any (v_ids) and m.type_id = any (coalesce(p_remove, '{}'::uuid[]))
    returning m.patient_id, m.type_id
  )
  select coalesce(jsonb_agg(jsonb_build_object('patient_id', patient_id, 'type_id', type_id)), '[]'::jsonb) into v_removed from del;

  if p_end_type_exercises and jsonb_array_length(v_removed) > 0 then
    -- What the type brought and is still on ends, and is no longer marked as
    -- the type's: given the type again later, they get it again.
    update public.patient_exercises pe
    set ended_at = coalesce(pe.ended_at, now()), source_type_id = null
    from jsonb_array_elements(v_removed) r
    where pe.patient_id = (r.value->>'patient_id')::uuid and pe.source_type_id = (r.value->>'type_id')::uuid;
    update public.patient_exercises pe
    set ended_at = now()
    from public.patient_exercise_schedules s, jsonb_array_elements(v_removed) r
    where pe.patient_schedule_id = s.id and pe.ended_at is null
      and s.patient_id = (r.value->>'patient_id')::uuid and s.source_type_id = (r.value->>'type_id')::uuid and s.ended_at is null;
    update public.patient_exercise_schedules s
    set ended_at = now()
    from jsonb_array_elements(v_removed) r
    where s.patient_id = (r.value->>'patient_id')::uuid and s.source_type_id = (r.value->>'type_id')::uuid and s.ended_at is null;
  end if;

  with ins as (
    insert into public.patient_type_members (account_id, patient_id, type_id, added_by)
    select p_account_id, pid, tid, v_by
    from unnest(v_ids) pid cross join unnest(coalesce(p_add, '{}'::uuid[])) tid
    on conflict (patient_id, type_id) do nothing
    returning patient_id, type_id
  )
  select coalesce(jsonb_agg(jsonb_build_object('patient_id', patient_id, 'type_id', type_id)), '[]'::jsonb) into v_added from ins;

  foreach v_type in array coalesce(p_add, '{}'::uuid[]) loop
    select array_agg((a.value->>'patient_id')::uuid) into v_type_patients
    from jsonb_array_elements(v_added) a where (a.value->>'type_id')::uuid = v_type;
    if v_type_patients is not null then
      v_exercises := v_exercises || public.give_patient_type_defaults(p_account_id, v_type, v_type_patients);
    end if;
  end loop;

  return jsonb_build_object('patients', cardinality(v_ids), 'added', v_added, 'removed', v_removed, 'exercises', v_exercises);
end;
$function$;
revoke all on function public.set_patient_types(uuid, uuid[], jsonb, uuid, uuid[], uuid[], boolean) from public, anon;
grant execute on function public.set_patient_types(uuid, uuid[], jsonb, uuid, uuid[], uuid[], boolean) to authenticated, service_role;

-- "Update the N patients who have it": brings everyone with the type in line
-- with what it brings now. Exercises newly in the programme are given (not
-- to someone who had it from the type and had it ended); ones taken out of
-- the programme end; the ones in both take the programme's dose. A schedule
-- is started for whoever has none on. Returns {patients, added, ended}.
create or replace function public.sync_patient_type(p_type_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  ty public.patient_types%rowtype;
  v_ids uuid[];
  v_items jsonb := '[]'::jsonb;
  v_added jsonb := '[]'::jsonb;
  v_ended integer := 0;
  v_sched jsonb;
begin
  select * into ty from public.patient_types where id = p_type_id;
  if not found then
    raise exception 'Patient type not found';
  end if;
  if (select auth.uid()) is not null and not public.has_permission(ty.account_id, 'exercises_manage') then
    raise exception 'Your role cannot change the exercises a patient type brings' using errcode = '42501';
  end if;

  select coalesce(array_agg(m.patient_id), '{}') into v_ids from public.patient_type_members m where m.type_id = ty.id;
  if ty.exercise_program_id is not null then
    v_items := public.exercise_program_item_list(ty.exercise_program_id);
  end if;

  update public.patient_exercises pe
  set ended_at = now(), source_type_id = null
  where pe.source_type_id = ty.id and pe.ended_at is null and pe.patient_id = any (v_ids)
    and not exists (select 1 from jsonb_array_elements(v_items) i where (i.value->>'exercise_id')::uuid = pe.exercise_id);
  get diagnostics v_ended = row_count;

  update public.patient_exercises pe
  set sets = nullif(i.value->>'sets', '')::integer,
      reps = nullif(btrim(i.value->>'reps'), ''),
      frequency = nullif(btrim(i.value->>'frequency'), ''),
      notes = nullif(btrim(i.value->>'notes'), ''),
      progressive = coalesce((i.value->>'progressive')::boolean, false)
  from jsonb_array_elements(v_items) i
  where pe.source_type_id = ty.id and pe.ended_at is null and pe.patient_id = any (v_ids)
    and pe.exercise_id = (i.value->>'exercise_id')::uuid;

  v_added := public.give_exercise_items(ty.account_id, v_ids, v_items, ty.id);
  if ty.exercise_schedule_id is not null then
    v_sched := public.start_exercise_schedule_for(ty.account_id, v_ids, ty.exercise_schedule_id, ty.id);
    v_added := v_added || (v_sched->'added');
  end if;

  return jsonb_build_object('patients', cardinality(v_ids), 'added', v_added, 'ended', v_ended);
end;
$function$;
revoke all on function public.sync_patient_type(uuid) from public, anon;
grant execute on function public.sync_patient_type(uuid) to authenticated;

-- A tag a clinic has been using as a type, made one: a type of that name,
-- given to everyone with the tag (any case), bringing nothing yet. The tag
-- itself stays; removing it is a separate decision. Returns the type's id.
create or replace function public.convert_tag_to_patient_type(p_account_id uuid, p_tag text)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_name text := btrim(coalesce(p_tag, ''));
  v_id uuid;
begin
  if length(v_name) = 0 then
    raise exception 'Which tag?';
  end if;
  if (select auth.uid()) is not null and not public.has_permission(p_account_id, 'clinic_config') then
    raise exception 'Your role cannot create patient types' using errcode = '42501';
  end if;
  select id into v_id from public.patient_types
  where account_id = p_account_id and archived_at is null and lower(btrim(name)) = lower(left(v_name, 40));
  if v_id is null then
    insert into public.patient_types (account_id, name, created_by)
    values (p_account_id, left(v_name, 40), public.my_team_member_in(p_account_id))
    returning id into v_id;
  end if;
  insert into public.patient_type_members (account_id, patient_id, type_id, added_by)
  select p_account_id, p.id, v_id, public.my_team_member_in(p_account_id)
  from public.patients p
  where p.account_id = p_account_id
    and exists (select 1 from unnest(p.tags) t where lower(btrim(t)) = lower(v_name))
  on conflict (patient_id, type_id) do nothing;
  return v_id;
end;
$function$;
revoke all on function public.convert_tag_to_patient_type(uuid, text) from public, anon;
grant execute on function public.convert_tag_to_patient_type(uuid, text) to authenticated;

-- ------------------------------------------------------------ overview

-- One row per patient for the Exercises section's table: what they have on,
-- which types, and their last seven days. Read as the caller.
create or replace function public.patient_exercise_overview(p_patient_ids uuid[])
returns table (
  patient_id uuid,
  active_count integer,
  exercise_names text[],
  schedule_name text,
  done_days date[],
  has_app boolean,
  type_ids uuid[],
  last_visit timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $function$
  select
    p.id,
    (select count(*)::integer from public.patient_exercises pe where pe.patient_id = p.id and pe.ended_at is null),
    array(
      select e.name from public.patient_exercises pe join public.exercises e on e.id = pe.exercise_id
      where pe.patient_id = p.id and pe.ended_at is null order by pe.created_at limit 4
    ),
    (select s.name from public.patient_exercise_schedules s where s.patient_id = p.id and s.ended_at is null limit 1),
    array(
      select distinct l.done_on from public.patient_exercise_logs l
      join public.patient_exercises pe on pe.id = l.patient_exercise_id
      where pe.patient_id = p.id and l.done_on > current_date - 7
      order by l.done_on
    ),
    exists (select 1 from public.app_opens o where o.account_id = p.account_id and o.user_id = p.user_id),
    array(select m.type_id from public.patient_type_members m where m.patient_id = p.id),
    (select max(a.starts_at) from public.appointments a where a.patient_id = p.id and a.status = 'completed' and a.deleted_at is null)
  from public.patients p
  where p.id = any (p_patient_ids);
$function$;
revoke all on function public.patient_exercise_overview(uuid[]) from public, anon;
grant execute on function public.patient_exercise_overview(uuid[]) to authenticated;

-- The four figures above the table, for the patients the filters match:
-- how many, how many with exercises on, and of those, the share of the last
-- seven days they ticked something.
create or replace function public.patient_exercise_overview_stats(p_filters jsonb, p_clinic_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $function$
  with m as (
    select p.id from public.patients_matching(coalesce(p_filters, '{}'::jsonb) - 'exercises', p_clinic_id) p
  ),
  w as (
    select m.id from m
    where exists (select 1 from public.patient_exercises pe where pe.patient_id = m.id and pe.ended_at is null)
  ),
  d as (
    select w.id, (
      select count(distinct l.done_on) from public.patient_exercise_logs l
      join public.patient_exercises pe on pe.id = l.patient_exercise_id
      where pe.patient_id = w.id and l.done_on > current_date - 7
    ) as days
    from w
  )
  select jsonb_build_object(
    'patients', (select count(*) from m),
    'with_exercises', (select count(*) from w),
    'adherence_pct', (select case when count(*) = 0 then null else round(100.0 * sum(days) / (7 * count(*))) end from d)
  );
$function$;
revoke all on function public.patient_exercise_overview_stats(jsonb, uuid) from public, anon;
grant execute on function public.patient_exercise_overview_stats(jsonb, uuid) to authenticated;

-- ------------------------------------------------------------ automations

-- Two triggers (utils/automationCatalog.ts): a type given to a patient, or
-- taken away -- by the team (/api/patient-types/assign) or by an automation's
-- own step. Which type lives in filters.trigger_type_id. The list restates
-- 20261105202459_automation_date_trigger's, plus these two.
alter table public.automation_rules drop constraint automation_rules_trigger_event_check;
alter table public.automation_rules add constraint automation_rules_trigger_event_check
  check (trigger_event = any (array[
    'appointment.checked_in', 'appointment.booked', 'appointment.completed', 'appointment.cancelled',
    'appointment.no_show', 'appointment.rescheduled', 'appointment.same_day', 'appointment.hours_before',
    'invoice.paid', 'invoice.overdue', 'patient.birthday', 'membership.new_member', 'membership.removed',
    'membership.payment_processed', 'patient.referred', 'appointment.review_request', 'appointment.satisfaction',
    'lead.created', 'waitlist.slot_offered', 'segment',
    'satisfaction.answered', 'patient.tag_added', 'patient.tag_removed', 'doc.completed', 'lead.stage_changed',
    'care_plan.milestone', 'bono.running_low',
    'audience.entered',
    'patient.date',
    'patient.type_added', 'patient.type_removed'
  ]));

-- Two steps: give or take away a type, and give exercises (a programme, or a
-- schedule by visit). Restates 20260926090000_automation_engine's list.
alter table public.automation_actions drop constraint automation_actions_action_type_check;
alter table public.automation_actions
  add constraint automation_actions_action_type_check check (
    action_type in (
      'whatsapp_template', 'email', 'webhook', 'delay',
      'branch', 'wait_until', 'tag', 'notify', 'lead_stage', 'lead_assign',
      'patient_type', 'assign_exercises'
    )
  );

-- ------------------------------------------------------------ restated

-- New accounts: seed_account_roles as 20260925094121 left it, with
-- exercises_manage on for Owner and Practitioner and off for Front Desk.
create or replace function public.seed_account_roles(target_account_id uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_owner_role_id uuid;

  -- Owner keeps everything. developers_access and inbox_access were added to
  -- the permission model after this function was last written and never made
  -- it into the seeded set; they are here now so a stored Owner role is a
  -- complete record rather than one the UI has to infer.
  v_owner_permissions jsonb := '{
    "dashboard_scope": "all", "calendar_scope": "all", "patients_scope": "all",
    "calendar_read_only": false,
    "settings_access": true, "roles_admin": true, "team_admin": true, "clinic_config": true,
    "billing_config": true, "communication_config": true, "data_admin": true,
    "developers_access": true,
    "billing_access": true, "recalls_access": true, "inbox_access": true,
    "reports_access": true, "reports_own_only": false,
    "appointments_delete": true, "patients_edit": true, "patients_delete_merge": true,
    "patients_tags_remove": true, "financials_edit_all": true, "financials_edit_same_day_only": false,
    "payments_allocate": true, "packages_edit": true, "billing_history_view": true,
    "patient_docs_delete": true, "patient_files_delete": true,
    "visit_notes_access": true, "visit_notes_scope": "all", "visit_notes_edit": true, "visit_notes_delete": true,
    "docs_files_scope": "all", "exercises_manage": true
  }'::jsonb;

  -- Scoped to "own" throughout: a practitioner's default view is their own
  -- work. Widening it to the whole clinic is one dropdown in Settings > Roles
  -- and many clinics will want that -- but it should be a decision someone
  -- made, not the state they were handed.
  --
  -- They can charge a visit (billing_access, financials same-day) because
  -- that is the end of an appointment, but cannot reallocate historical
  -- payments, edit packages, or delete anything: appointments, patients,
  -- documents, files and their own past notes all stay put.
  v_practitioner_permissions jsonb := '{
    "dashboard_scope": "own", "calendar_scope": "own", "patients_scope": "own",
    "calendar_read_only": false,
    "settings_access": false, "roles_admin": false, "team_admin": false, "clinic_config": false,
    "billing_config": false, "communication_config": false, "data_admin": false,
    "developers_access": false,
    "billing_access": true, "recalls_access": true, "inbox_access": false,
    "reports_access": true, "reports_own_only": true,
    "appointments_delete": false, "patients_edit": true, "patients_delete_merge": false,
    "patients_tags_remove": true, "financials_edit_all": false, "financials_edit_same_day_only": true,
    "payments_allocate": false, "packages_edit": false, "billing_history_view": true,
    "patient_docs_delete": false, "patient_files_delete": false,
    "visit_notes_access": true, "visit_notes_scope": "own", "visit_notes_edit": true, "visit_notes_delete": false,
    "docs_files_scope": "own", "exercises_manage": true
  }'::jsonb;

  -- The whole diary and patient list, because booking for anyone is the job.
  -- Takes payments and allocates them, answers WhatsApp. Deletes appointments
  -- (a mis-booking is theirs to undo) but not patients, documents or files.
  --
  -- visit_notes_access is false and that is the point of this role existing
  -- separately from Practitioner.
  v_front_desk_permissions jsonb := '{
    "dashboard_scope": "all", "calendar_scope": "all", "patients_scope": "all",
    "calendar_read_only": false,
    "settings_access": false, "roles_admin": false, "team_admin": false, "clinic_config": false,
    "billing_config": false, "communication_config": false, "data_admin": false,
    "developers_access": false,
    "billing_access": true, "recalls_access": true, "inbox_access": true,
    "reports_access": false, "reports_own_only": false,
    "appointments_delete": true, "patients_edit": true, "patients_delete_merge": false,
    "patients_tags_remove": true, "financials_edit_all": false, "financials_edit_same_day_only": true,
    "payments_allocate": true, "packages_edit": true, "billing_history_view": true,
    "patient_docs_delete": false, "patient_files_delete": false,
    "visit_notes_access": false, "visit_notes_scope": "own", "visit_notes_edit": false, "visit_notes_delete": false,
    "docs_files_scope": "all", "exercises_manage": false
  }'::jsonb;
begin
  insert into account_roles (account_id, name, is_system, permissions, description)
    values (target_account_id, 'Owner', true, v_owner_permissions,
            'Acceso total. No se puede editar: lo que decide el acceso de un propietario es ser propietario, no el rol.')
    on conflict (account_id, name) do update set permissions = account_roles.permissions
    returning id into v_owner_role_id;

  insert into account_roles (account_id, name, is_system, permissions, description)
    values (target_account_id, 'Practitioner', false, v_practitioner_permissions,
            'Atiende a sus pacientes: su calendario, sus fichas, sus notas y sus informes.')
    on conflict (account_id, name) do nothing;

  insert into account_roles (account_id, name, is_system, permissions, description)
    values (target_account_id, 'Front Desk', false, v_front_desk_permissions,
            'Lleva la agenda y el mostrador: todos los pacientes y citas, cobros, caja y bandeja de entrada.')
    on conflict (account_id, name) do nothing;

  return v_owner_role_id;
end;
$function$;

-- patients_matching, restated from 20261105143740_patient_lists_and_audiences
-- with two more filters: types and exercises.
create or replace function public.patients_matching(p_filters jsonb default '{}'::jsonb, p_clinic_id uuid default null)
returns setof public.patients
language plpgsql
stable
set search_path = public
as $$
declare
  f jsonb := coalesce(p_filters, '{}'::jsonb);
  w text[] := array[]::text[];
  v_status text := coalesce(nullif(f->>'status', ''), 'active');
  v_clinic text := nullif(f->>'clinic', '');
  v_clinic_id uuid;
  v_tz text;
  v_tags text[];
  v_token text;
  v_like text;
  v_last_visit text := '(select max(a.starts_at) from appointments a where a.patient_id = p.id and a.status = ''completed'' and a.deleted_at is null)';
  v_bono_left text := '(select coalesce(sum(pp.sessions_total - pp.sessions_used), 0) from package_purchases pp'
    || ' where not pp.is_closed and pp.sessions_used < pp.sessions_total'
    || ' and pp.id in (select o.id from package_purchases o where o.patient_id = p.id'
    || ' union all select s.package_purchase_id from package_purchase_shares s where s.patient_id = p.id))';
begin
  -- Which clinic. The sidebar's clinic unless the filter names another, or
  -- 'all' for every clinic the person can see.
  if v_clinic is null then
    v_clinic_id := p_clinic_id;
  elsif v_clinic <> 'all' then
    v_clinic_id := v_clinic::uuid;
  end if;
  if v_clinic_id is not null then
    w := w || format('p.clinic_id = %L', v_clinic_id);
  end if;
  select c.timezone into v_tz from clinics c where c.id = coalesce(v_clinic_id, p_clinic_id);
  v_tz := coalesce(nullif(v_tz, ''), 'Europe/Madrid');

  if v_status in ('active', 'inactive') then
    w := w || format('p.status = %L', v_status);
  end if;

  if nullif(f->>'practitioner', '') is not null then
    w := w || format('p.default_practitioner_id = %L', (f->>'practitioner')::uuid);
  end if;

  if jsonb_typeof(f->'tags') = 'array' then
    select array_agg(t) into v_tags from jsonb_array_elements_text(f->'tags') t where t <> '';
    if v_tags is not null then
      w := w || format('p.tags @> %L::text[]', v_tags);
    end if;
  end if;

  if nullif(f->>'lastVisitFrom', '') is not null then
    w := w || format('%s >= (%L::date)::timestamp at time zone %L', v_last_visit, (f->>'lastVisitFrom')::date, v_tz);
  end if;
  if nullif(f->>'lastVisitTo', '') is not null then
    w := w || format('%s < ((%L::date) + 1)::timestamp at time zone %L', v_last_visit, (f->>'lastVisitTo')::date, v_tz);
  end if;

  -- Same definition as the list's Next visit column (patient_list_visit_summary).
  if f->>'futureAppointment' in ('yes', 'no') then
    w := w || format(
      '%s exists (select 1 from appointments a where a.patient_id = p.id and a.status = ''booked'' and a.starts_at > now() and a.deleted_at is null)',
      case when f->>'futureAppointment' = 'no' then 'not' else '' end
    );
  end if;

  -- A live bono is what the Billing tab offers sessions from: own or shared,
  -- not closed in PracticeHub (20260923120702), with sessions left.
  if f->>'bono' = 'active' then
    w := w || format('%s > 0', v_bono_left);
    if nullif(f->>'bonoSessionsMax', '') is not null then
      w := w || format('%s <= %s', v_bono_left, greatest((f->>'bonoSessionsMax')::int, 0));
    end if;
  elsif f->>'bono' = 'none' then
    w := w || format('%s = 0', v_bono_left);
  end if;

  -- Owing asks the invoices, In credit the balance -- two different columns
  -- on purpose; see 20260923160000 and utils/owing.ts. Read from the view as
  -- one set, not through live_outstanding_cents(p) per row: on 3,300
  -- patients the computed field took 7.6 s (the view recomputed once per
  -- patient) and the set 80 ms. Same view, same RLS, same numbers.
  if f->>'balance' = 'owing' then
    w := w || 'p.id in (select b.patient_id from patient_live_balances b where b.outstanding_cents > 0)'::text;
  elsif f->>'balance' = 'credit' then
    w := w || 'p.id in (select b.patient_id from patient_live_balances b where b.balance_cents > 0)'::text;
  end if;

  if nullif(f->>'createdFrom', '') is not null then
    w := w || format('p.created_at >= (%L::date)::timestamp at time zone %L', (f->>'createdFrom')::date, v_tz);
  end if;
  if nullif(f->>'createdTo', '') is not null then
    w := w || format('p.created_at < ((%L::date) + 1)::timestamp at time zone %L', (f->>'createdTo')::date, v_tz);
  end if;

  -- What the patient banner calls "has the app" (components/patients/AppStatus.vue).
  if f->>'app' in ('yes', 'no') then
    w := w || format(
      '%s exists (select 1 from app_opens o where o.account_id = p.account_id and o.user_id = p.user_id)',
      case when f->>'app' = 'no' then 'not' else '' end
    );
  end if;

  if f->>'birthdayThisMonth' = 'true' then
    w := w || format('extract(month from p.date_of_birth) = extract(month from now() at time zone %L)', v_tz);
  end if;

  if f->>'carePlan' = 'on' then
    w := w || 'exists (select 1 from care_plans cp where cp.patient_id = p.id)'::text;
  end if;

  if f->>'missingContact' = 'email' then
    w := w || '(p.email is null or p.email = '''')'::text;
  elsif f->>'missingContact' = 'phone' then
    w := w || 'not p.has_phone'::text;
  end if;

  if f->>'doNotContact' = 'true' then
    w := w || 'p.do_not_contact'::text;
  end if;
  if f->>'minors' = 'true' then
    w := w || 'p.is_minor'::text;
  end if;

  -- On a list, or not on one (patient_list_members). Read under the caller's
  -- RLS like everything else here, so a private list someone else made
  -- matches nobody rather than leaking who is on it.
  if nullif(f->>'list', '') is not null then
    w := w || format('p.id in (select lm.patient_id from patient_list_members lm where lm.list_id = %L)', (f->>'list')::uuid);
  end if;
  if nullif(f->>'notList', '') is not null then
    w := w || format('p.id not in (select lm.patient_id from patient_list_members lm where lm.list_id = %L)', (f->>'notList')::uuid);
  end if;

  -- Family on the record (patient_relations, 20261021171628). 'linked' is
  -- anyone at all, 'none' nobody; a relation names what the OTHER person is
  -- to this one, as the table reads -- 'child' is "has a child on file",
  -- which is how a segment of parents is asked for.
  if f->>'family' = 'linked' then
    w := w || 'exists (select 1 from patient_relations r where r.patient_id = p.id)'::text;
  elsif f->>'family' = 'none' then
    w := w || 'not exists (select 1 from patient_relations r where r.patient_id = p.id)'::text;
  elsif f->>'family' in ('parent', 'child', 'partner', 'sibling') then
    w := w || format('exists (select 1 from patient_relations r where r.patient_id = p.id and r.relation = %L)', f->>'family');
  end if;

  -- Shares a bono with somebody, either way round: the bono-sharing graph
  -- that pools a family's money (package_share_edges, 20260923165911).
  if f->>'familyBono' = 'true' then
    w := w || 'exists (select 1 from package_share_edges e where e.a = p.id)'::text;
  end if;

  -- Marketing consent as stored: a channel present in marketing_channels.
  -- A withdrawn channel is its absence (20260930141326).
  if f->>'marketing' in ('email', 'whatsapp') then
    w := w || format('%L = any (p.marketing_channels)', f->>'marketing');
  elsif f->>'marketing' = 'any' then
    w := w || 'cardinality(p.marketing_channels) > 0'::text;
  elsif f->>'marketing' = 'none' then
    w := w || 'cardinality(p.marketing_channels) = 0'::text;
  end if;

  -- Patient types (patient_type_members): any of the ones named.
  if jsonb_typeof(f->'types') = 'array' and jsonb_array_length(f->'types') > 0 then
    w := w || format('p.id in (select tm.patient_id from patient_type_members tm where tm.type_id = any (%L::uuid[]))',
      (select array_agg(x::uuid) from jsonb_array_elements_text(f->'types') x));
  end if;

  -- Home exercises (the Exercises section): any on, none on, or on but
  -- ticked on fewer than three of the last seven days.
  if f->>'exercises' = 'yes' then
    w := w || 'exists (select 1 from patient_exercises pe where pe.patient_id = p.id and pe.ended_at is null)'::text;
  elsif f->>'exercises' = 'no' then
    w := w || 'not exists (select 1 from patient_exercises pe where pe.patient_id = p.id and pe.ended_at is null)'::text;
  elsif f->>'exercises' = 'low' then
    w := w || ('exists (select 1 from patient_exercises pe where pe.patient_id = p.id and pe.ended_at is null)'
      || ' and (select count(distinct l.done_on) from patient_exercise_logs l join patient_exercises pe on pe.id = l.patient_exercise_id'
      || ' where pe.patient_id = p.id and l.done_on > current_date - 7) < 3')::text;
  end if;

  -- Every word must match one of the four, as the list's search always has.
  -- LIKE's own wildcards and escape are taken out of what was typed.
  for v_token in
    select regexp_replace(x, '[%_\\,()]', '', 'g') from regexp_split_to_table(btrim(coalesce(f->>'q', '')), '\s+') x
  loop
    continue when v_token = '';
    v_like := '%' || v_token || '%';
    w := w || format(
      '(p.search_name ilike %L or p.email ilike %L or p.national_id ilike %L or p.phone_search ilike %L)',
      '%' || unaccent_lower(v_token) || '%', v_like, v_like, v_like
    );
  end loop;

  return query execute 'select p.* from patients p where '
    || coalesce(nullif(array_to_string(w, ' and '), ''), 'true');
end;
$$;


-- merge_patients, restated from 20261105195702_merge_patients_keeps_lists_and_habits
-- with patient_type_members moved (CLAUDE.md: a new patient_id column is two
-- changes). The next migration that restates it must start from this one.
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

  -- Lists (patient_list_members, 20261105143740): the survivor is on every
  -- list either record was on. Where both were, the survivor's own entry is
  -- kept -- it is the earlier added_at only by accident, but it is the one
  -- an automation may already have acted on.
  delete from patient_list_members d
   where d.patient_id = p_duplicate_id
     and exists (select 1 from patient_list_members s where s.patient_id = p_survivor_id and s.list_id = d.list_id);
  update patient_list_members set patient_id = p_survivor_id where patient_id = p_duplicate_id;
  get diagnostics v_count = row_count;
  v_moved := v_moved || jsonb_build_object('patient_list_members', v_count);

  -- Segment stays (patient_segment_members): the history moves, except a
  -- current stay where the survivor has one of its own, which would be two
  -- at once. The next refresh settles whether the merged record still
  -- matches.
  delete from patient_segment_members d
   where d.patient_id = p_duplicate_id and d.left_at is null
     and exists (select 1 from patient_segment_members s where s.patient_id = p_survivor_id and s.segment_id = d.segment_id and s.left_at is null);
  update patient_segment_members set patient_id = p_survivor_id where patient_id = p_duplicate_id;
  get diagnostics v_count = row_count;
  v_moved := v_moved || jsonb_build_object('patient_segment_members', v_count);

  -- Habit check-ins (Cuidarme › Mis hábitos, 20261105162805): the person's own
  -- record of looking after themselves, and their streak with it.
  update habit_checkins set patient_id = p_survivor_id where patient_id = p_duplicate_id;
  get diagnostics v_count = row_count;
  v_moved := v_moved || jsonb_build_object('habit_checkins', v_count);

  -- Patient types (patient_type_members, 20261109181443): the survivor has
  -- every type either record had, the survivor's own entry kept where both
  -- had it. The exercises a type gave moved with patient_exercises above.
  delete from patient_type_members d
   where d.patient_id = p_duplicate_id
     and exists (select 1 from patient_type_members s where s.patient_id = p_survivor_id and s.type_id = d.type_id);
  update patient_type_members set patient_id = p_survivor_id where patient_id = p_duplicate_id;
  get diagnostics v_count = row_count;
  v_moved := v_moved || jsonb_build_object('patient_type_members', v_count);

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
