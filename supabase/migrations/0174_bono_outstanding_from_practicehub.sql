-- What is still owed on a migrated bono.
--
-- The bono card works this out from the bono's INVOICE: charged minus paid.
-- After the re-migration neither input exists. Phase 5 deleted the native
-- invoices those bonos pointed at, and the Ledger importer brings payments
-- across unallocated, because PracticeHub records no allocation -- so of 521
-- bonos on the live account, exactly ONE has an invoice and NONE has a payment
-- linked to it.
--
-- packageOwedCents() returns 0 when it has neither, so every part-paid bono
-- reads "Paid". Noelia Sanabria bought a 528 EUR Bono 12, paid half, and her
-- card says she is square while PracticeHub says she owes 264. 200 active
-- bonos are in that state.
--
-- PracticeHub knows the answer -- it keeps an outstanding figure on the
-- package itself -- and the bonos importer already reads it (owedCentsFor,
-- from package_balance). It was never stored, because the old flow turned it
-- into an invoice instead. That invoice is what #195 removed, correctly: it
-- was a charge PracticeHub does not have, and it distorted the balance.
--
-- So the figure is stored as what it is: information, not a charge. It is
-- displayed on the bono, and it touches no invoice, no payment and no balance.
alter table package_purchases add column owed_cents integer;

comment on column package_purchases.owed_cents is
  'What PracticeHub said was still owed on this bono at import. Displayed on the bono card; deliberately NOT a charge -- it raises no invoice and does not enter the balance, which is payments minus charges. Null on bonos sold in QuiroFlow, whose debt is their invoice''s open balance.';
