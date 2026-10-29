-- Google reviews in Growth > Reputation, imported from the clinic's Google
-- Business Profile and answered from there.
--
-- The reviews themselves go into the `reviews` table that has been waiting
-- for them since 20260914110609_growth_reputation.sql (platform 'google',
-- the review's own id in external_id). What is new is which Business
-- Profile location is the clinic's, and when it was last read.
--
-- Written only by the server routes under /api/google-business, as the
-- service role, so accounts_settings_permission needs no entry for them:
-- the guard lets the service role through, and a column it does not list
-- needs an owner, which is the right answer for anybody writing these by
-- hand through the REST API. The OAuth token is not here at all: it lives
-- in account_secrets as google_business_refresh_token.
alter table public.accounts
  -- "accounts/123": the Business Profile account the location belongs to.
  -- The reviews API (v4) addresses a location through it.
  add column if not exists google_business_account text,
  -- "locations/456": the clinic's listing.
  add column if not exists google_business_location text,
  -- Its name as Google shows it, so Reputation can say which listing it reads.
  add column if not exists google_business_location_title text,
  add column if not exists google_reviews_synced_at timestamptz;
