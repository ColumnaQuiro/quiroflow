-- Somewhere to keep each clinic's Meta App Secret, so the WhatsApp webhook can
-- verify that a request really came from Meta.
--
-- Until now `/api/whatsapp/webhook` read its body and acted on it with no
-- authentication at all -- no signature check, no shared secret. A POST
-- carrying a clinic's whatsapp_phone_number_id (an identifier, not a
-- credential: it is shown in Settings, used in integration work, and appears
-- in logs) and a patient's phone number could cancel that patient's
-- appointment, which then fired the appointment.cancelled automations and
-- messaged them, or inject invented messages into the staff inbox attributed
-- to a real patient.
--
-- ---------------------------------------------------------------------------
-- Why its own table rather than a column on `accounts`
-- ---------------------------------------------------------------------------
--
-- `accounts` already holds stripe_secret_key, stripe_webhook_secret,
-- whatsapp_access_token and practicehub_api_key, and its RLS lets any member
-- of the account SELECT and UPDATE the row. RLS is row-level, so every staff
-- member -- any role, no permission check -- can read the live Stripe secret
-- key through the REST API. That is a separate finding with its own fix
-- pending; the point here is not to add a fifth secret to the same pile.
--
-- A column-level grant cannot fix it in place either: in Postgres a
-- table-level SELECT grant dominates a column-level revoke, so hiding one
-- column means revoking SELECT on the whole table and re-granting every other
-- column by name -- which then silently withholds any column added later.
--
-- So: a separate table, RLS on, no policies, and no grants to anon or
-- authenticated. Deny-all to everyone except service_role, which is what
-- reads it. Staff set it through /api/whatsapp/app-secret, which is
-- permission-gated and never returns the value back. This is the shape the
-- other four secrets should eventually move to.
create table whatsapp_app_secrets (
  account_id uuid primary key references accounts(id) on delete cascade,
  app_secret text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table whatsapp_app_secrets enable row level security;

-- Deliberately no policies. RLS enabled with none is deny-all for every role
-- except service_role, which bypasses RLS; the revoke makes that explicit
-- instead of leaving it to Supabase's default grants, which hand `anon`
-- SELECT on new public-schema tables.
revoke all on whatsapp_app_secrets from anon, authenticated;
