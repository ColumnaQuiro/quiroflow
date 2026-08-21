-- Lightweight "phase" tracker for Patient > Appointments, mirroring what
-- PracticeHub calls Current Phase: a target cadence + visit count that
-- progress is measured against. This does NOT auto-generate appointments --
-- staff still book each visit manually via the Calendar, same as today;
-- it only tracks progress toward a stated plan using appointments that
-- already exist.
create table care_plans (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  patient_id uuid not null references patients(id) on delete cascade,
  name text not null default 'Care Plan',
  frequency_value integer not null default 1 check (frequency_value > 0),
  frequency_unit text not null default 'week' check (frequency_unit in ('week', 'month')),
  total_visits integer not null check (total_visits > 0),
  started_at date not null default current_date,
  created_by uuid references team_members(id) on delete set null,
  created_at timestamptz not null default now()
);

create index care_plans_patient_idx on care_plans (account_id, patient_id, created_at desc);

alter table care_plans enable row level security;
create policy "staff manage care_plans" on care_plans
  for all using (is_account_member(account_id)) with check (is_account_member(account_id));
