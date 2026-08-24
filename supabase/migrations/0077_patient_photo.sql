-- Patient profile photo. Same established pattern as patient-files
-- (0014_recalls_whatsapp_files.sql), except public (it's a display avatar,
-- not a sensitive document) so the client can use a plain public URL
-- instead of re-signing on every list render.

alter table patients add column photo_storage_path text;

insert into storage.buckets (id, name, public)
values ('patient-photos', 'patient-photos', true)
on conflict (id) do nothing;

create policy "staff manage patient-photos storage" on storage.objects
  for all using (
    bucket_id = 'patient-photos' and is_account_member((storage.foldername(name))[1]::uuid)
  )
  with check (
    bucket_id = 'patient-photos' and is_account_member((storage.foldername(name))[1]::uuid)
  );

-- Short-lived, single-use tokens for the "scan to use your phone's camera"
-- flow -- staff at a desktop generates one and shows it as a QR code; the
-- phone that scans it has no session at all, so redemption happens through
-- server/api/photo-upload/[token].* using the service-role client, not
-- through RLS-gated client queries. Staff-side creation/status-checking
-- does go through normal RLS (is_account_member).
create table photo_upload_tokens (
  token uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  patient_id uuid not null references patients(id) on delete cascade,
  created_at timestamptz not null default now(),
  used_at timestamptz
);

create index photo_upload_tokens_patient_idx on photo_upload_tokens (patient_id);

alter table photo_upload_tokens enable row level security;

create policy "staff manage photo_upload_tokens" on photo_upload_tokens
  for all using (is_account_member(account_id)) with check (is_account_member(account_id));
