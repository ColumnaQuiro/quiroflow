-- A shared bono settles the family, not just whoever bought it.
--
-- settle_imported_invoices() covered each patient's imported visits out of
-- THEIR OWN payments: `partition by i.patient_id`, joined to a per-patient
-- payment total. PracticeHub links no payment to an invoice, so this is how a
-- migrated visit gets a status at all.
--
-- It has no idea a bono can be shared. A child drawing sessions from a parent's
-- bono has no payments of their own, so their running total always exceeds
-- zero and every visit they ever took reads as unpaid, forever.
--
-- Adela Miralles Andrade is the case that surfaced it: two visits, 43 EUR
-- and 40 EUR, both unpaid, both matching to the cent the per-session rate of
-- bonos owned by Pilar Andrade and Emilio Miralles and shared with her. She
-- has never paid anything herself, because she has never needed to.
--
-- Across the live account that is 34 beneficiaries, 131 invoices and 5,628 EUR
-- of debt that nobody owes -- money the Debtors report has been asking the
-- clinic to chase.
--
-- So settlement now pools by FAMILY: the connected component of the sharing
-- graph, payments and invoices together, still oldest-first. A family that
-- shares bonos pays as one, and this reads them as one.
--
-- Checked against the live data before being written this way. Of the groups
-- carrying unpaid imported invoices, most come out "group covers everything"
-- -- they had already paid more than they were charged -- while two stay
-- genuinely short, 560 EUR and 432 EUR, and correctly remain unpaid. Pooling
-- clears phantom debt without erasing real debt, which is the only reason it
-- is safe to do at all.
--
-- A patient who shares nothing is a component of one, so their settlement is
-- byte-for-byte what it was before.
--
-- This matters beyond fixing the existing rows: PracticeHubLedgerImporter
-- calls this function at the end of every import, so the next clinic to
-- migrate gets it right on the first run rather than inheriting the same
-- phantom debts.
create or replace function settle_imported_invoices(p_account_id uuid)
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
  -- Sharing is mutual for this purpose: money from either side pays for
  -- either side's visits, so the graph is undirected.
  edges as (
    select pp.patient_id as a, s.patient_id as b
    from package_purchase_shares s
    join package_purchases pp on pp.id = s.package_purchase_id
    where pp.account_id = p_account_id
  ),
  undirected as (
    select a, b from edges
    union
    select b, a from edges
  ),
  -- Everyone each patient can reach through sharing, themselves included.
  -- Seeded from patients rather than from edges so that someone who shares
  -- nothing still gets a row -- they are simply a group of one, which is what
  -- keeps this identical to the old behaviour for them.
  --
  -- Transitive on purpose: a bono shared parent -> child and another shared
  -- child -> sibling makes all three one family, and settling the middle one
  -- against only its direct links would leave the far end unpaid again.
  reach (patient_id, member) as (
    select p.id, p.id from patients p where p.account_id = p_account_id
    union
    select r.patient_id, u.b from reach r join undirected u on u.a = r.member
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
      -- A void invoice is not a charge, so it must not eat into the money
      -- available to cover the real ones. There are none in the live account
      -- today; a clinic importing tomorrow may well have some.
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
