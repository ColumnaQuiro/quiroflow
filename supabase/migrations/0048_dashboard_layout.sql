-- Per-user dashboard widget arrangement: [{ id, type, size }, ...]. No new
-- RLS needed -- team_members already has an unrestricted self/account-member
-- update policy, so a user can already update their own row.
alter table team_members add column dashboard_layout jsonb not null default '[]'::jsonb;
