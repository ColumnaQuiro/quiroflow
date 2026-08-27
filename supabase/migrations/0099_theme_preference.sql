-- Per-user light/dark/system preference, not per-account -- each staff
-- member's own screen, same as any OS-level appearance setting.
alter table team_members add column theme_preference text not null default 'system'
  check (theme_preference in ('light', 'dark', 'system'));
