-- An assignment, and a programme item, must point at the writing clinic's own
-- patient, exercise and programme.
--
-- The staff policies on patient_exercises and exercise_program_items checked
-- only that account_id was one of the caller's accounts -- and account_id is
-- whatever the caller writes. So a member of one clinic could insert
-- patient_exercises (account_id = theirs, patient_id = another clinic's
-- patient, by its uuid): that patient then saw the exercise in their app and
-- portal, could tick it, and the writer could read the ticks back through
-- patient_exercise_logs. exercise_id could likewise name another clinic's
-- exercise, which the patient's own exercises policy then handed over, and a
-- programme item could carry another clinic's exercise into every assignment
-- made from it. The same shape learn_sends was fixed for in 20261017175432.
--
-- patient_exercise_logs needs nothing: staff have no write policy on it, and
-- set_my_exercise_done takes account_id from the assignment itself.
--
-- Nothing in production crossed clinics when this was written (there were no
-- assignments or programme items at all), so there is nothing to clean up.

-- The patient's read of exercises went through a subquery on
-- patient_exercises, and the patient_exercises check below now reads
-- exercises: left as it was, an insert would fail with "infinite recursion
-- detected in policy". Read through a definer function instead, as
-- my_sent_learn_article_ids does for learn_articles.
create or replace function public.my_assigned_exercise_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select pe.exercise_id from public.patient_exercises pe
  join public.patients p on p.id = pe.patient_id
  where p.user_id = auth.uid()
$$;
revoke all on function public.my_assigned_exercise_ids() from public, anon;
grant execute on function public.my_assigned_exercise_ids() to authenticated;

drop policy if exists "patients view their assigned exercises" on public.exercises;
create policy "patients view their assigned exercises" on public.exercises for select
  using (id in (select public.my_assigned_exercise_ids()));

drop policy if exists "staff manage patient_exercises" on public.patient_exercises;
create policy "staff manage patient_exercises" on public.patient_exercises for all
  using (
    account_id in (select public.my_member_account_ids())
    and ((select public.my_patients_scope()) = 'all'
      or ((select public.my_patients_scope()) = 'own' and patient_id in (select public.my_own_patient_ids())))
  )
  with check (
    account_id in (select public.my_member_account_ids())
    and ((select public.my_patients_scope()) = 'all'
      or ((select public.my_patients_scope()) = 'own' and patient_id in (select public.my_own_patient_ids())))
    and exists (select 1 from public.patients p where p.id = patient_id and p.account_id = patient_exercises.account_id)
    and exists (select 1 from public.exercises e where e.id = exercise_id and e.account_id = patient_exercises.account_id)
  );

drop policy if exists "staff manage exercise_program_items" on public.exercise_program_items;
create policy "staff manage exercise_program_items" on public.exercise_program_items for all
  using (account_id in (select public.my_member_account_ids()))
  with check (
    account_id in (select public.my_member_account_ids())
    and exists (select 1 from public.exercise_programs g where g.id = program_id and g.account_id = exercise_program_items.account_id)
    and exists (select 1 from public.exercises e where e.id = exercise_id and e.account_id = exercise_program_items.account_id)
  );
