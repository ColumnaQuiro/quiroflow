alter table patient_docs add column external_reference text;
create index patient_docs_external_reference_idx on patient_docs (account_id, external_reference);
