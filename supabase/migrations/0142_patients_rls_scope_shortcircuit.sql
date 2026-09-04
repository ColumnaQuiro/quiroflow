-- The "staff select patients" policy called can_access_patient(account_id, id)
-- once per row. That function is SECURITY DEFINER, so Postgres can never
-- inline it and can never see what it does -- every row paid a full function
-- invocation, and the planner had no choice but to scan the whole table. A
-- bare `select count(*) from patients` cost 513ms for 1,540 rows. Every
-- patient-scoped query in the app pays this, which is most of why the
-- recalls badge, inbox count and Billing tab each take about a second.
--
-- Two changes, one per permission scope:
--
--   'all' scope (owners, front desk): can_access_patient already returns
--   true immediately for them, but the short-circuit is *inside* the
--   function, so it only helped after the per-row call cost was already
--   paid. Testing the scope in the policy skips the call outright.
--     513ms -> 64ms.
--
--   'own' scope (practitioners): the expensive part is the two EXISTS
--   subqueries, evaluated per row. my_own_patient_ids() returns that set
--   once, so the planner hashes it into a single SubPlan and probes it
--   per row instead of re-running the lookups.
--     1035ms -> 131ms.
--
-- The helpers deliberately take no arguments. A first attempt used
-- permission_scope(account_id, 'patients_scope'), but the account_id column
-- reference forces per-row evaluation, which made 'own'-scope users slower
-- rather than faster. Resolving from auth.uid() alone is safe here:
-- is_account_member(account_id) still scopes rows to the caller's own
-- account independently, so this cannot widen cross-account visibility even
-- if the single-account-per-user assumption ever changed. (The app already
-- assumes it -- stores/account.ts resolves the team member with
-- maybeSingle().)
--
-- my_own_patient_ids() stays SECURITY DEFINER on purpose rather than being
-- inlined into the policy as a plain subquery: inlining would apply the
-- appointments table's own RLS, which itself references patients, and that
-- is a policy-recursion hazard.
--
-- Verified equivalent before shipping, after each policy revision: every
-- team member in the database -- 2 'own'-scope practitioners, an 'all'-scope
-- front desk, and 3 owners across 3 separate accounts -- returns a
-- byte-identical set of patient ids, compared by md5 of the sorted id list
-- rather than row counts alone. The restricted practitioners still see
-- exactly 7 and 427 of 1,540 patients.
create or replace function public.my_patients_scope()
returns text
language sql
stable
security definer
set search_path to 'public'
as $function$
  select case
    when exists (
      select 1 from team_members tm
      where tm.user_id = auth.uid() and tm.is_owner and tm.deleted_at is null
    ) then 'all'
    else coalesce((
      select r.permissions ->> 'patients_scope'
      from team_members tm
      join account_roles r on r.id = tm.role_id
      where tm.user_id = auth.uid() and tm.deleted_at is null
      limit 1
    ), 'none')
  end;
$function$;

create or replace function public.my_team_member_id()
returns uuid
language sql
stable
security definer
set search_path to 'public'
as $function$
  select tm.id from team_members tm
  where tm.user_id = auth.uid() and tm.deleted_at is null
  limit 1;
$function$;

-- Mirrors can_access_patient's 'own' branch: patients this practitioner is
-- the default practitioner for, plus anyone they have an appointment with.
create or replace function public.my_own_patient_ids()
returns setof uuid
language sql
stable
security definer
set search_path to 'public'
as $function$
  select p.id from patients p where p.default_practitioner_id = my_team_member_id()
  union
  select a.patient_id from appointments a where a.practitioner_id = my_team_member_id();
$function$;

revoke all on function public.my_patients_scope() from public;
revoke all on function public.my_team_member_id() from public;
revoke all on function public.my_own_patient_ids() from public;
grant execute on function public.my_patients_scope() to authenticated;
grant execute on function public.my_team_member_id() to authenticated;
grant execute on function public.my_own_patient_ids() to authenticated;

alter policy "staff select patients" on public.patients
using (
  is_account_member(account_id)
  and (
    my_patients_scope() = 'all'
    or ( my_patients_scope() = 'own' and id in (select my_own_patient_ids()) )
  )
);
