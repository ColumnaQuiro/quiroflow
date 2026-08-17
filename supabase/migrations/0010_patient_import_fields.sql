-- Supports CSV-based patient migration from other practice management
-- tools (e.g. PracticeHub): a free-text notes field with no other home
-- in the schema, and an external reference (their patient number) used
-- to detect duplicates on repeat/updated imports.

alter table patients
  add column notes text,
  add column external_reference text;

create index patients_external_reference_idx on patients (account_id, external_reference);
