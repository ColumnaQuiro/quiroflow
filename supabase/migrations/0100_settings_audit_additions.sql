-- Referral sources gain PracticeHub's status/visibility split: visibility
-- controls whether a source can appear on patient-facing forms (online
-- booking) vs staff-only entry.
alter table referral_sources add column status text not null default 'active' check (status in ('active', 'inactive'));
alter table referral_sources add column visibility text not null default 'private' check (visibility in ('private', 'public'));

-- Modalities: categorise practitioners/appointment types/services by what's
-- being provided (Chiropractic, Sports Massage, Osteopathy, etc).
create table modalities (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table modalities enable row level security;
create policy "staff manage modalities" on modalities for all using (is_account_member(account_id)) with check (is_account_member(account_id));

-- Payment methods: an admin-managed list (Cash/Card plus whatever else a
-- clinic wants, e.g. Bank Transfer) rather than a fixed set baked into the
-- app. Seeded with Cash/Card for every existing account below.
create table payment_methods (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  name text not null,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
alter table payment_methods enable row level security;
create policy "staff manage payment_methods" on payment_methods for all using (is_account_member(account_id)) with check (is_account_member(account_id));

insert into payment_methods (account_id, name, sort_order)
select id, 'Cash', 0 from accounts
union all
select id, 'Card', 1 from accounts;

-- Scheduling policies: the reschedule fee already shipped
-- (scheduling_policy_fee_cents); cancellation and missed-appointment get
-- their own flat fee alongside it.
alter table accounts add column cancellation_fee_cents integer;
alter table accounts add column missed_appointment_fee_cents integer;

-- New Patient Fields: which fields show (and are required) on the Add
-- Patient panel, keyed by field name. Absent key = visible, not required
-- (today's behavior), so this is additive/backward-compatible.
alter table accounts add column new_patient_field_config jsonb not null default '{}'::jsonb;

-- Invoice settings (account-wide; distinct from the existing per-clinic
-- footer text/logo already on clinics).
alter table accounts add column next_invoice_number integer;
alter table accounts add column send_invoices_automatically_default boolean not null default false;
alter table accounts add column show_dob_on_invoices boolean not null default false;
alter table accounts add column show_ssn_on_invoices boolean not null default false;
alter table accounts add column show_taxes_on_invoices boolean not null default false;
alter table accounts add column hide_invoice_balance boolean not null default false;
alter table accounts add column hide_account_balance boolean not null default false;
alter table accounts add column hide_payments_on_invoices boolean not null default false;
alter table accounts add column hide_provider_on_invoices boolean not null default false;
alter table accounts add column hide_next_visit_on_invoices boolean not null default false;
alter table accounts add column hide_logo_on_invoices boolean not null default false;
alter table accounts add column invoice_email_subject text;
alter table accounts add column invoice_email_body text;

-- Rounds out the clinical attribute set FlagsPanel.vue already covers
-- (chief_complaint, red_flags, yellow_flags) to match PracticeHub's five
-- system attributes.
alter table patients add column diagnosis text;
alter table patients add column goals text;
