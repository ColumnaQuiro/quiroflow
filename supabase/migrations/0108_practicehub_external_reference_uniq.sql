-- Closes the race-condition gap in PracticeHub re-imports: external_reference
-- dedupe was previously enforced only in application code (a read-then-write
-- check in each importer), so two concurrent import runs (or a retry racing
-- an in-flight run) could create duplicate rows for the same PracticeHub
-- record. A pre-check confirmed no existing duplicates before adding these.

drop index if exists patients_external_reference_idx;
create unique index patients_external_reference_uniq
  on patients (account_id, external_reference)
  where external_reference is not null;

drop index if exists appointments_external_reference_idx;
create unique index appointments_external_reference_uniq
  on appointments (account_id, external_reference)
  where external_reference is not null;

drop index if exists contact_log_external_reference_idx;
create unique index contact_log_external_reference_uniq
  on contact_log (account_id, external_reference)
  where external_reference is not null;

drop index if exists patient_docs_external_reference_idx;
create unique index patient_docs_external_reference_uniq
  on patient_docs (account_id, external_reference)
  where external_reference is not null;
