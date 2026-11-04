-- Money paid for a bono belongs to the bono, never to an invoice of its own.
--
-- A bono raises no charge for its price (20260914150556): each visit drawn
-- from it is charged at the per-session rate, and the money paid for the bono
-- is what settles those charges. An invoice for the bono's price -- or for an
-- instalment of it -- charges the same sessions a second time. Money that
-- pays THAT invoice is spent on it and is no longer there for the visits, so
-- the last sessions of the bono read as owed.
--
-- One patient on the live account, 3 Nov 2026: a PracticeHub Bono 12, 528 EUR
-- paid in full, "88,00 EUR due" for two of its own sessions. Its second half
-- had been paid against "PH-package-fix", an invoice for that half raised in
-- the few days (8-13 Sep) the bonos importer turned the unpaid part of a
-- migrated bono into an invoice; the bono pointed at it. Half the bono was
-- charged as that invoice AND again, 44 EUR at a time, by the sessions it
-- bought, so the money ran out two sessions early. Corrected by hand the
-- same day.
--
-- Nothing in the application writes that shape any more except one path,
-- fixed alongside this: a Stripe autopay instalment on a bono raised a paid
-- invoice for the instalment and hung its payment (purpose 'bono') off it.
-- Never run in production -- no bono had autopay yet -- but it is what the
-- "add a card to enable autopay for the remaining balance" prompt sets up on
-- exactly the half-paid bonos a PracticeHub clinic arrives with.
--
-- Each shape had already been removed once, in code, and came back or
-- survived in data. So the database refuses both, for every path: importers,
-- webhooks, the app, and a hand-run statement.
--
-- Both hold on the live account (0 rows each) after the correction above.
--
-- Deliberately NOT constrained: a payment carrying both package_purchase_id
-- and invoice_id. "Link payment..." on the bono card is there to let a bono
-- claim a payment that was taken against some other invoice by mistake, and
-- utils/bonoOwed counts it once, through the bono. That is a correction of
-- where money landed, not a second charge.

-- A bono has no sale invoice. The column stays (it is still read, and was the
-- old model's link) but can only ever be empty.
alter table package_purchases
  add constraint package_purchases_no_sale_invoice
  check (invoice_id is null);

-- Money paid FOR a bono is attached to the bono, not to an invoice.
alter table payments
  add constraint payments_bono_money_is_not_an_invoice_payment
  check (purpose is distinct from 'bono' or invoice_id is null);
