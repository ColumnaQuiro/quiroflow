-- PracticeHub care plans become care plans.
--
-- The PracticeHub import used to write each Classic care plan into the
-- patient's contact history as one line of text ("[care_plan] 2 visit(s),
-- every +1 week, for 3 occurrence(s)..."). Nothing that reads a plan read
-- that: not the plan on the patient file, not Care Plan Alerts, not the
-- receptionist, not segments. A clinic moving across arrived with every
-- patient's course of treatment as a note.
--
-- The importer now writes care_plans rows, and like every other table it
-- imports into it needs to recognise its own rows on a second run:
-- "PH-careplan-<id>-v<version>", one per PracticeHub plan version (a phase).
-- Unique per account, as package_purchases' is, so a re-run cut off halfway
-- cannot write a phase twice.
--
-- Nullable and unset for every plan made here; no existing row changes.
alter table public.care_plans add column external_reference text;

create unique index care_plans_external_reference_uniq
  on public.care_plans (account_id, external_reference)
  where external_reference is not null;
