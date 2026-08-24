-- Lets a package/bono purchase be explicitly shared with other specific
-- patients (staff-managed per purchase), not inferred from any family/tutor
-- relationship. package_purchases.patient_id stays the sole owner/purchaser;
-- this is purely additional beneficiaries who can also draw down sessions
-- from the same purchase.
create table package_purchase_shares (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  package_purchase_id uuid not null references package_purchases(id) on delete cascade,
  patient_id uuid not null references patients(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (package_purchase_id, patient_id)
);

create index package_purchase_shares_purchase_idx on package_purchase_shares (package_purchase_id);
create index package_purchase_shares_patient_idx on package_purchase_shares (account_id, patient_id);

alter table package_purchase_shares enable row level security;

create policy "staff manage package_purchase_shares" on package_purchase_shares
  for all using (is_account_member(account_id)) with check (is_account_member(account_id));
