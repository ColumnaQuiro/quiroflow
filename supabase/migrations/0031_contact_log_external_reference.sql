alter table contact_log add column external_reference text;
create index contact_log_external_reference_idx on contact_log (account_id, external_reference);
