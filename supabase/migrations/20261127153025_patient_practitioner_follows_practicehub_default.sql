-- An imported patient's own practitioner is the one PracticeHub names, not
-- whoever happened to join QuiroFlow first.
--
-- The Patients import matches PracticeHub's default practitioner to a team
-- member by name. A clinic imports first and invites its team afterwards, so
-- at import time nobody matches and every patient arrives with no
-- practitioner. Each practitioner then joins and their imported appointments
-- are linked to them by name (the invite, or Settings > Team > Link), and
-- appointments_fill_patient_practitioner (20261030103341) gave every patient
-- with no practitioner whoever's visit was linked first.
--
-- At one clinic on 26 Nov 2026 one practitioner joined first. Linking his
-- 6,575 appointments gave him 803 patients in the same minute: everyone who
-- had ever seen him, including patients whose PracticeHub practitioner was a
-- colleague who joined 100 minutes later. 129 patients ended up with a
-- practitioner other than the one PracticeHub shows.
--
-- So a patient now keeps the name PracticeHub gave as their practitioner
-- (default_practitioner_name, written by the Patients import beside
-- default_practitioner_id, as appointments keep practitioner_name). An IMPORTED
-- visit fills an empty practitioner only when it is with that named person.
-- When the right person's appointments are linked, their patients are filled
-- by the same trigger, on every linking path: invite, Settings > Team, and
-- the sync's appointments step. A visit booked in QuiroFlow
-- (no external_reference) fills it as before, and so do imported visits of
-- a patient PracticeHub named nobody for.
--
-- Nothing already set is changed: the trigger still only fills an empty
-- field. Patients filled wrongly before this are corrected by running the
-- Patients import again, which overwrites default_practitioner_id with
-- PracticeHub's.

alter table public.patients
  add column default_practitioner_name text;

comment on column public.patients.default_practitioner_name is
  'The practitioner PracticeHub (or another imported system) names as this patient''s own, as text. Imported visits only fill default_practitioner_id from that person. Null for patients created here.';

create or replace function public.appointments_fill_patient_practitioner()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  -- A cancelled booking is not a visit: someone who booked and never came
  -- belongs to nobody yet.
  if new.patient_id is null or new.practitioner_id is null
     or new.status = 'cancelled' or new.deleted_at is not null then
    return null;
  end if;

  update patients p
  set default_practitioner_id = new.practitioner_id
  where p.id = new.patient_id
    and p.account_id = new.account_id
    and p.default_practitioner_id is null
    -- An imported visit with someone other than the practitioner the import
    -- named leaves the patient for that person: see the header.
    and (
      p.default_practitioner_name is null
      or new.external_reference is null
      or lower(btrim(coalesce(new.practitioner_name, ''))) = lower(btrim(p.default_practitioner_name))
    );
  return null;
end;
$$;
