-- Package purchases and their backfilled credits have always been created by
-- hand (there was no importer for them), which is exactly how real gaps
-- between PracticeHub and QuiroFlow went unnoticed for months. Adding
-- external_reference (same convention as patients/appointments/patient_docs)
-- lets a PracticeHub patient-packages importer dedupe safely on re-run,
-- the same way the existing payments importer already does via invoice_number.
alter table package_purchases add column external_reference text;

create unique index package_purchases_external_reference_uniq
  on package_purchases (account_id, external_reference)
  where external_reference is not null;

-- account_credits rows created by that same importer need the same dedupe
-- guard, or a re-run would double-credit every patient it already fixed.
alter table account_credits add column external_reference text;

create unique index account_credits_external_reference_uniq
  on account_credits (account_id, external_reference)
  where external_reference is not null;
