-- A payment currently only ever reaches a bono by coincidence of invoice_id
-- (package_purchases.invoice_id pointing at the same invoice the payment is
-- against) -- which breaks the moment a payment lands on a different
-- invoice than the bono's own (an imported PracticeHub payment, a payment
-- taken against the wrong invoice by mistake) or the bono has no invoice at
-- all (every purchase migrated from PracticeHub pre-dates this app's
-- invoice-per-bono flow). This lets staff link an existing payment to a
-- bono directly, independent of which invoice it's actually on.
alter table payments add column package_purchase_id uuid references package_purchases(id) on delete set null;

create index payments_package_purchase_idx on payments (package_purchase_id) where package_purchase_id is not null;
