-- The receptionist's extra replies are charged pro rata (EUR 19 per 1,000,
-- only the replies used) and, on a monthly plan that will renew, as a line on
-- the plan's next invoice rather than an invoice of their own
-- (server/api/billing/receptionist-overage-cron.post.ts).
--
-- Such a line is a Stripe invoice item left pending on the subscription: it
-- has no invoice yet when the charge is made, so its id is recorded here, and
-- either id on a row means that month is charged.
alter table receptionist_overage_charges add column stripe_invoice_item_id text;

comment on column receptionist_overage_charges.blocks is
  'Thousands of extra replies started. Not what was charged since 22 Nov 2026: amount_cents is pro rata.';
