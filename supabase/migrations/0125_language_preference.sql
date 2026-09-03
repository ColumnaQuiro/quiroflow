-- Per-user English/Spanish UI preference, not per-account -- same
-- reasoning as theme_preference: each staff member's own screen, not a
-- clinic-wide switch.
alter table team_members add column language_preference text not null default 'en'
  check (language_preference in ('en', 'es'));
