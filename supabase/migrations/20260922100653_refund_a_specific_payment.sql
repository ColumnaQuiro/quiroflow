-- A refund can name the payment it gives back, not just the receipt.
--
-- 0128_invoice_refunds.sql hung a refund off the INVOICE it refunds, which is
-- the right answer when a visit was settled in one go. It is the wrong answer
-- as soon as it wasn't: an invoice paid EUR 30 cash + EUR 20 card has one
-- refundable total (EUR 50) and a free-text method dropdown, so the UI would
-- happily record "EUR 50 back to card" against EUR 20 that ever arrived on a
-- card. The ledger nets out fine -- the patient is square either way -- but
-- the Income report's "By payment method" breakdown and the card
-- reconciliation both then disagree with what the terminal actually did.
--
-- Naming the payment fixes the cap (a refund cannot exceed the payment it
-- refunds) and the method (it defaults to how the money came in).
alter table invoices add column refunds_payment_id uuid references payments(id) on delete set null;

create index invoices_refunds_payment_idx on invoices (refunds_payment_id) where refunds_payment_id is not null;

comment on column invoices.refunds_payment_id is
  'The payment this refund gives back. Null on a refund recorded against the receipt as a whole, which is every refund made before this column existed.';

-- BOTH links are set when a payment-level refund has an invoice behind it,
-- and that is load-bearing rather than redundant. The two caps read different
-- columns -- the per-payment one sums refunds_payment_id, the per-invoice one
-- sums refunds_invoice_id -- so a refund that set only the payment link would
-- be invisible to the invoice cap: refund EUR 20 against the card payment,
-- then EUR 50 against the receipt, and EUR 70 goes back on EUR 50 collected.
-- Setting both makes each cap see every refund, in either order.
comment on column invoices.refunds_invoice_id is
  'The receipt this refund is against. Set on every refund that has one, including a payment-level refund -- see refunds_payment_id for why both.';
