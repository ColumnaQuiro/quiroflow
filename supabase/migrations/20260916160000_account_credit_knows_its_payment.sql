-- Money put on account is written down twice, and the balance counted both.
--
-- Adding credit writes a payment -- the money arrived, and a factura has to
-- say so -- and an account_credits row, because it is still the patient's to
-- direct somewhere. Two rows, one set of euros. The balance is
-- paid - invoiced + credit, so it added the payment and the credit row and
-- put Adrian Oropeza 115 EUR ahead of himself the moment the cash was
-- counted.
--
-- Nothing in the row said it was a restatement rather than an adjustment, and
-- the difference matters: the PracticeHub cutover entries, a goodwill credit,
-- and every credit added before 15 Sep (when the payment row was introduced)
-- are real adjustments that the balance must keep counting. Only a credit row
-- written beside its own payment is a second copy.
--
-- So the row names the payment it restates. Set on exactly one path -- adding
-- credit -- and never on the negative rows that record credit being spent:
-- those pair with a payment of method 'credit' that moves the money somewhere
-- else, and the two moves have to cancel in the balance rather than both
-- dropping out of it.

alter table account_credits
  add column payment_id uuid references payments(id) on delete set null;

comment on column account_credits.payment_id is
  'The payment this credit row restates, when the same money was written down twice: adding credit records a payment (the money arrived) and this row (what the patient can still direct). Set only there. A row with a payment_id is not counted again in the balance -- its payment already is. Null on adjustments that came through no payment at all: the PracticeHub cutover entries, goodwill credits, everything added before the payment row existed, and the negative rows that record credit being spent.';

create index if not exists account_credits_payment_id_idx
  on account_credits (payment_id) where payment_id is not null;

-- The two that exist: Ana paula Mañanes' 55 EUR on 15 Sep and Adrian
-- Oropeza's 115 EUR on 16 Sep. Matched on patient, amount and the seconds
-- between the two inserts, which is the only link they have until now.
update account_credits c
set payment_id = p.id
from payments p
where p.purpose = 'on_account'
  and p.patient_id = c.patient_id
  and p.account_id = c.account_id
  and c.amount_cents = p.amount_cents
  and c.payment_id is null
  and c.created_at between p.paid_at - interval '5 minutes' and p.paid_at + interval '5 minutes';
