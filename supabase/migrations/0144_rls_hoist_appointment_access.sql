-- Third and last pass of the same fix (0142 did patients, 0143 did invoices,
-- payments, invoice_line_items, patient_docs and patient_files). This one
-- covers `appointments`, and finishes `patients`.
--
-- After 0143 landed, the slowest query left in the whole app was the sidebar's
-- recall badge -- 1,154-1,889ms measured in the browser, and it runs on *every
-- page*, not just Recalls. EXPLAIN showed why: `recall_candidates` joins
-- patients to appointments, and the appointments policy still had the original
-- shape, with three column-argument SECURITY DEFINER calls per row:
--
--   is_account_member(account_id)
--   AND ( permission_scope(account_id, 'calendar_scope') = 'all'
--         OR practitioner_id = current_team_member_id(account_id) )
--
-- The lateral "last appointment" aggregate ran 1,397 times, each re-applying
-- that filter: 28,364 buffers on its own. Worse, RLS predicates are opaque to
-- the planner, so it estimated 5 rows out of `patients` where the real answer
-- was 1,540 -- and on that estimate it picked a nested loop anti join that
-- threw away 305,986 rows at the join filter. Without RLS the same query plans
-- a hash anti join and runs in 38ms.
--
-- Hoisting both policies fixes the cost *and* the estimate, and the two
-- compound, because recall_candidates reads through both tables:
--
--   appointments        2,761ms ->  79ms  (35.1x)
--   recall_candidates   2,090ms -> 101ms  (20.8x)
--   patients              467ms ->  22ms  (21.1x)
--
-- appointments has no FOR ALL policy, so unlike 0143 only the SELECT policy
-- needed rewriting; the insert/update/delete policies are single-row and are
-- left alone.
--
-- The patients change here is a pure mechanical hoist of what 0142 already
-- wrote -- same functions, same logic, just evaluated once instead of per row.
-- is_account_member(account_id) becomes a set membership test, and the two
-- my_patients_scope() calls are wrapped in a scalar subquery so Postgres
-- resolves them as an InitPlan.
--
-- Equivalence verified the same way as 0143, for all 6 real team members
-- (3 owners across 3 accounts, an 'all'-scope front desk, and 2 'own'-scope
-- practitioners): byte-identical row-id sets on all three relations, compared
-- as md5 of the sorted id list -- 19,205 appointment rows, 3,518 patient rows
-- and 1,927 recall candidates summed across users, before and after.

-- Accounts where the caller's calendar_scope resolves to 'all'.
create or replace function public.my_all_calendar_scope_accounts()
returns setof uuid
language sql
stable
security definer
set search_path to 'public'
as $function$
  select tm.account_id from team_members tm
  where tm.user_id = auth.uid() and tm.deleted_at is null
    and permission_scope(tm.account_id, 'calendar_scope') = 'all';
$function$;

-- The caller's own team_member id in each account they belong to. Replaces
-- `practitioner_id = current_team_member_id(account_id)`: pairing the id with
-- its account keeps that exactly as strict, including for a user who is a
-- member of more than one account.
create or replace function public.my_team_member_identities()
returns table(account_id uuid, team_member_id uuid)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select tm.account_id, tm.id from team_members tm
  where tm.user_id = auth.uid() and tm.deleted_at is null;
$function$;

revoke all on function public.my_all_calendar_scope_accounts() from public;
revoke all on function public.my_team_member_identities() from public;
grant execute on function public.my_all_calendar_scope_accounts() to authenticated;
grant execute on function public.my_team_member_identities() to authenticated;

alter policy "staff select appointments" on public.appointments
using (
  account_id in (select public.my_member_account_ids())
  and (
    account_id in (select public.my_all_calendar_scope_accounts())
    or (account_id, practitioner_id) in (select * from public.my_team_member_identities())
  )
);

alter policy "staff select patients" on public.patients
using (
  account_id in (select public.my_member_account_ids())
  and (
    (select public.my_patients_scope()) = 'all'
    or ( (select public.my_patients_scope()) = 'own' and id in (select public.my_own_patient_ids()) )
  )
);
