-- Exercise programmes: a named set of the library's exercises, each with its
-- usual dose, assigned to a patient in one go ("Lumbalgia básica": four
-- exercises, three times a week). Assigning one copies its items into
-- patient_exercises like any other assignment, so a programme edited later
-- changes nothing a patient already has, and the patient side -- the app,
-- the portal, the reminders -- needs nothing new.
--
-- Staff only, like the library itself; patients never read these. No
-- patient_id here, so merge_patients is unaffected. Nothing points at a
-- programme (assignments are copies), so deleting one loses nothing and
-- there is no archive.

create table public.exercise_programs (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  description text,
  created_by uuid references public.team_members(id) on delete set null,
  created_at timestamptz not null default now()
);
create index exercise_programs_account_id_idx on public.exercise_programs (account_id);
create index exercise_programs_created_by_idx on public.exercise_programs (created_by);

create table public.exercise_program_items (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  program_id uuid not null references public.exercise_programs(id) on delete cascade,
  exercise_id uuid not null references public.exercises(id) on delete cascade,
  position integer not null default 0,
  sets integer check (sets is null or sets > 0),
  reps text,
  frequency text,
  notes text,
  created_at timestamptz not null default now()
);
create index exercise_program_items_account_id_idx on public.exercise_program_items (account_id);
create index exercise_program_items_program_id_idx on public.exercise_program_items (program_id);
create index exercise_program_items_exercise_id_idx on public.exercise_program_items (exercise_id);

alter table public.exercise_programs enable row level security;
alter table public.exercise_program_items enable row level security;

create policy "staff manage exercise_programs" on public.exercise_programs for all
  using (account_id in (select public.my_member_account_ids()))
  with check (account_id in (select public.my_member_account_ids()));

create policy "staff manage exercise_program_items" on public.exercise_program_items for all
  using (account_id in (select public.my_member_account_ids()))
  with check (account_id in (select public.my_member_account_ids()));

select public.require_two_factor_on('public.exercise_programs');
select public.require_two_factor_on('public.exercise_program_items');

-- Saves a programme and its items in one go: a new one when p_program_id is
-- null, otherwise its name, description and the whole list replaced. One
-- transaction, so an edit never leaves a programme half-saved. Security
-- invoker: every statement runs under the caller's RLS (and two-factor),
-- exactly as the table writes it replaces would.
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
  insert into public.exercise_program_items (account_id, program_id, exercise_id, position, sets, reps, frequency, notes)
  select v_account_id, v_id, (t.item->>'exercise_id')::uuid, (t.ord - 1)::integer,
         nullif(t.item->>'sets', '')::integer, nullif(trim(t.item->>'reps'), ''), nullif(trim(t.item->>'frequency'), ''), nullif(trim(t.item->>'notes'), '')
  from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) with ordinality as t(item, ord);
  return v_id;
end;
$$;

grant execute on function public.save_exercise_program(uuid, uuid, text, text, jsonb) to authenticated;
