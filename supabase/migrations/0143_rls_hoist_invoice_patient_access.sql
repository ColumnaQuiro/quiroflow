-- 0142 fixed the `patients` policy, which was the same problem in a different
-- place: can_access_patient() is SECURITY DEFINER, so Postgres can never
-- inline it, never see what it does, and has to call it once per row. This
-- migration finishes the job for the five *other* tables whose policies still
-- call it -- invoices, payments, invoice_line_items, patient_docs and
-- patient_files.
--
-- Those five were left much worse off than patients ever was, because the
-- payments and invoice_line_items policies wrap the call in
-- `EXISTS (SELECT 1 FROM invoices i WHERE ... can_access_patient(...))`.
-- Postgres turns that into a hashed SubPlan, which it builds by scanning
-- *every* invoice and calling can_access_patient (which itself calls
-- permission_scope -- a second SECURITY DEFINER hop) on each one. Measured on
-- production data: 3,278 invoice rows x 0.64ms per call = 2.1 seconds, paid
-- again on every single query. `select count(*) from payments` took 2.2s, and
-- the dashboard fires three payments queries at once, so its widgets were
-- landing at 3.6-4.3s each.
--
-- The fix is the same shape 0142 used: resolve the caller's access *once* into
-- a set the planner can hash, then probe that set per row.
--
--   my_all_patient_scope_accounts()  accounts where my patients_scope = 'all'
--   my_own_patient_access()          (account_id, patient_id) pairs I can
--                                    reach when my scope is 'own'
--   my_accessible_invoice_ids()      invoices passing the above
--   my_permitted_accounts(perm)      accounts where has_permission(acct, perm)
--   my_member_account_ids()          accounts I belong to (= is_account_member)
--
-- Unlike 0142's helpers these stay account-aware: they resolve the scope per
-- account the caller belongs to, rather than from auth.uid() alone. The
-- account_id never reaches the policy as a column reference (which is what
-- forces per-row evaluation and is why 0142 avoided it) -- it is resolved
-- inside the helper, over the caller's own handful of team_members rows, so
-- the whole thing is still a single hoisted InitPlan. That keeps these
-- policies exactly as strict as can_access_patient was, including for a user
-- who is a member of more than one account.
--
-- my_accessible_invoice_ids() and my_editable_invoice_ids() are SECURITY
-- DEFINER for the same reason 0142 gave for my_own_patient_ids(): reading
-- invoices from inside a policy would re-apply the invoices policy, which is
-- both a recursion hazard and the doubling that made these queries slow in the
-- first place.
--
-- Also rewrites the two `FOR ALL` write policies. They are not write-only:
-- permissive policies are OR'd together per command, so an ALL policy's USING
-- expression is evaluated on SELECT as well, and these two carried a second
-- copy of the same expensive EXISTS. Leaving them alone would have capped the
-- read win at ~3x.
--
-- Verified against production data before shipping, for all 6 real team
-- members (3 owners on 3 separate accounts, 1 'all'-scope front desk, and 2
-- 'own'-scope practitioners who see 7 and 427 of 1,540 patients):
--
--   * every rewritten policy returns a byte-identical set of row ids,
--     compared as md5 of the sorted id list rather than row counts alone,
--     across all five tables;
--   * the boolean the old and new USING/WITH CHECK expressions produce is
--     identical row-for-row on both write policies -- 0 mismatches out of
--     19,548 (payments) and 19,674 (invoice_line_items) evaluations, with the
--     same number of rows allowed either way;
--   * `select count(*)` on each table, summed over all 6 users:
--       payments           15,680ms ->  365ms  (42.9x)
--       invoice_line_items 15,488ms ->  367ms  (42.2x)
--       invoices            6,748ms ->  339ms  (19.9x)
--       patient_docs        5,211ms ->   36ms (144.7x)
--       patient_files       4,870ms ->   39ms (125.8x)
--       total                48.0s  ->  1.15s  (41.7x)
--     payments and invoice_line_items were stuck at ~3x until the FOR ALL
--     policies below were rewritten too -- that second copy of the expensive
--     EXISTS was most of what remained.

-- Accounts the caller belongs to. Mirrors is_account_member(account_id)
-- exactly, including its lack of a deleted_at filter.
create or replace function public.my_member_account_ids()
returns setof uuid
language sql
stable
security definer
set search_path to 'public'
as $function$
  select tm.account_id from team_members tm where tm.user_id = auth.uid();
$function$;

-- Accounts where the caller's patients_scope resolves to 'all' -- i.e. where
-- can_access_patient() would have returned true for every patient.
create or replace function public.my_all_patient_scope_accounts()
returns setof uuid
language sql
stable
security definer
set search_path to 'public'
as $function$
  select tm.account_id
  from team_members tm
  where tm.user_id = auth.uid()
    and tm.deleted_at is null
    and permission_scope(tm.account_id, 'patients_scope') = 'all';
$function$;

-- Mirrors can_access_patient()'s 'own' branch, as (account, patient) pairs:
-- patients this team member is the default practitioner for, plus anyone they
-- have an appointment with. Joining through team_members.id is what keeps the
-- pair account-correct -- a practitioner id only ever belongs to one account.
create or replace function public.my_own_patient_access()
returns table(account_id uuid, patient_id uuid)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with own_accounts as (
    select tm.id as team_member_id, tm.account_id
    from team_members tm
    where tm.user_id = auth.uid()
      and tm.deleted_at is null
      and permission_scope(tm.account_id, 'patients_scope') = 'own'
  )
  select oa.account_id, p.id
  from own_accounts oa
  join patients p on p.default_practitioner_id = oa.team_member_id
  union
  select oa.account_id, a.patient_id
  from own_accounts oa
  join appointments a on a.practitioner_id = oa.team_member_id;
$function$;

-- Accounts where has_permission(account_id, perm_key) holds, resolved once
-- over the caller's own team_members rows instead of per data row.
create or replace function public.my_permitted_accounts(perm_key text)
returns setof uuid
language sql
stable
security definer
set search_path to 'public'
as $function$
  select tm.account_id
  from team_members tm
  where tm.user_id = auth.uid()
    and tm.deleted_at is null
    and has_permission(tm.account_id, perm_key);
$function$;

-- Invoices the caller may read. Replaces the per-row
-- EXISTS(... can_access_patient ...) that payments and invoice_line_items used.
create or replace function public.my_accessible_invoice_ids()
returns setof uuid
language sql
stable
security definer
set search_path to 'public'
as $function$
  select i.id
  from invoices i
  where i.account_id in (select my_all_patient_scope_accounts())
     or (i.account_id, i.patient_id) in (select * from my_own_patient_access());
$function$;

-- Invoices the caller may edit -- readable, plus the financials_edit_* check
-- the invoice_line_items write policy applies against the *invoice's* account
-- and creation date.
create or replace function public.my_editable_invoice_ids()
returns setof uuid
language sql
stable
security definer
set search_path to 'public'
as $function$
  select i.id
  from invoices i
  where (
          i.account_id in (select my_all_patient_scope_accounts())
          or (i.account_id, i.patient_id) in (select * from my_own_patient_access())
        )
    and (
          i.account_id in (select my_permitted_accounts('financials_edit_all'))
          or (
               i.account_id in (select my_permitted_accounts('financials_edit_same_day_only'))
               and i.created_at::date = current_date
             )
        );
$function$;

revoke all on function public.my_member_account_ids() from public;
revoke all on function public.my_all_patient_scope_accounts() from public;
revoke all on function public.my_own_patient_access() from public;
revoke all on function public.my_permitted_accounts(text) from public;
revoke all on function public.my_accessible_invoice_ids() from public;
revoke all on function public.my_editable_invoice_ids() from public;

grant execute on function public.my_member_account_ids() to authenticated;
grant execute on function public.my_all_patient_scope_accounts() to authenticated;
grant execute on function public.my_own_patient_access() to authenticated;
grant execute on function public.my_permitted_accounts(text) to authenticated;
grant execute on function public.my_accessible_invoice_ids() to authenticated;
grant execute on function public.my_editable_invoice_ids() to authenticated;

-- is_account_member(account_id) AND can_access_patient(account_id, patient_id)
alter policy "staff select invoices" on public.invoices
using (
  account_id in (select public.my_member_account_ids())
  and (
    account_id in (select public.my_all_patient_scope_accounts())
    or (account_id, patient_id) in (select * from public.my_own_patient_access())
  )
);

alter policy "staff select patient_docs" on public.patient_docs
using (
  account_id in (select public.my_member_account_ids())
  and (
    account_id in (select public.my_all_patient_scope_accounts())
    or (account_id, patient_id) in (select * from public.my_own_patient_access())
  )
);

alter policy "staff select patient_files" on public.patient_files
using (
  account_id in (select public.my_member_account_ids())
  and (
    account_id in (select public.my_all_patient_scope_accounts())
    or (account_id, patient_id) in (select * from public.my_own_patient_access())
  )
);

alter policy "staff select invoice_line_items" on public.invoice_line_items
using (
  account_id in (select public.my_member_account_ids())
  and invoice_id in (select public.my_accessible_invoice_ids())
);

alter policy "staff select payments" on public.payments
using (
  account_id in (select public.my_member_account_ids())
  and invoice_id in (select public.my_accessible_invoice_ids())
);

-- FOR ALL policies. Their USING expression is evaluated on SELECT too, so
-- these carry as much of the read cost as the select policies above.
alter policy "staff write payments" on public.payments
using (
  account_id in (select public.my_member_account_ids())
  and account_id in (select public.my_permitted_accounts('payments_allocate'))
  and invoice_id in (select public.my_accessible_invoice_ids())
)
with check (
  account_id in (select public.my_member_account_ids())
  and account_id in (select public.my_permitted_accounts('payments_allocate'))
  and invoice_id in (select public.my_accessible_invoice_ids())
);

alter policy "staff write invoice_line_items" on public.invoice_line_items
using (
  account_id in (select public.my_member_account_ids())
  and invoice_id in (select public.my_editable_invoice_ids())
)
with check (
  account_id in (select public.my_member_account_ids())
  and invoice_id in (select public.my_editable_invoice_ids())
);
