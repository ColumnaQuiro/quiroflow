-- A family bono settles the family's invoices but not the family's BALANCE,
-- so every visit a beneficiary takes is billed to them all over again.
--
-- 20260915183351 taught settle_imported_invoices() to pool by family -- the
-- connected component of the sharing graph -- which is why a beneficiary's
-- IMPORTED visits read 'paid'. Nothing taught the live charge path the same
-- thing. Each of the three places that record a bono visit decides whether to
-- mark the charge paid by reading that ONE patient's balance:
--
--   status: balanceCents.value >= perSessionCents ? 'paid' : 'unpaid'
--
-- components/calendar/AppointmentBillingTab.vue, components/patients/
-- BillingTab.vue and mobile/pages/calendar/[id].vue, the same line in all
-- three. A family bono's money sits on the OWNER's record, so a child drawing
-- a session has a balance of their own that is negative by construction, the
-- check fails, and the visit is charged -- to a patient whose family prepaid
-- for it, against a session that has just been drawn off the bono.
--
-- Santiago Nawab is the case that surfaced it. 23 Sep 2026, 15:56: a session
-- came off Henna's Bono 12 (11/12 -> 12/12) and INV-3576 was raised 0.3s
-- later for 44 EUR, unpaid. His own balance was -173 EUR. His family's was
-- +44 EUR -- exactly the one session left on that bono:
--
--   Henna Anis   paid 1,802.00   invoiced 1,153.00
--   Nelson         paid 55.00    invoiced   229.00
--   Santiago        paid 0.00    invoiced   217.00
--   Zion            paid 0.00    invoiced   258.00
--   ------------------------------------------------
--   family       paid 1,857.00   invoiced 1,857.00   net 0.00
--
-- Pooled, the check reads 44 >= 44 and the visit is paid. Per-patient it reads
-- -173 >= 44 and the family is chased for money it has already handed over.
--
-- This is the same phantom debt 20260915183351 cleared from the imported
-- history, arriving one visit at a time on the live path instead. It was
-- known: the fix was written down when the import was settled and not taken
-- up, because at that point no new visit had hit it yet.
--
-- The cause of the duplication is that the graph lived inside
-- settle_imported_invoices() as two CTEs and could not be read from anywhere
-- else, so the client had no pooled number available and used the only one it
-- had. So the graph comes out into its own view and the pooled balance
-- becomes a function the client can call. The settlement function now reads
-- that same view rather than its own copy -- one definition, and the two
-- cannot drift apart again.

-- The sharing graph, undirected. Sharing is mutual for this purpose: money
-- from either side pays for either side's visits. This is exactly the `edges`
-- + `undirected` pair that settle_imported_invoices() carried inline.
create or replace view public.package_share_edges
  with (security_invoker = true)
  as
  select pp.account_id, pp.patient_id as a, s.patient_id as b
  from package_purchase_shares s
  join package_purchases pp on pp.id = s.package_purchase_id
  union
  select pp.account_id, s.patient_id as a, pp.patient_id as b
  from package_purchase_shares s
  join package_purchases pp on pp.id = s.package_purchase_id;

comment on view public.package_share_edges is
  'The bono sharing graph as undirected edges (a shares with b, and b with a). The single definition of "same family" for money: patient_family_members() walks it and settle_imported_invoices() pools by it.';

-- Nothing here is patient-facing, and the browser's anon key has no business
-- reading who shares a bono with whom.
revoke all on public.package_share_edges from anon;

-- Everyone p can reach through sharing, p included. Seeded from p rather than
-- from the edges so someone who shares nothing is a family of one, which is
-- what keeps their balance byte-for-byte what it was.
--
-- Transitive on purpose, matching settlement: a bono shared parent -> child
-- and another shared child -> sibling makes all three one family. `union`
-- rather than `union all` is what terminates on a cycle.
create or replace function public.patient_family_members(p_patient_id uuid)
returns setof uuid
language sql
stable
set search_path = public
as $$
  with recursive reach (member) as (
    select p_patient_id
    union
    select e.b from package_share_edges e join reach r on e.a = r.member
  )
  select member from reach;
$$;

comment on function public.patient_family_members(uuid) is
  'The connected component of the bono sharing graph containing this patient, the patient included. A patient who shares nothing is a component of one.';

-- The family's money as one number.
--
-- Summed from patient_live_balances rather than re-deriving paid - invoiced +
-- credit here: that view was made to agree with usePatientFinancialSummary
-- term for term by 20260923094340, and a second copy of those terms is how
-- the Billing tab and the patients list came to disagree in the first place.
-- One term list, summed over the family.
--
-- SECURITY INVOKER (the default), so the view's own RLS still decides what
-- the caller may read. Staff see their account and get the true family total;
-- a patient reading through the portal sees only their own row and so gets
-- their own balance back, which is a safe answer rather than a leak.
create or replace function public.patient_family_balance_cents(p_patient_id uuid)
returns integer
language sql
stable
set search_path = public
as $$
  select coalesce(sum(b.balance_cents), 0)::integer
  from patient_live_balances b
  where b.patient_id in (select m from public.patient_family_members(p_patient_id) m);
$$;

comment on function public.patient_family_balance_cents(uuid) is
  'Sum of patient_live_balances across this patient''s bono-sharing family. The number a bono visit charge must be tested against: a family bono''s money sits on the owner''s record, so the beneficiary''s own balance is negative by construction.';

-- Settlement, now reading the shared view instead of its own copy of the
-- graph. Everything else is 20260915183351's, unchanged: same pooling, same
-- oldest-first running total, same treatment of void invoices.
create or replace function public.settle_imported_invoices(p_account_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated integer;
begin
  if auth.uid() is not null and not has_permission(p_account_id, 'data_admin') then
    raise exception 'Not permitted';
  end if;

  with recursive
  reach (patient_id, member) as (
    select p.id, p.id from patients p where p.account_id = p_account_id
    union
    select r.patient_id, e.b
    from reach r
    join package_share_edges e on e.a = r.member and e.account_id = p_account_id
  ),
  -- One stable id per component. Every member reaches the same set, so the
  -- minimum is the same for all of them; text because uuid has no min().
  household as (
    select patient_id, min(member::text) as gid
    from reach
    group by patient_id
  ),
  paid as (
    select h.gid, sum(pay.amount_cents) as paid_cents
    from payments pay
    join household h on h.patient_id = pay.patient_id
    where pay.account_id = p_account_id
      and pay.external_reference like 'phpay-%'
    group by h.gid
  ),
  running as (
    select i.id,
           h.gid,
           sum(i.total_cents) over (
             partition by h.gid
             order by i.created_at, i.id
             rows between unbounded preceding and current row
           ) as cumulative_cents
    from invoices i
    join household h on h.patient_id = i.patient_id
    where i.account_id = p_account_id
      and i.external_reference like 'phinv-%'
      and i.status <> 'void'
  ),
  decided as (
    select r.id,
           case when coalesce(p.paid_cents, 0) >= r.cumulative_cents then 'paid' else 'unpaid' end as status
    from running r
    left join paid p on p.gid = r.gid
  )
  update invoices i
  set status = d.status
  from decided d
  where i.id = d.id and i.status <> d.status and i.status <> 'void';

  get diagnostics v_updated = row_count;
  return v_updated;
end;
$$;
