alter table patients add column gender text check (gender is null or gender in ('female', 'male', 'other'));

-- Append-only ledger for prepaid patient credit (e.g. a gift bought in
-- advance) that isn't tied to any invoice at the time it's added. A positive
-- row adds credit; a negative row records credit being spent (optionally
-- against a specific invoice via invoice_id). usePatientFinancialSummary
-- sums this alongside invoices/payments to get the patient's true balance.
create table account_credits (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  patient_id uuid not null references patients(id) on delete cascade,
  amount_cents integer not null,
  reason text,
  invoice_id uuid references invoices(id) on delete set null,
  created_by uuid references team_members(id) on delete set null,
  created_at timestamptz not null default now()
);

create index account_credits_patient_idx on account_credits (patient_id, created_at desc);

alter table account_credits enable row level security;
create policy "staff read account_credits" on account_credits
  for select using (is_account_member(account_id));
create policy "staff add account_credits" on account_credits
  for insert with check (is_account_member(account_id) and has_permission(account_id, 'billing_access'));
