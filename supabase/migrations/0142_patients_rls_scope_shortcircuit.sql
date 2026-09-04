-- The "staff select patients" policy called can_access_patient(account_id, id)
-- once per row. That function is SECURITY DEFINER, which means Postgres can
-- never inline it, so every row paid a full function invocation: a bare
-- `select count(*) from patients` cost 513ms for 1,540 rows, essentially all
-- of it inside that call. Every patient-scoped query in the app pays this,
-- which is a large part of why unrelated panels (recalls badge, inbox count,
-- billing) each take on the order of a second.
--
-- can_access_patient already short-circuits to `true` for 'all' scope, but
-- that short-circuit is *inside* the function, so it only helps after the
-- per-row call overhead has already been paid. Hoisting the scope test into
-- the policy skips the call entirely for full-scope users.
--
-- my_patients_scope() deliberately takes no arguments. An earlier attempt
-- used permission_scope(account_id, 'patients_scope'), but the account_id
-- column reference forces a per-row evaluation, which made restricted-scope
-- users measurably slower rather than faster. Resolving the caller's team
-- member from auth.uid() alone is safe here because the app is
-- single-account-per-user (stores/account.ts resolves it with maybeSingle())
-- and, more importantly, is_account_member(account_id) still scopes rows to
-- the caller's own account independently -- so this cannot widen
-- cross-account visibility even if that assumption ever changed.
--
-- Measured for owner / 'all' scope: 513ms -> 64ms.
-- Restricted 'own' scope is roughly unchanged (~1.0-1.2s); its cost is the
-- two EXISTS subqueries inside can_access_patient, which this does not
-- address.
--
-- Verified equivalent before shipping: every team member in the database --
-- 2 'own'-scope practitioners, an 'all'-scope front desk, and 3 owners
-- across 3 separate accounts -- returns a byte-identical set of patient ids
-- to the previous policy, compared by md5 of the sorted id list rather than
-- row counts alone. The restricted practitioners still see exactly 7 and
-- 427 of 1,540 patients.
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

revoke all on function public.my_patients_scope() from public;
grant execute on function public.my_patients_scope() to authenticated;

alter policy "staff select patients" on public.patients
using (
  is_account_member(account_id)
  and ( my_patients_scope() = 'all' or can_access_patient(account_id, id) )
);
