-- Platform billing: what QuiroFlow charges a clinic account for using the
-- product, distinct from stripe_connect_account_id (each clinic's own
-- connected Stripe account, used to bill THEIR patients). This is QuiroFlow's
-- own Stripe account billing the clinic itself.

-- Catalog of plans -- a small, slow-changing table (adding a plan or
-- adjusting its price is an occasional admin-panel action, not a per-account
-- setting), so it's a lookup table rather than columns duplicated per
-- account. `annual_price_cents` is the monthly-equivalent rate under annual
-- billing (matching how the pricing sheet shows it, e.g. "119 €/mes, 99
-- €/mes en anual") -- the actual Stripe annual charge is this figure x 12,
-- not this figure itself. null included_professionals/included_clinics
-- means unlimited (the Clinic tier); null extra_professional_price_cents
-- means no per-seat overage applies (again, Clinic -- already unlimited).
create table plans (
  id text primary key,
  name text not null,
  monthly_price_cents integer not null,
  annual_price_cents integer not null,
  included_professionals integer,
  included_clinics integer,
  extra_professional_price_cents integer,
  sort_order integer not null,
  created_at timestamptz not null default now()
);

insert into plans (id, name, monthly_price_cents, annual_price_cents, included_professionals, included_clinics, extra_professional_price_cents, sort_order) values
  ('starter', 'Starter', 6900, 5900, 1, 1, 2500, 1),
  ('pro', 'Pro', 11900, 9900, 3, 1, 2500, 2),
  ('clinic', 'Clinic', 19900, 16900, null, null, null, 3);

alter table plans enable row level security;
-- Plain pricing catalog, nothing account-specific or sensitive -- readable
-- by any logged-in user (a future "your plan" / upgrade page needs this),
-- writable only by the admin panel via the service-role key.
create policy "plans readable by any authenticated user" on plans
  for select to authenticated using (true);

-- One row per account, tracking what they're actually being charged and
-- their current standing -- deliberately a separate table from `accounts`
-- rather than more columns there: "staff can update their account" (see
-- 0001_init_schema.sql) lets any account member update any column on
-- accounts, which would let a clinic set its own subscription_status to
-- 'active' via a plain Supabase client call. No RLS policies at all here
-- means no role reaches this table except service_role (which bypasses RLS
-- entirely) -- exactly the admin panel and the Stripe webhook handler, and
-- no one else. Add a scoped SELECT policy later if/when the main app grows
-- a "your plan" settings page that needs to read it.
create table subscriptions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  plan_id text not null references plans(id),
  billing_interval text not null default 'monthly' check (billing_interval in ('monthly', 'annual')),
  status text not null default 'trialing' check (status in ('trialing', 'active', 'past_due', 'locked', 'canceled')),
  extra_professionals integer not null default 0,
  trial_ends_at timestamptz,
  -- QuiroFlow's own Stripe customer/subscription for billing this account --
  -- unrelated to accounts.stripe_connect_account_id (that's the clinic's own
  -- connected account, for billing their patients).
  stripe_customer_id text,
  stripe_subscription_id text,
  -- True only for QuiroFlow's own account: a real row, priced at 0, so it
  -- shows up in the admin dashboard's customer list like any other account
  -- instead of being silently absent from it.
  comped boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index subscriptions_account_id_key on subscriptions (account_id);

alter table subscriptions enable row level security;
