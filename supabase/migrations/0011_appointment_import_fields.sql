-- Supports CSV appointment migration: a text fallback for the
-- practitioner's name (imported practitioners often can't be matched to
-- a real team_members row -- they don't have a QuiroFlow login yet), and
-- an external reference (their appointment id) for dedupe on re-import.

alter table appointments
  add column practitioner_name text,
  add column external_reference text;

create index appointments_external_reference_idx on appointments (account_id, external_reference);
