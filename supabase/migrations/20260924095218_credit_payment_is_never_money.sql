-- A 'credit' payment is not money and never was: it records a patient
-- directing account credit they already hold towards something (a bono, a
-- membership), and the euros it represents were counted once already, when
-- that credit came in. This view and usePatientFinancialSummary both excluded
-- it only when its own invoice was void -- but most bonos and memberships
-- raise no invoice at all (0161, 0155), so a credit-method payment against
-- one of those was still counted as new money every time, invoice status
-- never entering into it.
--
-- That stayed invisible for credit added through "Add Credit": the matching
-- account_credits row (20260916160000) carries a payment_id and is excluded
-- from credit_cents below, so the spend's extra +paid_cents and the
-- credit-being-spent's -credit_cents cancel and the total comes out right by
-- accident. It stops being invisible the moment the credit being spent was
-- never its own account_credits row to begin with -- an imported PracticeHub
-- payment sitting on the account unallocated, which this view's own history
-- (20260923094340) says is the NORMAL shape for one, not an edge case. There
-- the spend's +paid_cents has nothing of its own to cancel: Teresa Davis had
-- EUR 240 of exactly that kind of credit, spent it on a Bono mantenimiento on
-- 24 Sep 2026, and her balance read EUR 240 ahead of itself -- the same
-- "written down twice" bug 20260916160000 fixed for adding credit, mirrored
-- on the spending side.
--
-- Cash and card payments on a void invoice are still counted regardless. That
-- money really was collected and the charge really was cancelled, so the
-- clinic really does owe it back. Only 'credit' itself, unconditionally, is
-- never money -- so the paid_cents lateral drops the invoice join it needed
-- only for the void rule.
--
-- outstanding_cents keeps BOTH readings of a credit payment, which is the
-- distinction utils/owing.ts now makes too: it stays out of the money term
-- (charged_cents - paid_cents) because it is not money arriving, while the
-- alloc lateral below still counts it against the invoice it was applied to,
-- because there it really did settle that charge. Filtering it out of both
-- would report a part-credit-settled invoice as wholly unpaid.
--
-- Definition is 20260923160000's, with that one change. Every column stays,
-- in order: `create or replace view` cannot drop or reorder them, and
-- recall_candidates takes its column type from balance_cents. security_invoker
-- is restated deliberately -- replacing a view without it resets the option to
-- the default, which is how this view once became SECURITY DEFINER and served
-- every account's rows to anon.
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
    select sum(pay.amount_cents) as paid_cents
    from payments pay
    where pay.patient_id = p.id
      and pay.method <> 'credit'
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
