-- QuiroFlow Phase 1 schema: multi-tenant practice management core.
-- Run this in the Supabase SQL Editor (or via `supabase db push`).

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------

create table accounts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table clinics (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  name text not null,
  address text,
  created_at timestamptz not null default now()
);

create table calendar_resources (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  clinic_id uuid not null references clinics(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

create table team_members (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  full_name text not null,
  role text not null default 'practitioner'
    check (role in ('owner', 'practitioner', 'front_desk')),
  color text not null default '#4C6FEB',
  created_at timestamptz not null default now(),
  unique (account_id, user_id)
);

create table team_member_clinics (
  team_member_id uuid not null references team_members(id) on delete cascade,
  clinic_id uuid not null references clinics(id) on delete cascade,
  primary key (team_member_id, clinic_id)
);

create table patients (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  clinic_id uuid references clinics(id) on delete set null,
  user_id uuid references auth.users(id) on delete set null,
  first_name text not null,
  last_name text,
  date_of_birth date,
  email text,
  phone text,
  balance_cents integer not null default 0,
  tags text[] not null default '{}',
  created_at timestamptz not null default now()
);

create table appointment_types (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  name text not null,
  duration_minutes integer not null default 30,
  color text not null default '#4C6FEB',
  default_price_cents integer not null default 0,
  created_at timestamptz not null default now()
);

create table appointments (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  clinic_id uuid not null references clinics(id) on delete cascade,
  room_id uuid references calendar_resources(id) on delete set null,
  practitioner_id uuid references team_members(id) on delete set null,
  patient_id uuid not null references patients(id) on delete cascade,
  appointment_type_id uuid references appointment_types(id) on delete set null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'booked'
    check (status in ('booked', 'completed', 'cancelled', 'no_show')),
  created_at timestamptz not null default now()
);

create table visit_notes (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  appointment_id uuid not null references appointments(id) on delete cascade,
  body text not null,
  created_by uuid references team_members(id) on delete set null,
  created_at timestamptz not null default now()
);

create table services_products (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  name text not null,
  price_cents integer not null default 0,
  tax_rate numeric(5, 2) not null default 0,
  created_at timestamptz not null default now()
);

create table invoices (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  patient_id uuid not null references patients(id) on delete cascade,
  appointment_id uuid references appointments(id) on delete set null,
  invoice_number text not null,
  status text not null default 'unpaid'
    check (status in ('unpaid', 'paid', 'void')),
  total_cents integer not null default 0,
  created_at timestamptz not null default now()
);

create table invoice_line_items (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  invoice_id uuid not null references invoices(id) on delete cascade,
  service_id uuid references services_products(id) on delete set null,
  description text not null,
  quantity integer not null default 1,
  price_cents integer not null default 0
);

create table payments (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  invoice_id uuid not null references invoices(id) on delete cascade,
  amount_cents integer not null,
  method text not null default 'card'
    check (method in ('card', 'cash', 'other')),
  paid_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------

create index appointments_clinic_starts_at_idx on appointments (clinic_id, starts_at);
create index appointments_patient_idx on appointments (patient_id);
create index patients_account_idx on patients (account_id);
create index invoices_patient_idx on invoices (patient_id);
create index invoice_line_items_invoice_idx on invoice_line_items (invoice_id);
create index payments_invoice_idx on payments (invoice_id);

-- ---------------------------------------------------------------------
-- Helper functions (security definer so RLS checks don't recurse)
-- ---------------------------------------------------------------------

create or replace function is_account_member(target_account_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from team_members tm
    where tm.account_id = target_account_id
      and tm.user_id = auth.uid()
  );
$$;

create or replace function is_own_patient_account(target_account_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from patients p
    where p.account_id = target_account_id
      and p.user_id = auth.uid()
  );
$$;

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------

alter table accounts enable row level security;
alter table clinics enable row level security;
alter table calendar_resources enable row level security;
alter table team_members enable row level security;
alter table team_member_clinics enable row level security;
alter table patients enable row level security;
alter table appointment_types enable row level security;
alter table appointments enable row level security;
alter table visit_notes enable row level security;
alter table services_products enable row level security;
alter table invoices enable row level security;
alter table invoice_line_items enable row level security;
alter table payments enable row level security;

-- accounts: visible to staff who belong to it
create policy "staff can view their account" on accounts
  for select using (is_account_member(id));
create policy "staff can update their account" on accounts
  for update using (is_account_member(id));

-- clinics, calendar_resources, team_members, team_member_clinics,
-- appointment_types, services_products: staff-only, scoped by account.
create policy "staff manage clinics" on clinics
  for all using (is_account_member(account_id)) with check (is_account_member(account_id));

create policy "staff manage calendar_resources" on calendar_resources
  for all using (is_account_member(account_id)) with check (is_account_member(account_id));

create policy "staff manage team_members" on team_members
  for all using (is_account_member(account_id)) with check (is_account_member(account_id));

create policy "staff manage team_member_clinics" on team_member_clinics
  for all using (
    exists (select 1 from team_members tm where tm.id = team_member_id and is_account_member(tm.account_id))
  ) with check (
    exists (select 1 from team_members tm where tm.id = team_member_id and is_account_member(tm.account_id))
  );

create policy "staff manage appointment_types" on appointment_types
  for all using (is_account_member(account_id)) with check (is_account_member(account_id));

create policy "staff manage services_products" on services_products
  for all using (is_account_member(account_id)) with check (is_account_member(account_id));

-- patients: staff full access; patients can view (not edit) their own row
create policy "staff manage patients" on patients
  for all using (is_account_member(account_id)) with check (is_account_member(account_id));
create policy "patients view own record" on patients
  for select using (user_id = auth.uid());

-- appointments: staff full access; patients can view their own appointments
create policy "staff manage appointments" on appointments
  for all using (is_account_member(account_id)) with check (is_account_member(account_id));
create policy "patients view own appointments" on appointments
  for select using (
    patient_id in (select id from patients where user_id = auth.uid())
  );

-- visit_notes: staff-only (clinical notes are not exposed to the patient portal)
create policy "staff manage visit_notes" on visit_notes
  for all using (is_account_member(account_id)) with check (is_account_member(account_id));

-- invoices: staff full access; patients can view their own invoices
create policy "staff manage invoices" on invoices
  for all using (is_account_member(account_id)) with check (is_account_member(account_id));
create policy "patients view own invoices" on invoices
  for select using (
    patient_id in (select id from patients where user_id = auth.uid())
  );

-- invoice_line_items: staff full access; patients can view lines on their own invoices
create policy "staff manage invoice_line_items" on invoice_line_items
  for all using (is_account_member(account_id)) with check (is_account_member(account_id));
create policy "patients view own invoice_line_items" on invoice_line_items
  for select using (
    invoice_id in (
      select i.id from invoices i
      join patients p on p.id = i.patient_id
      where p.user_id = auth.uid()
    )
  );

-- payments: staff-only in Phase 1 (no online payment yet)
create policy "staff manage payments" on payments
  for all using (is_account_member(account_id)) with check (is_account_member(account_id));
