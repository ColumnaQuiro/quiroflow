-- A cash shift is an explicit open/close boundary for the cash-up report --
-- nothing before this tracked "shift" as a concept at all (CashShiftModal
-- used to just hardcode its window to calendar-day "today"). Shifts can
-- span days/weeks/months (matching how PracticeHub's own cash-up works),
-- so only an explicit "Close Shift" click ends one.
create table cash_shifts (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  opened_at timestamptz not null default now(),
  opened_by uuid not null references team_members(id) on delete cascade,
  closed_at timestamptz,
  closed_by uuid references team_members(id) on delete set null,
  note text
);

create index cash_shifts_account_open_idx on cash_shifts (account_id) where closed_at is null;
create index cash_shifts_account_opened_idx on cash_shifts (account_id, opened_at desc);

alter table cash_shifts enable row level security;

-- Same permission that gates recording payments/cash movements.
create policy "staff select cash shifts"
on cash_shifts for select
using (is_account_member(account_id) and has_permission(account_id, 'payments_allocate'));

create policy "staff insert cash shifts"
on cash_shifts for insert
with check (
  is_account_member(account_id)
  and has_permission(account_id, 'payments_allocate')
  and opened_by = current_team_member_id(account_id)
);

create policy "staff update cash shifts"
on cash_shifts for update
using (is_account_member(account_id) and has_permission(account_id, 'payments_allocate'))
with check (is_account_member(account_id) and has_permission(account_id, 'payments_allocate'));
