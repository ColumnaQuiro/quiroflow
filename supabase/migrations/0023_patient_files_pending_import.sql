-- Supports importing file *metadata* from PracticeHub's "File Attachments -
-- List" export ahead of having the actual bytes (PracticeHub's export and
-- API only expose metadata, not downloadable content -- see the Files tab
-- import flow). storage_path becomes nullable to represent "known to exist,
-- not yet migrated"; external_reference stores PracticeHub's File ID so
-- re-running the import is idempotent.

alter table patient_files alter column storage_path drop not null;
alter table patient_files add column external_reference text;

create unique index patient_files_external_reference_uniq
  on patient_files (account_id, external_reference)
  where external_reference is not null;
