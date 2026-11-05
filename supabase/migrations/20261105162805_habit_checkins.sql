-- "Mis hábitos" in the patient app's Cuidarme tab: the patient sets their
-- own reminders (drink water, stretch, breathe...), which the phone schedules
-- by itself -- by time, and optionally only while they are at a place they
-- chose. Neither the reminders nor the places come here. What does is each
-- "Hecho": which habit and when, nothing else. Without it there is no streak
-- for a patient who has no exercises, and the clinic cannot see how they are
-- doing at home.
--
-- client_id is the phone's own id for the tick, so a tick queued while
-- offline and uploaded twice is still one tick.

create table public.habit_checkins (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  habit text not null check (habit in ('agua', 'estirar', 'respirar', 'postura', 'levantarse', 'otro')),
  done_at timestamptz not null,
  client_id uuid not null,
  created_at timestamptz not null default now(),
  unique (patient_id, client_id)
);
create index habit_checkins_patient_done on public.habit_checkins (patient_id, done_at desc);
create index habit_checkins_account on public.habit_checkins (account_id);

alter table public.habit_checkins enable row level security;

-- The patient writes and reads their own, for a record of theirs at that
-- clinic, and only for "now-ish": a tick is not a way to backfill a streak.
create policy "patients add own habit_checkins" on public.habit_checkins for insert
  with check (
    patient_id in (select p.id from public.patients p where p.user_id = (select auth.uid()) and p.account_id = habit_checkins.account_id)
    and done_at <= now() + interval '5 minutes'
    and done_at > now() - interval '3 days'
  );
create policy "patients view own habit_checkins" on public.habit_checkins for select
  using (patient_id in (select p.id from public.patients p where p.user_id = (select auth.uid())));
-- Undoing a tick made by mistake.
create policy "patients delete own habit_checkins" on public.habit_checkins for delete
  using (patient_id in (select p.id from public.patients p where p.user_id = (select auth.uid())));

-- Staff read them as they read the record.
create policy "staff view habit_checkins" on public.habit_checkins for select
  using (public.is_account_member(account_id) and public.can_access_patient(account_id, patient_id));

select public.require_two_factor_on('public.habit_checkins');
-- New tables are no longer granted to the Data API by default (30 Oct 2026).
select public.grant_data_api('public.habit_checkins');

-- Audited like the rest of a patient's data. Adds 'habit_checkin' to
-- whatever the constraint allows when this runs (the read-and-append block
-- from 20261022173310), since other branches add entity types too.
do $$
declare
  v_types text[];
begin
  select array_agg(distinct m[1]) into v_types
  from pg_constraint c, regexp_matches(pg_get_constraintdef(c.oid), '([a-z][a-z_]*)', 'g') m
  where c.conname = 'audit_logs_entity_type_check' and c.conrelid = 'public.audit_logs'::regclass
    and m[1] not in ('entity_type', 'text');
  v_types := array(select distinct x from unnest(coalesce(v_types, '{}') || array['habit_checkin']) x order by 1);

  alter table public.audit_logs drop constraint audit_logs_entity_type_check;
  execute format('alter table public.audit_logs add constraint audit_logs_entity_type_check check (entity_type = any (%L::text[]))', v_types);
end;
$$;
create trigger trg_audit_habit_checkins after insert or update or delete on public.habit_checkins
  for each row execute function public.fn_audit_log('habit_checkin');

-- Anonymising a record takes its check-ins with it (as recall_assignments,
-- 20261022185125: a trigger rather than another copy of anonymize_patient).
create or replace function public.patients_drop_habit_checkins_on_anonymize()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.anonymized_at is null and new.anonymized_at is not null then
    delete from public.habit_checkins where patient_id = new.id;
  end if;
  return new;
end;
$$;
revoke execute on function public.patients_drop_habit_checkins_on_anonymize() from public, anon, authenticated;
create trigger patients_drop_habit_checkins_on_anonymize
  after update of anonymized_at on public.patients
  for each row execute function public.patients_drop_habit_checkins_on_anonymize();

-- "Dolor a la mitad" among Cuidarme's achievements: the patient's first
-- and latest pain score (coalesce(practitioner, patient), as every reader
-- of visit_pain_scores takes it). Patients cannot read that table; this
-- hands them the two numbers about themselves and nothing else.
create or replace function public.my_pain_trend()
returns table (first_score smallint, latest_score smallint, latest_on date)
language sql
stable
security definer
set search_path = public
as $$
  with s as (
    select coalesce(v.practitioner_score, v.patient_score) as score, a.starts_at
    from visit_pain_scores v
    join appointments a on a.id = v.appointment_id
    join patients p on p.id = a.patient_id
    where p.user_id = auth.uid()
      and a.deleted_at is null
      and coalesce(v.practitioner_score, v.patient_score) is not null
  )
  select (select score from s order by starts_at asc limit 1),
         (select score from s order by starts_at desc limit 1),
         (select starts_at::date from s order by starts_at desc limit 1)
  where public.mfa_satisfied() and exists (select 1 from s)
$$;
revoke all on function public.my_pain_trend() from public, anon;
grant execute on function public.my_pain_trend() to authenticated;

-- merge_patients moves them: 20261105195702, which restates it from main's
-- latest definition.
