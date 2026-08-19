-- Phase 2 of Reports: "did every WhatsApp actually send, and who has/hasn't
-- confirmed their appointment". Neither is answerable today -- send.post.ts
-- fires the message and forgets Meta's response entirely, so there's no way
-- to later learn a message failed (bad number, recipient has no WhatsApp)
-- or that a patient replied. This adds structured tracking for both,
-- correlated via Meta's own message ID (wamid) from their status/reply
-- webhook callbacks.

create table whatsapp_messages (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  patient_id uuid references patients(id) on delete set null,
  appointment_id uuid references appointments(id) on delete set null,
  wamid text,
  direction text not null default 'outbound' check (direction in ('outbound', 'inbound')),
  purpose text check (purpose is null or purpose in ('confirmation', 'recall', 'other')),
  template_name text,
  status text not null default 'sent' check (status in ('sent', 'delivered', 'read', 'failed', 'received')),
  error_code text,
  error_message text,
  body_preview text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index whatsapp_messages_wamid_uniq on whatsapp_messages (wamid) where wamid is not null;
create index whatsapp_messages_account_created_idx on whatsapp_messages (account_id, created_at desc);
create index whatsapp_messages_patient_idx on whatsapp_messages (patient_id);

alter table whatsapp_messages enable row level security;
create policy "staff manage whatsapp_messages" on whatsapp_messages
  for all using (is_account_member(account_id)) with check (is_account_member(account_id));

-- Meta's webhook calls this endpoint directly (no Supabase session), so it
-- authenticates via service role -- give it its own narrow insert/update
-- policy rather than opening RLS to anon broadly.
create policy "service role manages whatsapp_messages" on whatsapp_messages
  for all to service_role using (true) with check (true);

-- Per-appointment confirmation state, set to 'pending' when a confirmation
-- message is sent and updated by the patient's reply (button tap or a
-- recognized free-text reply) via the inbound webhook.
alter table appointments add column confirmation_status text
  check (confirmation_status is null or confirmation_status in ('pending', 'confirmed', 'reschedule_requested'));
