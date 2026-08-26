-- Legal identity for invoices, separate from the clinic's display name --
-- e.g. "ColumnaQuiro" (name) vs "Centro Quiropractico Columnaquiro S.L."
-- (legal_name). Both nullable: invoices render conditionally until someone
-- fills these in via Settings > Fiscal Data.
alter table clinics add column legal_name text;
alter table clinics add column tax_id text;
