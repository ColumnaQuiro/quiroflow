-- A bono in Google Wallet too (server/utils/googleWallet.ts), beside Apple's
-- (20261018062028_wallet_passes.sql). Google keeps the pass on its own
-- servers and syncs it to the phone, so there is no device registration and
-- no push: we edit the object and Google does the rest. All the row needs is
-- whether the bono is in Google Wallet at all, and when we last sent it.
--
-- Null: never added to Google Wallet. Otherwise the 15-minute cron sends the
-- object again whenever updated_at -- the same "what the pass shows changed"
-- triggers Apple's push reads -- is past it.
alter table public.wallet_passes add column if not exists google_synced_at timestamptz;
