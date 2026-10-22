-- A pregnancy on the patient's record: due date, how many babies, and a
-- note. Prenatal care is a common part of chiropractic, and clinics asked for
-- it to be on the record at a glance -- weeks, trimester -- rather than in a
-- free-text note (PracticeHub community, Aug 2026).
--
-- Columns on patients rather than a table: there is one pregnancy at a time,
-- it is read wherever the patient is, and patients is already audited,
-- covered by two-factor and moved by nothing that merges rows. "Ended" clears
-- the three; the audit trail keeps what they were.
--
-- Clinical and personal, so anonymising a record must clear them. Rather
-- than restate all of anonymize_patient (20261017182107) to add three
-- columns, a trigger clears them on the update that sets anonymized_at --
-- the one moment that function marks -- so it cannot be forgotten by the
-- next version of the function either.

alter table public.patients
  add column pregnancy_due_date date,
  add column pregnancy_multiples smallint check (pregnancy_multiples between 2 and 6),
  add column pregnancy_notes text check (char_length(pregnancy_notes) <= 1000);

create or replace function public.patients_clear_pregnancy_on_anonymize()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.anonymized_at is null and new.anonymized_at is not null then
    new.pregnancy_due_date := null;
    new.pregnancy_multiples := null;
    new.pregnancy_notes := null;
  end if;
  return new;
end;
$$;

create trigger patients_clear_pregnancy_on_anonymize
  before update of anonymized_at on public.patients
  for each row execute function public.patients_clear_pregnancy_on_anonymize();
