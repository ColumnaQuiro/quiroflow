-- Configurable list of reasons staff can pick when dragging an appointment
-- to a new time (mirrors referral_sources' shape/policy).
create table reschedule_reasons (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);
alter table reschedule_reasons enable row level security;
create policy "staff manage reschedule_reasons" on reschedule_reasons for all using (is_account_member(account_id)) with check (is_account_member(account_id));

-- One row per drag-to-reschedule confirmation, so "Rescheduled" in Today at
-- a Glance can count appointments that moved away from a given day even
-- though the appointment row itself only ever holds its current time.
create table appointment_reschedules (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  appointment_id uuid not null references appointments(id) on delete cascade,
  from_starts_at timestamptz not null,
  to_starts_at timestamptz not null,
  reason_id uuid references reschedule_reasons(id) on delete set null,
  note text,
  fee_applied boolean not null default false,
  created_by uuid references team_members(id) on delete set null,
  created_at timestamptz not null default now()
);
create index appointment_reschedules_from_idx on appointment_reschedules (account_id, from_starts_at);
alter table appointment_reschedules enable row level security;
create policy "staff manage appointment_reschedules" on appointment_reschedules for all using (is_account_member(account_id)) with check (is_account_member(account_id));

-- The flat fee (if any) applied when staff check "Apply a scheduling policy
-- fee to patient file" on the reschedule confirmation. Nullable/0 = no fee
-- configured, in which case the checkbox has nothing to charge.
alter table accounts add column scheduling_policy_fee_cents integer;
