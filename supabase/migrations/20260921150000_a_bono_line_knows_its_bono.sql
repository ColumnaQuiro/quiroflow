-- A bono session line now says which bono, structurally.
--
-- Until now the only thing tying an invoice line to the bono it drew from was
-- its DESCRIPTION -- `${package_name} — sesión` -- so grouping meant matching
-- text. That text is a copy of the bono's name at purchase time, and it is
-- not stable: four bonos produced eight spellings, because a bono migrated
-- from PracticeHub is called "Bono 12" and the same bono sold here is "Bono
-- 12 sesiones". One line from 14 Sep even reads "session", in English,
-- because the description used to be built from the staff member's own UI
-- language.
--
-- The key already existed one level away: invoice -> appointment ->
-- package_sessions -> package_purchases. It resolves for every bono line we
-- have (50 of 50), but nothing uses it, because walking four tables to answer
-- "which bono was this" is harder than reading the text sitting right there.
-- So the line carries the key itself.
--
-- The description stays. It is what a patient reads on a factura, and it
-- should go on saying "Bono 12 sesiones — sesión" rather than a uuid. What
-- changes is that it is now decoration: anything grouping, reporting or
-- reconciling reads the column.

alter table invoice_line_items
  add column package_purchase_id uuid references package_purchases(id) on delete set null;

comment on column invoice_line_items.package_purchase_id is
  'The bono this line drew a session from, where it drew one. Null on every other kind of line. Set so that grouping a bono''s sessions never depends on the description, which is a copy of the package name at purchase time and differs between a migrated bono and the same bono sold here. See utils/billingDescriptions.ts for why the description itself is not an identifier.';

create index if not exists invoice_line_items_package_purchase_id_idx
  on invoice_line_items (package_purchase_id) where package_purchase_id is not null;

-- Backfill through the chain that already resolves.
--
-- Only invoices carrying exactly ONE line: a bono visit charges one line, and
-- an invoice with extras on it has no single line this can safely claim is
-- the session. Those stay null rather than guessing -- a wrong key is worse
-- than none, because the point of the column is to be trusted without
-- re-reading the text.
update invoice_line_items li
set package_purchase_id = ps.package_purchase_id
from invoices i
join package_sessions ps
  on ps.appointment_id = i.appointment_id
 and ps.patient_id = i.patient_id
where li.invoice_id = i.id
  and li.package_purchase_id is null
  and (select count(*) from invoice_line_items sib where sib.invoice_id = i.id) = 1;
