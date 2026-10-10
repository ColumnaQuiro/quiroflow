-- A form in another language, as a version of the clinic's own.
--
-- A clinic sends the same form to Spanish- and English-speaking patients. Two
-- unrelated templates would make every automation that sends one, waits for
-- it or reads an answer on it choose between them -- and say nothing about
-- the other. So a translation points at the form it translates, and carries
-- the language it is in: an automation names the original, the patient
-- receives the version in their preferred language when there is one, and a
-- wait or a branch on the original counts whichever version came back.
--
-- An answer is read by the question's id, so a translation copies the
-- original's blocks ids and all (Settings > Docs "Add English version"), and
-- only the words change.
--
-- ON DELETE SET NULL: deleting the original leaves the translation as a form
-- of its own rather than taking it -- and the copies patients filled in from
-- it, which are theirs -- down with it.

alter table public.doc_templates
  add column if not exists language text,
  add column if not exists translation_of uuid references public.doc_templates (id) on delete set null;

alter table public.doc_templates
  add constraint doc_templates_translation_has_language check (translation_of is null or language is not null);

create index if not exists doc_templates_translation_of_idx on public.doc_templates (translation_of) where translation_of is not null;
