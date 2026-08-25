-- In-app messaging channel: a signed-in patient (via the mobile app, or the
-- web portal later) messaging the clinic directly, distinct from WhatsApp --
-- no phone number or Meta involved, so no phone_number column, no wamid, no
-- delivery-status ticks. The Inbox UI (web pages/inbox.vue and mobile
-- components/PractitionerInbox.vue) merges this table's rows with
-- whatsapp_messages client-side into one conversation per patient, keyed
-- the same way whatsapp_messages already is (patient_id), tagging each
-- message with its channel.
create table patient_app_messages (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  patient_id uuid not null references patients(id) on delete cascade,
  direction text not null check (direction in ('inbound', 'outbound')),
  body text not null,
  created_at timestamptz not null default now()
);

create index patient_app_messages_patient_id_idx on patient_app_messages(patient_id);

alter table patient_app_messages enable row level security;

create policy "staff manage patient_app_messages" on patient_app_messages
  for all using (is_account_member(account_id)) with check (is_account_member(account_id));

-- A patient can read the whole thread (their messages and the clinic's
-- replies) but only ever insert their own, inbound side of it -- the
-- outbound/staff side is written by staff sessions under the policy above,
-- which a patient session's is_account_member(account_id) check fails.
create policy "patient select own patient_app_messages" on patient_app_messages
  for select using (patient_id in (select id from patients where user_id = auth.uid()));

create policy "patient insert own patient_app_messages" on patient_app_messages
  for insert with check (
    direction = 'inbound' and patient_id in (select id from patients where user_id = auth.uid())
  );

-- Same read-tracking table the WhatsApp inbox unread dot uses (see
-- 0083_whatsapp_conversation_reads.sql) already keys by conversation_key =
-- patient_id, so it needs no changes to also cover in-app messages.
