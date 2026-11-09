-- Portuguese (Portugal) and German join English and Spanish as interface
-- languages. Staff keep their choice in team_members.language_preference
-- (Settings > Account > Language), which until now accepted only en and es.
--
-- Widening a check is backwards-compatible with the code already deployed:
-- it never writes pt or de, and every value it does write is still allowed.
alter table team_members drop constraint if exists team_members_language_preference_check;
alter table team_members add constraint team_members_language_preference_check
  check (language_preference in ('en', 'es', 'pt', 'de'));
