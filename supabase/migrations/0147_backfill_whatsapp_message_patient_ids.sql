-- One-time backfill for the "inbox shows a phone number instead of the
-- patient's name" bug: server/api/whatsapp/webhook.post.ts used to match an
-- inbound message's phone number against patient_contact_numbers via a
-- strict toE164(...) === fromNumber equality, which silently failed whenever
-- a contact row's country_code was wrong (commonly left at its 'ES' default
-- for a foreign number -- see 0078_fix_public_booking_phone_dial_code.sql for
-- a prior instance of exactly this) or the number was typed with a leading
-- "00" international prefix instead of "+". The application code
-- (utils/phone.ts's phoneMatches()) now falls back to comparing the last 9
-- digits for newly-arriving messages; this migration applies that same
-- fallback once to the messages already sitting in the table with a null
-- patient_id.
--
-- Deliberately conservative: only fills in a patient_id where exactly one
-- patient's contact number matches by trailing-digit suffix. A message whose
-- suffix matches more than one patient (e.g. family members sharing a phone)
-- is left alone rather than guessing -- that ambiguity is exactly why
-- find_patient_ids_by_phone-equivalent logic elsewhere returns every match
-- instead of picking one.
with candidates as (
  select
    wm.id as message_id,
    pcn.patient_id,
    right(regexp_replace(pcn.number, '\D', '', 'g'), 9) as pcn_suffix,
    right(regexp_replace(wm.phone_number, '\D', '', 'g'), 9) as wm_suffix
  from whatsapp_messages wm
  join patient_contact_numbers pcn on pcn.account_id = wm.account_id
  where wm.patient_id is null and wm.phone_number is not null
),
matched as (
  select message_id, patient_id
  from candidates
  where length(wm_suffix) = 9 and pcn_suffix = wm_suffix
),
unambiguous as (
  select message_id, min(patient_id) as patient_id
  from matched
  group by message_id
  having count(distinct patient_id) = 1
)
update whatsapp_messages wm
set patient_id = u.patient_id
from unambiguous u
where wm.id = u.message_id;
