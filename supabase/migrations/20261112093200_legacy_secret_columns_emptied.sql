-- The follow-up 20260913113238_account_secrets and
-- 20260930080701_accounts_settings_need_their_permission both promised and
-- neither got: the Stripe and PracticeHub secrets copied into account_secrets
-- are emptied from accounts, where "staff can view their account" lets every
-- member read every column. Until now a receptionist could still run
--
--   GET /rest/v1/accounts?select=practicehub_api_key
--
-- and get the key that reads the clinic's whole PracticeHub history -- the
-- same exposure 20261007142816 closed for the messaging tokens.
--
-- Copied again first, so nothing is lost: a value saved since those
-- migrations went into account_secrets already (setAccountSecret writes
-- there and clears the column), so an existing row is the newer one and is
-- kept. Every release since 20260930080701 reads account_secrets first and
-- the column only as a fallback, so the code live when this applies keeps
-- working.
insert into public.account_secrets (account_id, name, value)
select id, 'stripe_secret_key', stripe_secret_key from public.accounts where coalesce(stripe_secret_key, '') <> ''
union all
select id, 'stripe_webhook_secret', stripe_webhook_secret from public.accounts where coalesce(stripe_webhook_secret, '') <> ''
union all
select id, 'practicehub_api_key', practicehub_api_key from public.accounts where coalesce(practicehub_api_key, '') <> ''
on conflict (account_id, name) do nothing;

-- The guard triggers stand aside for this: auth.uid() is null here.
update public.accounts
set stripe_secret_key = null,
    stripe_webhook_secret = null,
    practicehub_api_key = null
where stripe_secret_key is not null
   or stripe_webhook_secret is not null
   or practicehub_api_key is not null;
