-- Foundation for the WhatsApp Inbox and the public developer API:
-- media support on whatsapp_messages (inbound downloads + outbound sends,
-- both re-hosted in our own storage so the Inbox can show them via signed
-- URLs instead of re-fetching from Meta every time), a phone_number column
-- so conversations group even when the sender isn't a matched patient, and
-- a token table for the new Settings > Developers API-key flow.

alter table whatsapp_messages add column phone_number text;
alter table whatsapp_messages add column media_type text
  check (media_type is null or media_type in ('image', 'video', 'audio', 'document', 'sticker'));
alter table whatsapp_messages add column media_storage_path text;
alter table whatsapp_messages add column media_mime_type text;
alter table whatsapp_messages add column media_filename text;

create index whatsapp_messages_conversation_idx on whatsapp_messages (account_id, patient_id, phone_number, created_at desc);

insert into storage.buckets (id, name, public)
values ('whatsapp-media', 'whatsapp-media', false)
on conflict (id) do nothing;

-- Object paths are "<account_id>/<filename>" -- same account-scoping
-- convention as patient-files/campaign-images.
create policy "staff manage whatsapp-media storage" on storage.objects
  for all using (
    bucket_id = 'whatsapp-media' and is_account_member((storage.foldername(name))[1]::uuid)
  )
  with check (
    bucket_id = 'whatsapp-media' and is_account_member((storage.foldername(name))[1]::uuid)
  );

-- Personal-access-token style auth for the public API (n8n etc.) -- separate
-- from the cookie-session auth every other server route uses, since an
-- external caller has no Supabase session. Only the sha256 hash is stored;
-- the raw token is shown once at creation time and never persisted.
create table api_tokens (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  name text not null,
  token_hash text not null,
  token_prefix text not null,
  scopes text[] not null default '{whatsapp:send}',
  created_by uuid references team_members(id) on delete set null,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index api_tokens_hash_uniq on api_tokens (token_hash);
create index api_tokens_account_idx on api_tokens (account_id, created_at desc);

alter table api_tokens enable row level security;
-- Token management is sensitive (an active token can send WhatsApp messages
-- as the clinic), so it's gated by its own permission key rather than the
-- general is_account_member staff policy every other table uses.
create policy "developers manage api_tokens" on api_tokens
  for all using (is_account_member(account_id) and has_permission(account_id, 'developers_access'))
  with check (is_account_member(account_id) and has_permission(account_id, 'developers_access'));
