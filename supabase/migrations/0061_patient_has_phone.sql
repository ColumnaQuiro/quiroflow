-- Denormalized so the Patients list can filter "missing phone" with a plain
-- indexed boolean predicate. The alternative (an id NOT IN (...subquery) of
-- every patient who HAS a phone) breaks at real data volume -- the query
-- string blows past request size limits and fails silently.
alter table patients add column has_phone boolean not null default false;

update patients set has_phone = true
where id in (select distinct patient_id from patient_contact_numbers);

create index patients_has_phone_idx on patients (has_phone);

create or replace function fn_sync_patient_has_phone()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_patient_id uuid := coalesce(NEW.patient_id, OLD.patient_id);
begin
  update patients
  set has_phone = exists (select 1 from patient_contact_numbers where patient_id = v_patient_id)
  where id = v_patient_id;
  return coalesce(NEW, OLD);
end;
$$;

create trigger trg_sync_patient_has_phone
  after insert or delete on patient_contact_numbers
  for each row execute function fn_sync_patient_has_phone();
