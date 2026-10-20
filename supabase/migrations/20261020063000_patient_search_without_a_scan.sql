-- The patient list's search no longer scans every patient.
--
-- pages/patients/index.vue searched `search_name`, `email`, `national_id` and
-- `phone_numbers_text` in one or=(...). phone_numbers_text is a function that
-- runs a subquery on patient_contact_numbers per patient (20260923150000), so
-- no index can serve it, and one unindexable branch in an OR makes Postgres
-- scan the whole table and evaluate every branch on every row. On a large
-- account that, with RLS and the exact count the page asks for, ran into the
-- statement timeout: 57014 "canceling statement due to statement timeout" on
-- GET /rest/v1/patients (Sentry JAVASCRIPT-NUXT-A / -B).
--
-- The numbers move onto the row, the way has_phone already is (0061), so every
-- branch of the search is an indexed predicate on patients and the OR becomes
-- a BitmapOr of trigram indexes. phone_numbers_text stays: the code that is
-- live until the next release still calls it.

alter table patients add column phone_search text;

-- A change to this column is bookkeeping, not an edit of the patient: keep it
-- out of the activity log, as search_name and has_phone are.
drop trigger trg_audit_patients on patients;
create trigger trg_audit_patients
  after insert or update or delete on patients
  for each row execute function public.fn_audit_log('patient', 'balance_cents,search_name,has_phone,phone_search');

create or replace function fn_sync_patient_phone_search()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  -- A number can move between patients (merge_patients), so both ends.
  for v_id in
    select distinct x from unnest(array[
      case when TG_OP <> 'INSERT' then OLD.patient_id end,
      case when TG_OP <> 'DELETE' then NEW.patient_id end
    ]) as x where x is not null
  loop
    -- Only when it changed, so a resave of a number does not fire the
    -- patient.updated webhook for nothing.
    update patients p
    set phone_search = (select string_agg(n.number, ' ') from patient_contact_numbers n where n.patient_id = p.id)
    where p.id = v_id
      and p.phone_search is distinct from
        (select string_agg(n.number, ' ') from patient_contact_numbers n where n.patient_id = p.id);
  end loop;
  return coalesce(NEW, OLD);
end;
$$;

revoke all on function fn_sync_patient_phone_search() from public, anon, authenticated;

create trigger trg_sync_patient_phone_search
  after insert or update of number, patient_id or delete on patient_contact_numbers
  for each row execute function fn_sync_patient_phone_search();

-- Backfill without telling every webhook subscriber that every patient with a
-- phone was "updated".
alter table patients disable trigger trg_webhook_patient_updated;
update patients p
set phone_search = s.numbers
from (
  select patient_id, string_agg(number, ' ') as numbers
  from patient_contact_numbers
  group by patient_id
) s
where s.patient_id = p.id;
alter table patients enable trigger trg_webhook_patient_updated;

-- The other two columns the search ORs in had no index either.
create index if not exists patients_phone_search_trgm_idx on patients using gin (phone_search gin_trgm_ops);
create index if not exists patients_email_trgm_idx on patients using gin (email gin_trgm_ops);
create index if not exists patients_national_id_trgm_idx on patients using gin (national_id gin_trgm_ops);
