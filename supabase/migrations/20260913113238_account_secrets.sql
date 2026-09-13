-- Somewhere for integration credentials to live that is not readable by every
-- member of the clinic.
--
-- `accounts` holds stripe_secret_key, stripe_webhook_secret,
-- whatsapp_access_token and practicehub_api_key in plaintext, and its RLS is:
--
--   staff can view their account    SELECT  using (is_account_member(id))
--   staff can update their account  UPDATE  using (is_account_member(id))
--
-- RLS is row-level, not column-level. So ANY member of the account -- any
-- role, no permission check, a receptionist or a locum or anyone ever invited
-- -- can fetch the live Stripe secret key with one REST call, and overwrite
-- it. That key charges cards, issues refunds, and reads the clinic's whole
-- Stripe customer history. None of that goes through the app's own permission
-- system, because it does not go through the app.
--
-- A column-level grant cannot fix it in place: in Postgres a table-level
-- SELECT grant dominates a column-level revoke, so restricting one column
-- means revoking SELECT on `accounts` entirely and re-granting every other
-- column by name -- which then silently withholds any column added later.
--
-- Generic (name, value) rather than a column per secret, so moving the
-- remaining two needs code changes but no further migration.
create table account_secrets (
  account_id uuid not null references accounts(id) on delete cascade,
  name text not null,
  value text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (account_id, name)
);

alter table account_secrets enable row level security;

-- Deliberately no policies: RLS on with none is deny-all for every role
-- except service_role, which bypasses it. The revoke makes that explicit
-- rather than trusting Supabase's default grants, which hand `anon` SELECT on
-- new public-schema tables. Same shape as whatsapp_app_secrets.
revoke all on account_secrets from anon, authenticated;

-- Copy what is there now. The accounts columns are deliberately left in place
-- and populated by this migration: the reader falls back to them, so a
-- database that has run this migration works whether or not the new code is
-- deployed yet, and vice versa. They are emptied in a follow-up step once the
-- deploy is confirmed -- which is the step that actually closes the exposure.
insert into account_secrets (account_id, name, value)
select id, 'stripe_secret_key', stripe_secret_key from accounts where stripe_secret_key is not null
union all
select id, 'stripe_webhook_secret', stripe_webhook_secret from accounts where stripe_webhook_secret is not null
on conflict (account_id, name) do nothing;
