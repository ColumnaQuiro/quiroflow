-- Owing a patient money and having a negative balance are different things.
--
-- patient_live_balances is paid minus invoiced plus credit, over everything
-- that ever happened to a patient. 20260923094340 made it count unallocated
-- payments and took the account's reported debt from 994 patients to 49. The
-- 49 are the same mistake one layer down: the money that settled the charge
-- does not sit on the same patient row as the charge.
--
--   * A family bono. settle_imported_invoices() pools payments and invoices
--     across the sharing graph (20260915183351), so a beneficiary's visits are
--     correctly marked paid out of the owner's money -- while their own
--     paid-minus-invoiced still reads as debt. 15 patients, 1,881 EUR.
--     Nelson Sandoval showed "174,00 EUR due" for four visits drawn on Henna
--     Anis Nawab's Bono 12 and Bono 14, at 44,00 and 43,00 -- the two bonos'
--     per-session rates, to the cent. His Money tab printed that figure
--     directly above "Nothing outstanding."
--   * A bono sale raises no invoice on purpose (20260914150556), so money paid
--     for one sits in the balance until the sessions are used.
--
-- Measured on the live account: 49 patients and 6,326 EUR read as owing from
-- the balance, against 10 patients and 508 EUR who have an invoice that is
-- actually unpaid.
--
-- So owing is the SMALLER of two upper bounds, because both err upwards and a
-- patient owes only what the two agree on:
--
--   * what the invoices say -- the ones not 'paid' (however they got there,
--     which is where the family settlement already wrote its answer) and not
--     'void', less whatever payments are allocated to each, floored per
--     invoice so an overpayment on one charge is not a discount on another.
--     This overstates wherever money arrived without settling a particular
--     charge, which is every imported payment and every bono sale.
--   * what the money says -- invoiced minus paid, no credit term. This
--     overstates wherever the money sits on another patient's row, which is
--     the family bono above.
--
-- Refunds are excluded from both -- a rectificativa is money going the other
-- way (0128: is_refund, negative total). Credit is excluded from the money
-- term deliberately: an unpaid invoice is still unpaid while the patient holds
-- credit beside it, because applying it is a decision somebody makes rather
-- than something that has already happened.
--
-- balance_cents stays exactly as it is. It is the right answer to how the
-- account stands, and recall_candidates, the data exports and the "In credit"
-- filter all want that rather than this. utils/owing.ts is this arithmetic in
-- TypeScript, for the composable, with unit tests in
-- tests/unit/owing-is-an-unpaid-invoice.test.ts.
--
-- Appended as the last column: `create or replace view` cannot reorder or
-- retype the existing ones, and recall_candidates takes its column type from
-- balance_cents. security_invoker is restated deliberately -- replacing a view
-- without it resets the option to the default, which is how this view once
-- became SECURITY DEFINER and served every account's rows to anon.
create or replace view public.patient_live_balances
  with (security_invoker = true)
  as
  select
    p.id as patient_id,
    p.account_id,
    (coalesce(pay.paid_cents, 0) - coalesce(inv.invoiced_cents, 0) + coalesce(cred.credit_cents, 0))::integer as balance_cents,
    least(
      coalesce(owed.unpaid_cents, 0),
      greatest(0, coalesce(owed.charged_cents, 0) - coalesce(pay.paid_cents, 0))
    )::integer as outstanding_cents
  from patients p
  left join lateral (
    select sum(i.total_cents) as invoiced_cents
    from invoices i
    where i.patient_id = p.id and i.status <> 'void'
  ) inv on true
  left join lateral (
    -- payments.patient_id since 0170. The join to invoices is LEFT and carries
    -- no WHERE of its own, so an unallocated payment survives it; it is here
    -- only for the status the credit-on-void rule needs. coalesce matters:
    -- without it `i.status = 'void'` is NULL for a payment with no invoice,
    -- NOT NULL is NULL, and the row would be filtered out -- reintroducing
    -- precisely the bug 20260923094340 removed.
    select sum(pay.amount_cents) as paid_cents
    from payments pay
    left join invoices i on i.id = pay.invoice_id
    where pay.patient_id = p.id
      and not (pay.method = 'credit' and coalesce(i.status, '') = 'void')
  ) pay on true
  left join lateral (
    select sum(c.amount_cents) as credit_cents
    from account_credits c
    where c.patient_id = p.id
      and (c.payment_id is null or coalesce(c.external_reference, '') like 'bono-cutover-%')
  ) cred on true
  left join lateral (
    -- Both of outstanding_cents' terms, over the same set of invoices: live,
    -- and not refunds. inv.invoiced_cents above cannot be reused for the money
    -- term because balance_cents needs refunds counted -- a rectificativa's
    -- negative total is what gives the patient their money back there -- while
    -- here it would quietly reduce what somebody owes.
    select
      sum(greatest(0, i.total_cents - coalesce(alloc.allocated_cents, 0)))
        filter (where i.status <> 'paid') as unpaid_cents,
      sum(i.total_cents) as charged_cents
    from invoices i
    left join lateral (
      select sum(pp.amount_cents) as allocated_cents
      from payments pp
      where pp.invoice_id = i.id
    ) alloc on true
    where i.patient_id = p.id
      and i.status <> 'void'
      and coalesce(i.is_refund, false) = false
  ) owed on true;

-- Grants survive `create or replace view`, but this is the control that keeps
-- the browser's anon key out and it is cheap to restate rather than assume.
revoke all on public.patient_live_balances from anon;

-- The patient list's "Owing" filter runs in the database as a computed field
-- (20260923150000), so it needs this one beside live_balance_cents. Reads the
-- view rather than repeating the arithmetic, so the filter and the figure in
-- the same row cannot disagree.
create or replace function public.live_outstanding_cents(p public.patients)
returns integer
language sql
stable
set search_path = public
as $$
  select b.outstanding_cents from patient_live_balances b where b.patient_id = p.id
$$;

revoke all on function public.live_outstanding_cents(public.patients) from anon, public;
grant execute on function public.live_outstanding_cents(public.patients) to authenticated, service_role;
