-- A patient's own practitioner is filled from their visits, and kept filled.
--
-- patients.default_practitioner_id is what the Income report falls back on
-- for money with no visit behind it -- a bono, money on account -- so a
-- patient without one turns every bono they buy into "Sin asignar". It was
-- backfilled from visit history once and nothing set it after that: of the
-- patients created since September about half had none, every one of them
-- seen by a named practitioner, and October 2026 showed 1,955 EUR of bonos
-- as unassigned.
--
-- The first live visit with a practitioner now fills it, for any clinic. It
-- only ever fills an EMPTY field: a practitioner chosen on the patient's
-- record, or a patient who moves on to someone else, is never overwritten.
--
-- It does not widen anyone's access. An "own patients" scope already reaches
-- every patient the practitioner has an appointment with (can_access_patient),
-- and this only names that same practitioner.

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

  update patients
  set default_practitioner_id = new.practitioner_id
  where id = new.patient_id
    and account_id = new.account_id
    and default_practitioner_id is null;
  return null;
end;
$$;

create trigger appointments_fill_patient_practitioner
  after insert or update of patient_id, practitioner_id, status, deleted_at on public.appointments
  for each row execute function public.appointments_fill_patient_practitioner();

-- The patients already missing it: whoever they have seen most, and the most
-- recent of those on a tie. Patients whose only appointments were cancelled
-- stay empty, as the trigger would leave them.
with tally as (
  select a.patient_id, a.practitioner_id,
         row_number() over (partition by a.patient_id order by count(*) desc, max(a.starts_at) desc) as rn
  from appointments a
  join patients p on p.id = a.patient_id and p.account_id = a.account_id
  where p.default_practitioner_id is null
    and a.practitioner_id is not null
    and a.deleted_at is null
    and a.status <> 'cancelled'
  group by a.patient_id, a.practitioner_id
)
update patients p
set default_practitioner_id = t.practitioner_id
from tally t
where t.patient_id = p.id
  and t.rn = 1
  and p.default_practitioner_id is null;
