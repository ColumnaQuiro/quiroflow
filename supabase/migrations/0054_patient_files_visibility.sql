-- QA follow-up: a file-visibility category (generic vs custom) so a future
-- patient-facing mobile app can decide what to show the patient. Everything
-- else in this QA pass (block-time date range, "use package session" from
-- an appointment, a patient-view link from the appointment modal) is a pure
-- UI change over existing tables -- availability_blocks already stores
-- starts_at/ends_at as timestamptz, so a multi-day block needs no schema
-- change.
alter table patient_files add column visibility text not null default 'generic' check (visibility in ('generic', 'custom'));
