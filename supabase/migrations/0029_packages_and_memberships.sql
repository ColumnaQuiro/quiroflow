-- Phase 3: packages/bonos (pre-paid session bundles) and memberships
-- (recurring plans), plus what Debtors and Memberships reports need.
-- Neither existed before -- QuiroFlow had no concept of a multi-session
-- bundle or a subscription. Payment tracking reuses the existing
-- invoices/payments machinery (a purchase links to an invoice) rather than
-- duplicating it; there's no live payment-gateway integration here, so
-- membership billing is staff-recorded per period, not auto-charged.

create table packages (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  name text not null,
  session_count integer not null check (session_count > 0),
  price_cents integer not null default 0,
  created_at timestamptz not null default now()
);

create table package_purchases (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  patient_id uuid not null references patients(id) on delete cascade,
  package_id uuid references packages(id) on delete set null,
  invoice_id uuid references invoices(id) on delete set null,
  package_name text not null,
  sessions_total integer not null check (sessions_total > 0),
  sessions_used integer not null default 0 check (sessions_used >= 0),
  price_cents integer not null default 0,
  purchased_at timestamptz not null default now(),
  created_by uuid references team_members(id) on delete set null
);

create index package_purchases_patient_idx on package_purchases (account_id, patient_id);

create table memberships (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  name text not null,
  price_cents integer not null default 0,
  created_at timestamptz not null default now()
);

create table patient_memberships (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  patient_id uuid not null references patients(id) on delete cascade,
  membership_id uuid references memberships(id) on delete set null,
  membership_name text not null,
  price_cents integer not null default 0,
  status text not null default 'active' check (status in ('active', 'paused', 'cancelled')),
  started_at timestamptz not null default now(),
  created_by uuid references team_members(id) on delete set null
);

create index patient_memberships_patient_idx on patient_memberships (account_id, patient_id);

-- One row per billing period, so a failed auto-payment is visible and
-- monthly membership revenue is queryable without recomputing it.
create table membership_payments (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  patient_membership_id uuid not null references patient_memberships(id) on delete cascade,
  period_start date not null,
  amount_cents integer not null default 0,
  status text not null default 'paid' check (status in ('paid', 'failed')),
  created_at timestamptz not null default now()
);

create index membership_payments_pm_idx on membership_payments (patient_membership_id, period_start desc);

alter table packages enable row level security;
alter table package_purchases enable row level security;
alter table memberships enable row level security;
alter table patient_memberships enable row level security;
alter table membership_payments enable row level security;

create policy "staff manage packages" on packages for all using (is_account_member(account_id)) with check (is_account_member(account_id));
create policy "staff manage package_purchases" on package_purchases for all using (is_account_member(account_id)) with check (is_account_member(account_id));
create policy "staff manage memberships" on memberships for all using (is_account_member(account_id)) with check (is_account_member(account_id));
create policy "staff manage patient_memberships" on patient_memberships for all using (is_account_member(account_id)) with check (is_account_member(account_id));
create policy "staff manage membership_payments" on membership_payments for all using (is_account_member(account_id)) with check (is_account_member(account_id));
