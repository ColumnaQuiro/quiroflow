-- Saved configurations for the custom report builder (Reports -> Custom
-- Reports): source, metric, grouping, chart type, and range, so staff can
-- revisit a report without rebuilding it each time.

create table custom_reports (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  name text not null,
  config jsonb not null,
  created_by uuid references team_members(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table custom_reports enable row level security;

create policy "staff manage custom_reports" on custom_reports
  for all using (is_account_member(account_id)) with check (is_account_member(account_id));
