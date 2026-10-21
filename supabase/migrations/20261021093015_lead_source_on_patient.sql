-- A patient who came in through a lead says so on their record.
--
-- patients.referral_source ("Referred by" / "Origen") is what the patient
-- record shows and what the "New patients by referral source" report groups
-- on. It was only ever filled from a lead by createPatientFromLead() -- the
-- "Convert" button and the AI receptionist, when they create the record. Every
-- other way a lead meets a patient left it empty:
--
--   * the booking trigger linking a Meta form lead or a WhatsApp enquiry to
--     the patient the online booking has just created, by email or phone;
--   * lead_for_attributed_booking() making a Google Ads lead for a patient
--     who already exists (20260928160512_leads_from_attributed_bookings.sql);
--   * "Convert" linking the lead to a patient already on file.
--
-- Measured on 21 Oct 2026 on the largest clinic: of 30 patients linked to a
-- Meta or Google lead, 25 had no origin, the only Google Ads one among them.
-- The lead knew; the record and the report said "Not recorded".
--
-- So whenever a lead gets a patient, the patient's origin is filled from it --
-- only when empty: a front desk's own answer ("Calle", a referring patient)
-- is never overwritten, and neither is a lead that came later.
--
-- What is stored is the channel, not the campaign: the part of leads.source
-- before the '·' ("Meta Ads", "Google Ads", "WhatsApp"). The full source
-- carries the campaign name, and one report row per Meta campaign is not an
-- origin breakdown anyone can read; the campaign stays on the lead.
-- createPatientFromLead() now writes the same value (leadSourceChannel).

create or replace function public.lead_source_channel(p_source text)
returns text
language sql
immutable
as $$
  select nullif(trim(split_part(coalesce(p_source, ''), '·', 1)), '')
$$;

create or replace function public.lead_fills_patient_referral_source()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.patient_id is null or new.deleted_at is not null then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.patient_id is not distinct from new.patient_id then
    return new;
  end if;

  update patients
  set referral_source = lead_source_channel(new.source)
  where id = new.patient_id
    and account_id = new.account_id
    and coalesce(trim(referral_source), '') = ''
    and lead_source_channel(new.source) is not null;

  return new;
end;
$$;

drop trigger if exists leads_fill_patient_referral_source on leads;
create trigger leads_fill_patient_referral_source
after insert or update of patient_id on leads
for each row execute function public.lead_fills_patient_referral_source();

-- The patients linked before this existed. The earliest lead wins, as it is
-- what first brought them in.
update patients p
set referral_source = lead_source_channel(l.source)
from (
  select distinct on (patient_id) patient_id, account_id, source
  from leads
  where patient_id is not null and deleted_at is null and lead_source_channel(source) is not null
  order by patient_id, created_at
) l
where p.id = l.patient_id
  and p.account_id = l.account_id
  and coalesce(trim(p.referral_source), '') = '';

-- And the ones createPatientFromLead() wrote whole, campaign and all, brought
-- down to their channel -- only where the value is still exactly the lead's
-- source, i.e. nobody has edited it since.
update patients p
set referral_source = lead_source_channel(l.source)
from leads l
where l.patient_id = p.id
  and l.account_id = p.account_id
  and l.deleted_at is null
  and position('·' in l.source) > 0
  and p.referral_source = l.source;
