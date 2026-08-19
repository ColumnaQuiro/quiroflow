-- Reports need to reliably find "did this patient complete the consent /
-- data-protection doc" -- patient_docs previously had no link back to the
-- template it was generated from, only a copied title, which would have
-- meant matching on title text (breaks if a patient's doc gets renamed).

alter table patient_docs add column template_id uuid references doc_templates(id) on delete set null;
