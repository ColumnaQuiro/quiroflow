-- The Google listing's own rating and review count, as the Business Profile
-- API reports them alongside the reviews (averageRating, totalReviewCount).
--
-- Reputation used to average whatever rows had been imported, and the import
-- stopped after a year's worth: Columnaquiro's headline read 30 reviews with
-- an average that was not the one on its listing. Google's figures are the
-- ones a clinic and its patients see, so they are kept as Google reports them.
--
-- Written only by the service role (server/utils/googleBusiness.ts), like the
-- other google_business_* columns from 20261029154928, so
-- accounts_settings_permission needs no entry for them.
alter table public.accounts
  add column if not exists google_rating numeric(2, 1),
  add column if not exists google_review_count integer;
