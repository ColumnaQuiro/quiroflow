-- PracticeHub's exercises, brought in by the import (utils/practicehubImport/exercises.ts).
--
-- PracticeHub's Classic API keeps both kinds of exercise in one list,
-- /exercises: the clinic's library (template = 1, patient_id = 0) and every
-- exercise handed to a patient (template = 0), each a full COPY of the
-- library one -- name, description, video -- with no id pointing back to it.
--
-- The import recognises what it wrote by PracticeHub's own id, as every other
-- step does, so running it again adds only what is new. Neither table had
-- anywhere to keep that id: this is it. "PH-exercise-<id>" on both, each
-- naming the PracticeHub row it came from.
--
-- No new table, so nothing for the two-factor or audit checks; neither
-- column is a patient_id, so merge_patients and anonymize_patient are
-- untouched (patient_exercises is already moved and removed by both).

alter table public.exercises add column external_reference text;
alter table public.patient_exercises add column external_reference text;

create unique index exercises_external_reference_key
  on public.exercises (account_id, external_reference)
  where external_reference is not null;

create unique index patient_exercises_external_reference_key
  on public.patient_exercises (account_id, external_reference)
  where external_reference is not null;
