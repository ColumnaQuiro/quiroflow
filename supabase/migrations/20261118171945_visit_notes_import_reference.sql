-- PracticeHub's treatment notes go on the visit they were written at.
--
-- They used to be imported as contact_log rows -- the table Recalls writes
-- "called, no answer" into -- so a clinic's whole clinical history showed up
-- only in the patient's Activity timeline, as "Contacto · [clinical_note/...]",
-- mixed in with thousands of log entries and cut at the newest 40. One clinic
-- had 4,057 of them and reported that its notes "were not imported".
--
-- A visit note carries no reference of its own, so nothing could tell an
-- imported one apart or stop a re-run writing it twice. This gives it one
-- ('PH-clinicalnote-<id>'), unique per clinic like every other imported row.

alter table public.visit_notes add column external_reference text;

create unique index visit_notes_account_external_reference
  on public.visit_notes (account_id, external_reference)
  where external_reference is not null;
