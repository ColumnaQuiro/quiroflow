-- The Statistics report needs to count "first visits", "reports",
-- "revisions", etc. -- appointment_types only has a free-text name, and
-- every clinic phrases these differently (and in different languages), so
-- matching on name text would be fragile. A tagged stage lets staff opt
-- each of their real appointment types into a standard bucket once.

alter table appointment_types add column stage text;
alter table appointment_types add constraint appointment_types_stage_check
  check (stage is null or stage in ('first_visit', 'first_visit_offer', 'report', 'revision', 'maintenance', 'adjustment', 'other'));
