-- A progressive dose: no fixed sets or reps, the patient starts gently and
-- builds up as they can. Clinicians asked for it because a number is not
-- always the right prescription -- a stretch or a mobility drill is done "as
-- far as is comfortable, a little more each day", and a typed "2 × 10" made
-- it read as a target. Frequency still applies ("daily").
--
-- A flag rather than a convention in the reps text, so the patient's screen
-- can explain it in their own language and the staff form can hide the
-- numbers. Default false keeps every existing assignment as it was.
--
-- Existing tables, one column each: no new grants, RLS or two-factor policy
-- needed, and no patient_id, so merge_patients and anonymize_patient are
-- unaffected.

alter table public.patient_exercises add column progressive boolean not null default false;
alter table public.exercise_program_items add column progressive boolean not null default false;

-- save_exercise_program carries the flag for each item; otherwise unchanged
-- from 20261009145407_exercise_programs.sql. Same signature, so the deployed
-- app's calls keep working and simply save progressive = false.
create or replace function public.save_exercise_program(p_account_id uuid, p_program_id uuid, p_name text, p_description text, p_items jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
  v_account_id uuid := p_account_id;
begin
  if length(trim(coalesce(p_name, ''))) = 0 then
    raise exception 'A programme needs a name';
  end if;
  if p_program_id is null then
    insert into public.exercise_programs (account_id, name, description, created_by)
    values (
      p_account_id,
      trim(p_name),
      nullif(trim(coalesce(p_description, '')), ''),
      (select tm.id from public.team_members tm where tm.account_id = p_account_id and tm.user_id = auth.uid() limit 1)
    )
    returning id into v_id;
  else
    update public.exercise_programs
    set name = trim(p_name), description = nullif(trim(coalesce(p_description, '')), '')
    where id = p_program_id
    returning id, account_id into v_id, v_account_id;
    if v_id is null then
      raise exception 'Programme not found';
    end if;
    delete from public.exercise_program_items where program_id = v_id;
  end if;
  insert into public.exercise_program_items (account_id, program_id, exercise_id, position, sets, reps, frequency, notes, progressive)
  select v_account_id, v_id, (t.item->>'exercise_id')::uuid, (t.ord - 1)::integer,
         nullif(t.item->>'sets', '')::integer, nullif(trim(t.item->>'reps'), ''), nullif(trim(t.item->>'frequency'), ''), nullif(trim(t.item->>'notes'), ''),
         coalesce((t.item->>'progressive')::boolean, false)
  from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) with ordinality as t(item, ord);
  return v_id;
end;
$$;

grant execute on function public.save_exercise_program(uuid, uuid, text, text, jsonb) to authenticated;
