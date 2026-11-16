-- A form's translations live inside the form.
--
-- 20261010073256 made a translation a template of its own pointing at the
-- original. It worked, but a copy drifts: a question added to the original
-- never reached the English copy, so English-speaking patients were sent a
-- form missing it and nothing said so. Now a form has one set of questions
-- and, per language, only the words:
--
--   translations = {
--     "en": { "title": "Health history",
--             "fields": { "<block id>": { "label": "...", "options": ["..."] } } }
--   }
--
-- Keyed by block id, so the questions, their order and their types are always
-- the original's. A block with no entry is sent in the original language
-- rather than left out, and Settings > Docs counts it as still to translate.
--
-- patient_docs.language records which version a patient was sent (null: the
-- original), and template_id now always names the original form.

alter table public.doc_templates
  add column if not exists translations jsonb not null default '{}'::jsonb;

alter table public.doc_templates
  add constraint doc_templates_translations_is_object check (jsonb_typeof(translations) = 'object');

alter table public.patient_docs
  add column if not exists language text;

-- Fold the existing translation templates into their originals. Only the words
-- that differ from the original count as translated: an untouched copy is
-- the original's text, and is better shown as still to do.
do $$
declare
  r record;
begin
  for r in
    select t.id, t.translation_of, t.language, t.title, o.title as o_title, t.fields as t_fields, o.fields as o_fields
    from public.doc_templates t
    join public.doc_templates o on o.id = t.translation_of
    where t.language is not null
  loop
    update public.doc_templates o
    set translations = o.translations || jsonb_build_object(
      r.language,
      jsonb_strip_nulls(jsonb_build_object(
        -- "Historia clínica (English)" was the title the copy was given; left
        -- as that, the name was never translated, and stays to do.
        'title', nullif(regexp_replace(r.title, '\s*\((English|Inglés|French|Francés)\)\s*$', ''), r.o_title),
        'fields', coalesce((
          select jsonb_object_agg(tf->>'id', jsonb_strip_nulls(jsonb_build_object(
            'label', case when tf->>'label' is distinct from bf->>'label' then tf->'label' end,
            'options', case when tf->'options' is distinct from bf->'options'
                             and jsonb_typeof(tf->'options') = 'array'
                             and jsonb_typeof(bf->'options') = 'array'
                             and jsonb_array_length(tf->'options') = jsonb_array_length(bf->'options')
                            then tf->'options' end
          )))
          from jsonb_array_elements(r.t_fields) tf
          join jsonb_array_elements(r.o_fields) bf on bf->>'id' = tf->>'id'
          where tf->>'label' is distinct from bf->>'label' or tf->'options' is distinct from bf->'options'
        ), '{}'::jsonb)
      ))
    )
    where o.id = r.translation_of
      and not (o.translations ? r.language);
  end loop;
end $$;

-- What patients were sent from a translation now names the original, with
-- the language it went out in: so the counts in Settings > Docs, Reports'
-- categories and an automation waiting on the original see one form.
update public.patient_docs d
set template_id = t.translation_of,
    language = t.language
from public.doc_templates t
where d.template_id = t.id
  and t.translation_of is not null;

-- The translation templates themselves stay for now, and translation_of with
-- them: the release running when this applies still sends them, and still
-- reads that column. The app from this change on no longer lists them; a
-- later migration removes them once no deployed code reads them.
comment on column public.doc_templates.translation_of is
  'Superseded by doc_templates.translations (20261116144215). Kept until no deployed code reads it.';
