-- Records that a particular appointment was paid for out of a package, and
-- for how much.
--
-- QuiroFlow raises one invoice per payment, which is the right shape: a bono
-- is bought once and consumed over many visits, so per-visit invoices would
-- double-count the revenue that the bono purchase already recorded. But it
-- left the visits themselves with nothing against them -- a patient could
-- work through a twelve-visit bono and their Billing tab would show the
-- purchase and then ten months of silence. PracticeHub shows a line per
-- visit, and that line is what staff read to answer "has this one been paid
-- for?".
--
-- So this is deliberately NOT an invoice. It carries no debit or credit and
-- never touches a balance -- patient_live_balances does not look at it. It
-- exists to be displayed: a ledger row saying this visit drew 44 EUR from
-- Bono 12, sitting alongside the invoices rather than among them.
--
-- HISTORICAL ONLY. Do not write here from the live booking flow.
-- AppointmentBillingTab.usePackageSession() already records a package-covered
-- visit properly -- an invoice at the bono's per-session rate, a payment with
-- method 'credit', and a matching negative account_credits row -- so those
-- visits are already visible in the ledger and already balance. Adding a row
-- here for them would show the same visit twice. This table exists solely for
-- visits that happened in PracticeHub before the migration, which have no
-- invoice, no payment and no credit on this side and would otherwise be
-- invisible.
--
-- package_purchase_id is nullable because the link cannot always be inferred.
-- Where a patient held exactly one package covering the visit's date it is
-- set; where two overlapped, the amount is still recorded but the specific
-- package is left null rather than guessed at.
create table package_sessions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  patient_id uuid not null references patients(id) on delete cascade,
  package_purchase_id uuid references package_purchases(id) on delete set null,
  appointment_id uuid references appointments(id) on delete set null,
  amount_cents integer not null,
  used_at timestamptz not null,
  -- 'PH-invoice-<id>' for the PracticeHub import, so a re-run is a no-op.
  external_reference text,
  created_at timestamptz not null default now()
);

create unique index package_sessions_external_reference_uniq
  on package_sessions (account_id, external_reference)
  where external_reference is not null;

create index package_sessions_patient_idx on package_sessions (patient_id, used_at desc);
create index package_sessions_purchase_idx on package_sessions (package_purchase_id);
create index package_sessions_appointment_idx on package_sessions (appointment_id);

alter table package_sessions enable row level security;

-- Same patient-scoping as every other clinical/financial row, expressed with
-- the hoisted helpers 0143 introduced so this does not reintroduce a per-row
-- SECURITY DEFINER call on a table the Billing tab reads for every patient.
create policy "staff select package_sessions" on package_sessions
for select using (
  account_id in (select public.my_member_account_ids())
  and (
    account_id in (select public.my_all_patient_scope_accounts())
    or (account_id, patient_id) in (select * from public.my_own_patient_access())
  )
);

create policy "staff write package_sessions" on package_sessions
for all using (
  account_id in (select public.my_member_account_ids())
  and account_id in (select public.my_permitted_accounts('billing_access'))
  and (
    account_id in (select public.my_all_patient_scope_accounts())
    or (account_id, patient_id) in (select * from public.my_own_patient_access())
  )
)
with check (
  account_id in (select public.my_member_account_ids())
  and account_id in (select public.my_permitted_accounts('billing_access'))
  and (
    account_id in (select public.my_all_patient_scope_accounts())
    or (account_id, patient_id) in (select * from public.my_own_patient_access())
  )
);

-- Patients reading their own record see their own visits, matching the
-- "patients view own invoices"/"own payments" policies.
create policy "patients view own package_sessions" on package_sessions
for select using (
  patient_id in (select p.id from patients p where p.user_id = auth.uid())
);
