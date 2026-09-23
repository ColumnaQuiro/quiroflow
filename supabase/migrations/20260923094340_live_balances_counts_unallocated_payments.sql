-- patient_live_balances counted only the payments that were attached to an
-- invoice, so it reported money that had plainly been paid as still owing.
--
-- The paid_cents lateral reached payments through an inner join to invoices.
-- A payment with no invoice_id therefore contributed nothing, and the patient
-- was left carrying the full invoiced total as debt.
--
-- Having no invoice_id is the normal case here, not an anomaly:
--
--   * Imported PracticeHub payments come across unallocated, because
--     PracticeHub allocates them to nothing. 3,262 of them on the live
--     account, every single one with a null invoice_id.
--   * A bono sale raises no invoice on purpose -- 20260914150556 removed it,
--     because the bono's own charge plus each visit's charge billed the
--     patient twice -- so every payment against a bono has none either.
--   * Money taken on account has none until it is spent.
--
-- So this is not a migration artefact that will age out. A clinic that has
-- never touched PracticeHub hits it the first time it sells a bono: 18 native
-- bono payments and 3 on-account payments, 4,650 EUR, were already invisible
-- on an account whose imported history is what makes the number large.
--
-- Measured on the live account before this change: 944 of 1,579 patients were
-- reported as owing money they did not owe, 308,380 EUR of debt that does not
-- exist. Not one patient was wrong in the other direction -- the view can only
-- ever under-count what was paid. The clearest case had paid 1,897 EUR against
-- 1,897 EUR invoiced, exactly square, and was reported as owing the whole
-- 1,897.
--
-- usePatientFinancialSummary already reads payments by patient_id for exactly
-- this reason and says so at the query. The composable was fixed and the view
-- was not, so the patients list, recalls, the calendar, data exports and
-- evaluateAutomationFilters have been disagreeing with the Billing tab ever
-- since. This makes the view compute what the composable computes, term for
-- term:
--
--   * payments read by patient_id, not through an invoice join;
--   * a 'credit'-method payment on a VOID invoice excluded, because it
--     recorded a patient spending account credit against a charge that has
--     since been cancelled, and the void invoice's debit is already dropped;
--   * account_credits that merely restate a payment (payment_id set, written
--     by 20260916160000) excluded, so the same euros are not counted as both
--     a payment and a credit. Cutover entries are kept whatever they carry,
--     which is the composable's cutoverAdjustmentCents.
--
-- Verified against the composable's arithmetic for all 1,579 patients on the
-- live account: zero disagreements. The "Owing" filter goes from 994 patients
-- to 49.
--
-- Nothing has been chasing those 944: no automation_rules row currently uses
-- the `balance` filter. It was one saved automation away from messaging every
-- one of them about a debt they had already settled.
--
-- Definition is 0173's, with the three corrections above. security_invoker is
-- repeated deliberately: `create or replace view` without it resets the option
-- to the default, which is how this view once became SECURITY DEFINER and
-- served 1,555 rows across all 3 accounts to `anon`. The ::integer cast stays
-- because recall_candidates takes its column type from here.
create or replace view public.patient_live_balances
  with (security_invoker = true)
  as
  select
    p.id as patient_id,
    p.account_id,
    (coalesce(pay.paid_cents, 0) - coalesce(inv.invoiced_cents, 0) + coalesce(cred.credit_cents, 0))::integer as balance_cents
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
    -- precisely the bug this migration removes.
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
  ) cred on true;

-- Grants survive `create or replace view`, but this is the control that keeps
-- the browser's anon key out and it is cheap to restate rather than assume.
revoke all on public.patient_live_balances from anon;
