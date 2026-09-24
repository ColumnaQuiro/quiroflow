-- Teresa Davis's EUR 240 credit was a genuine card payment (phpay-3405,
-- 1 Sep 2026) that PracticeHub carried unallocated -- no invoice_id, no
-- account_credits row, exactly the normal shape 20260923094340 describes for
-- an imported payment. It read as EUR 240 of credit anyway, through
-- balanceCents rather than through account_credits, because paid exceeded
-- invoiced by that much.
--
-- Spending it on a Bono mantenimiento on 24 Sep 2026 wrote the usual
-- account_credits(-24000, 'Applied to Bono mantenimiento') row -- correct on
-- its own -- but with no +24000 row of its own to net against, it just made
-- the ledger's credit column read -240 instead of 0. See
-- 20260924095218_credit_payment_is_never_money.sql for the code/view side of
-- this (why the paired credit-method payment did not silently cover for it),
-- and 20260916160000_account_credit_knows_its_payment.sql for the backfill
-- pattern this repeats: a payment_id here excludes it from balanceCreditCents
-- / credit_cents, so it is not counted twice going forward either.
--
-- Guarded rather than plain, because this may already have been applied by
-- hand against production ahead of the code fix shipping -- the same
-- circumstances 20260916160000's own two matched rows were backfilled under.
insert into account_credits (account_id, patient_id, amount_cents, reason, payment_id, created_by, created_at)
select
  pay.account_id,
  pay.patient_id,
  pay.amount_cents,
  'Card payment on account, 1 Sep 2026 (backfill -- payment predates an account_credits row, uncovered spending it on Bono mantenimiento)',
  pay.id,
  null,
  pay.paid_at
from payments pay
where pay.id = '87734efa-4893-4e80-9d7a-3e09f65f23be'
  and not exists (select 1 from account_credits c where c.payment_id = pay.id);
