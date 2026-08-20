-- Manual cash drawer adjustments (float top-ups, bank drops, petty cash) --
-- combined with the day's `payments` rows where method = 'cash', this is
-- what "Current Shift Summary" reconciles against.
create table cash_movements (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  clinic_id uuid references clinics(id) on delete set null,
  team_member_id uuid not null references team_members(id) on delete cascade,
  type text not null check (type in ('cash_in', 'cash_out')),
  amount_cents integer not null check (amount_cents > 0),
  note text,
  created_at timestamptz not null default now()
);

create index cash_movements_account_created_idx on cash_movements (account_id, created_at desc);

alter table cash_movements enable row level security;

-- Same permission that gates recording payments -- cash handling is a
-- subset of that responsibility, not a separate concern.
create policy "staff select cash movements"
on cash_movements for select
using (is_account_member(account_id) and has_permission(account_id, 'payments_allocate'));

create policy "staff insert cash movements"
on cash_movements for insert
with check (
  is_account_member(account_id)
  and has_permission(account_id, 'payments_allocate')
  and team_member_id = current_team_member_id(account_id)
);
