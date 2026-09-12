-- A payment is money from a patient, not a property of an invoice.
--
-- Until now every payment had to hang off an invoice: payments.invoice_id was
-- NOT NULL and there was no patient_id, so the only way to know whose money it
-- was was to follow the invoice. That works while every payment settles a
-- charge, and it is why the PracticeHub import had to invent one -- it
-- fabricated a PH- invoice per payment so the payment had somewhere to live,
-- which is the reconstruction the re-migration exists to remove.
--
-- PracticeHub keeps the two apart, as accounting generally does: invoices are
-- charges (one per visit), payments are money in, and the balance is the
-- difference. It records no allocation between them, and on this account it
-- cannot: 208 patients have paid EUR 32,213.50 more than they were ever
-- invoiced, mostly bono value sitting as credit. There is no invoice for that
-- money to attach to, and inventing one is what went wrong the first time.
--
-- So payments get a patient of their own, and invoice_id becomes optional:
-- set when the payment settles a specific charge, null when it is simply money
-- on account.

alter table payments add column patient_id uuid references patients(id) on delete cascade;

-- Every existing payment has an invoice, so nobody's money changes owner here.
update payments set patient_id = i.patient_id from invoices i where i.id = payments.invoice_id;

alter table payments alter column patient_id set not null;
alter table payments alter column invoice_id drop not null;

-- Deleting an invoice used to delete its payments with it (ON DELETE CASCADE).
-- That is why usePackageSession() had to guard its cleanup on the invoice
-- having no payments: removing a wrongly-raised invoice would have destroyed
-- real money records. Now the money survives the charge and becomes
-- unallocated, which is what actually happened in the room.
alter table payments drop constraint payments_invoice_id_fkey;
alter table payments add constraint payments_invoice_id_fkey
  foreign key (invoice_id) references invoices(id) on delete set null;

create index payments_patient_id_idx on payments (patient_id);
create index payments_account_patient_idx on payments (account_id, patient_id);

comment on column payments.patient_id is
  'Whose money this is. Always set. invoice_id says which charge it settles, if any.';
comment on column payments.invoice_id is
  'The charge this payment settles, or null when it is money on account.';

-- ---------------------------------------------------------------------
-- RLS: gate on the patient, not on the invoice
-- ---------------------------------------------------------------------
--
-- All three policies reached the patient through invoice_id. A null invoice_id
-- makes `invoice_id in (...)` evaluate to null rather than true, so an
-- unallocated payment would have been invisible and unwritable to everyone,
-- staff included. Each policy below says exactly what its predecessor said --
-- my_accessible_invoice_ids() is itself "invoices whose account I hold all
-- patients in, or whose patient I have my own access to" -- but reads the
-- patient off the row instead of joining to find it.

drop policy if exists "patients view own payments" on payments;
create policy "patients view own payments" on payments
for select using (
  patient_id in (select p.id from patients p where p.user_id = auth.uid())
);

drop policy if exists "staff select payments" on payments;
create policy "staff select payments" on payments
for select using (
  account_id in (select my_member_account_ids())
  and (
    account_id in (select my_all_patient_scope_accounts())
    or (account_id, patient_id) in (select * from my_own_patient_access())
  )
);

drop policy if exists "staff write payments" on payments;
create policy "staff write payments" on payments
for all using (
  account_id in (select my_member_account_ids())
  and account_id in (select my_permitted_accounts('payments_allocate'))
  and (
    account_id in (select my_all_patient_scope_accounts())
    or (account_id, patient_id) in (select * from my_own_patient_access())
  )
) with check (
  account_id in (select my_member_account_ids())
  and account_id in (select my_permitted_accounts('payments_allocate'))
  and (
    account_id in (select my_all_patient_scope_accounts())
    or (account_id, patient_id) in (select * from my_own_patient_access())
  )
);
