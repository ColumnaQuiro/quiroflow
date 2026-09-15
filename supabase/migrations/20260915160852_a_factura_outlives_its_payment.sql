-- A factura must outlive the payment it documents.
--
-- facturas.payment_id was ON DELETE CASCADE, so removing a payment silently
-- destroyed the numbered fiscal document issued for it. Nothing warned anyone;
-- the row simply went.
--
-- That is not hypothetical either. Four numbers are already missing from the
-- 2026 series -- F-2026-0007, 0008, 0020 and 0027 -- against 28 facturas
-- issued up to 0032. 0007 and 0008 were two patients charged on 15 Sep for a
-- session their bono had already paid for; reception corrected it the way the
-- app offers, deletePayment ("a payment recorded in error ... typically
-- because it should have been drawn from a bono rather than taken as cash"),
-- and the facturas went with the payments. A correlative series with holes in
-- it is exactly what a rectificativa exists to avoid.
--
-- SET NULL rather than RESTRICT. RESTRICT would refuse the delete and be the
-- stronger guarantee, but this app has no rectificativa flow yet, so it would
-- leave reception with a payment they know is wrong and no way to correct it
-- -- and the likely next move is deleting the whole invoice, which cascades to
-- the payment anyway. Keeping the document and dropping the link records what
-- actually happened: the factura was issued, and the payment behind it was
-- later withdrawn.
--
-- payment_id therefore becomes nullable. A null is not "unknown", it is
-- "the payment this documented has been removed" -- which is a state someone
-- needs to see and resolve, so the Billing tab flags those rows rather than
-- letting them sit quietly in the list.
--
-- Nothing is backfilled. The four missing numbers cannot be recovered: their
-- rows are gone, and inventing replacements would be fabricating fiscal
-- documents, which is worse than the gap. They need a human and probably a
-- gestor.

alter table facturas alter column payment_id drop not null;

alter table facturas drop constraint facturas_payment_id_fkey;
alter table facturas add constraint facturas_payment_id_fkey
  foreign key (payment_id) references payments(id) on delete set null;

comment on column facturas.payment_id is
  'The payment this factura documents. NULL means that payment was later deleted -- the factura still stands, because a number issued in a correlative series cannot simply disappear. Was ON DELETE CASCADE until 20260915160852, which silently destroyed the document with the payment.';

-- The one-factura-per-payment rule still holds for real payments. Postgres
-- already allows repeated NULLs under a plain UNIQUE, so the old constraint
-- would not actually have blocked several orphaned facturas -- but a partial
-- index says that outright instead of leaving it to be rediscovered. Dropped
-- as a CONSTRAINT, not an index: it was created by UNIQUE and owns its index,
-- so `drop index` refuses it.
alter table facturas drop constraint facturas_payment_id_key;
create unique index facturas_payment_id_uniq
  on facturas (payment_id) where payment_id is not null;
