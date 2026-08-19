-- Data Exports reports need to reliably find "the" data-protection and
-- consent templates to flag patients missing them -- matching on title text
-- is fragile (breaks the moment someone renames or translates a template).
-- A small enum-like category column lets a template opt in explicitly.

alter table doc_templates add column category text;
alter table doc_templates add constraint doc_templates_category_check
  check (category is null or category in ('data_protection', 'consent'));
