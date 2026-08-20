-- account_roles table: named, per-account, admin-configurable permission sets
create table account_roles (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  name text not null,
  is_system boolean not null default false,
  permissions jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, name)
);

alter table team_members
  add column role_id uuid references account_roles(id) on delete set null,
  add column is_owner boolean not null default false;

alter table account_invites
  add column role_id uuid references account_roles(id) on delete set null;

create index appointments_patient_practitioner_idx on appointments (patient_id, practitioner_id);

alter table account_roles enable row level security;
