create table patient_contact_numbers (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  patient_id uuid not null references patients(id) on delete cascade,
  country_code text not null default 'ES',
  number text not null,
  is_whatsapp boolean not null default false,
  created_at timestamptz not null default now()
);

create index patient_contact_numbers_patient_idx on patient_contact_numbers (patient_id);

alter table patient_contact_numbers enable row level security;

create policy "staff manage patient_contact_numbers" on patient_contact_numbers
  for all using (is_account_member(account_id)) with check (is_account_member(account_id));

create policy "patients view own contact numbers" on patient_contact_numbers
  for select using (
    patient_id in (select id from patients where user_id = auth.uid())
  );
