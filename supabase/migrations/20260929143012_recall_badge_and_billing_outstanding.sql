-- Two figures the app was paying far too much to read: the sidebar's recalls
-- badge and the outstanding total in the Billing header.
--
-- recall_badge_count --------------------------------------------------------
--
-- The badge was an exact PostgREST count over recall_candidates, the one
-- /recalls itself gave up counting. What makes that view expensive to count
-- is not the columns -- Postgres already drops the balances and no-show joins
-- when nothing reads them -- but where the scan starts. The only thing tying
-- a patients row to the caller is row-level security, and an RLS predicate
-- (account_id = ANY(hashed my_member_account_ids())) is a filter, never an
-- index condition, so every count read the WHOLE patients table, every
-- clinic's, and threw away all but the caller's rows. On the local seed that
-- is 26,794 rows read to keep 1,600, and it grows with every account on the
-- platform rather than with the one asking.
--
-- So this asks the same view the same question with one predicate added:
-- the account is one the caller is a member of, or the patient is the caller
-- themselves. That is exactly the union of patients' two permissive SELECT
-- policies ("staff select patients" requires the first, "patients view own
-- record" the second), so it can only remove rows RLS already removes and the
-- count is identical -- checked against the old query for every team member
-- in the local database. Written as = any(array(...)) because that form is an
-- InitPlan the planner can use as an index condition; `in (select ...)` is
-- the hashed filter we are trying to get away from. The scan then starts at
-- patients_account_idx, on the caller's own patients only.
--
-- Locally, median of six: 15.4 -> 12.4 ms on the largest account (1,600
-- patients), 7.5 -> 3.7 ms on a 1,052-patient one, 8.9 -> 2.7 ms on a 321-
-- patient one. What remains is one last-visit lookup per patient of the
-- account, which is the count itself; what went is the part that grew with
-- every other clinic on the platform.
--
-- It stays an exact count over the view rather than a copy of the view's
-- rules, so the badge cannot drift from the list it links to. p_clinic_id is
-- the same "this clinic or none" scoping the Recalls page applies.
--
-- billing_outstanding -------------------------------------------------------
--
-- The Billing header pulled every unpaid invoice (paged past 1000), then every
-- payment on them in chunks of 150 ids -- because the id list outgrows a URL
-- long before it outgrows a page -- to add up one number in the browser. Same
-- rules here, one round trip: unpaid invoices only, every payment row against
-- each (refunds and all, exactly what the page summed), what is left of each
-- invoice floored at zero before adding, so an overpaid invoice does not eat
-- into another's debt. The count is the number of unpaid invoices, paid down
-- or not. p_patient_id is the page's ?patient= filter.
--
-- Both are security invoker (the default): invoices', payments' and patients'
-- RLS apply as they did to the queries they replace.
create or replace function public.recall_badge_count(p_min_days integer, p_clinic_id uuid default null)
returns integer
language sql
stable
set search_path = public
as $$
  select count(*)::integer
  from recall_candidates rc
  where rc.days_since_last_appointment >= p_min_days
    and (p_clinic_id is null or rc.clinic_id = p_clinic_id or rc.clinic_id is null)
    and (
      rc.account_id = any(array(select my_member_account_ids()))
      or rc.patient_id = any(array(select p.id from patients p where p.user_id = (select auth.uid())))
    )
$$;

revoke all on function public.recall_badge_count(integer, uuid) from anon, public;
grant execute on function public.recall_badge_count(integer, uuid) to authenticated, service_role;

create or replace function public.billing_outstanding(p_patient_id uuid default null)
returns table (outstanding_cents bigint, invoice_count integer)
language sql
stable
set search_path = public
as $$
  select coalesce(sum(greatest(0, i.total_cents - coalesce(paid.cents, 0))), 0)::bigint,
         count(*)::integer
  from invoices i
  left join lateral (
    select sum(pay.amount_cents) as cents
    from payments pay
    where pay.invoice_id = i.id
  ) paid on true
  where i.status = 'unpaid'
    and (p_patient_id is null or i.patient_id = p_patient_id)
$$;

revoke all on function public.billing_outstanding(uuid) from anon, public;
grant execute on function public.billing_outstanding(uuid) to authenticated, service_role;
