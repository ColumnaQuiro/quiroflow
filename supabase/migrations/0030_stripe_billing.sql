-- Stripe-backed automated billing: per-clinic Stripe keys, a saved card per
-- patient, and Subscription Schedules for package installments (fixed
-- iteration count) or open-ended memberships. Layers on top of the existing
-- package_purchases/patient_memberships rather than replacing the manual
-- "log payment" path, so clinics can mix manual and Stripe-billed patients.

alter table accounts add column stripe_secret_key text;
alter table accounts add column stripe_publishable_key text;
alter table accounts add column stripe_webhook_secret text;

create table patient_stripe_customers (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  patient_id uuid not null references patients(id) on delete cascade,
  stripe_customer_id text not null,
  default_payment_method_id text,
  created_at timestamptz not null default now(),
  unique (account_id, patient_id)
);

create table payment_schedules (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  patient_id uuid not null references patients(id) on delete cascade,
  package_purchase_id uuid references package_purchases(id) on delete cascade,
  patient_membership_id uuid references patient_memberships(id) on delete cascade,
  stripe_subscription_schedule_id text not null,
  stripe_subscription_id text,
  interval text not null default 'month',
  interval_count integer not null default 1,
  installments_total integer,
  installments_paid integer not null default 0,
  status text not null default 'active' check (status in ('active', 'completed', 'canceled', 'past_due')),
  created_at timestamptz not null default now(),
  constraint payment_schedules_target_check check (package_purchase_id is not null or patient_membership_id is not null)
);
create index payment_schedules_patient_idx on payment_schedules (account_id, patient_id);

create table stripe_payment_events (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  payment_schedule_id uuid not null references payment_schedules(id) on delete cascade,
  stripe_invoice_id text,
  stripe_payment_intent_id text,
  amount_cents integer not null,
  status text not null check (status in ('paid', 'failed')),
  period_start date not null,
  created_at timestamptz not null default now()
);
create index stripe_payment_events_schedule_idx on stripe_payment_events (payment_schedule_id, period_start desc);

alter table patient_stripe_customers enable row level security;
alter table payment_schedules enable row level security;
alter table stripe_payment_events enable row level security;

create policy "staff manage patient_stripe_customers" on patient_stripe_customers for all using (is_account_member(account_id)) with check (is_account_member(account_id));
create policy "staff manage payment_schedules" on payment_schedules for all using (is_account_member(account_id)) with check (is_account_member(account_id));
create policy "staff manage stripe_payment_events" on stripe_payment_events for all using (is_account_member(account_id)) with check (is_account_member(account_id));
