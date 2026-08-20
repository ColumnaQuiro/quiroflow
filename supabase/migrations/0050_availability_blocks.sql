-- "Availability Manager" -- lets staff mark a room/time as unavailable
-- (holiday, maintenance, blocked-out lunch) so it's visually distinct on
-- the Calendar grid and separate from real patient appointments.
create table availability_blocks (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  clinic_id uuid not null references clinics(id) on delete cascade,
  room_id uuid references calendar_resources(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  note text,
  created_by uuid references team_members(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint availability_blocks_valid_range check (ends_at > starts_at)
);

create index availability_blocks_clinic_range_idx on availability_blocks (clinic_id, starts_at);

alter table availability_blocks enable row level security;

-- Same read/write gate as appointments' "anyone who can see the calendar"
-- policy -- blocking a room is a shared-resource action, not scoped to a
-- single practitioner's own patients the way appointment rows are.
create policy "staff select availability blocks"
on availability_blocks for select
using (is_account_member(account_id) and permission_scope(account_id, 'calendar_scope') != 'none');

create policy "staff manage availability blocks"
on availability_blocks for all
using (is_account_member(account_id) and permission_scope(account_id, 'calendar_scope') != 'none')
with check (is_account_member(account_id) and permission_scope(account_id, 'calendar_scope') != 'none');
