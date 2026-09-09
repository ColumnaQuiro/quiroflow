-- Lets an importer (PracticeHub's custom-form-responses import, currently
-- the only one) create a reusable doc_templates row the first time it sees
-- a given source form, and safely re-run without duplicating that template
-- on every subsequent import. Same idempotency pattern already used by
-- patients.external_reference and patient_docs.external_reference --
-- matching on title text instead would be fragile the moment someone
-- renames or translates a template.
alter table doc_templates add column external_reference text;
