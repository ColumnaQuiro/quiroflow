-- Stripe Connect: a clinic authorizes via OAuth instead of pasting API keys,
-- and every connected account's events land on one platform-level webhook
-- instead of a per-clinic one. Existing stripe_secret_key/stripe_webhook_secret
-- columns are left in place for accounts that haven't (re)connected yet --
-- server/utils/stripe.ts falls back to them when stripe_connect_account_id
-- is null.

alter table accounts add column stripe_connect_account_id text;
