-- Pivot Docs from a single free-text document to a Tally.so-style block
-- form: an ordered array of typed fields (heading/text for static
-- content, short_text/long_text/checkbox/date/signature for actual
-- inputs a patient or staff member fills in). Templates and patient docs
-- share the same "fields" shape; a patient doc's fields additionally
-- carry a filled-in `value`.

alter table doc_templates drop column content;
alter table doc_templates add column fields jsonb not null default '[]'::jsonb;

alter table patient_docs drop column content;
alter table patient_docs add column fields jsonb not null default '[]'::jsonb;
alter table patient_docs add column completed_at timestamptz;
