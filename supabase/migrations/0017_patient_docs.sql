-- Free-form rich-text documents owned by a patient (data-protection
-- consent records, clinical write-ups, anything that doesn't fit the
-- structured visit_notes) -- a lightweight Notion-page-style doc per
-- patient rather than a fixed template.

create table patient_docs (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  patient_id uuid not null references patients(id) on delete cascade,
  title text not null default 'Untitled',
  content jsonb not null default '{}'::jsonb,
  created_by uuid references team_members(id) on delete set null,
  updated_by uuid references team_members(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index patient_docs_patient_idx on patient_docs (account_id, patient_id, updated_at desc);

alter table patient_docs enable row level security;
create policy "staff manage patient_docs" on patient_docs
  for all using (is_account_member(account_id)) with check (is_account_member(account_id));
