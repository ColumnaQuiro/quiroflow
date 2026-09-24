-- A 'credit' payment is not money and never was: it records a patient
-- directing account credit they already hold towards something (a bono, a
-- membership), and the euros it represents were counted once already, when
-- that credit came in. 20260923094340 (this view) and
-- usePatientFinancialSummary both excluded it only when its own invoice was
-- void -- but most bonos and memberships raise no invoice at all (0161,
-- 0155), so a credit-method payment against one of those was still counted
-- as new money every time, invoice status never entering into it.
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
-- never money -- dropping the invoice join it no longer needs.
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
  ) cred on true;

-- Grants survive `create or replace view`, but this is the control that keeps
-- the browser's anon key out and it is cheap to restate rather than assume.
revoke all on public.patient_live_balances from anon;
