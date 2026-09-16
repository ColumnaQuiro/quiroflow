-- Which Google listing a clinic is, so its reviews can be read.
--
-- The reputation screen has said since it was built that ratings and review
-- text "live inside Google" and that connecting them needs an integration
-- that does not exist. The reviews table was designed for the day it did:
-- platform, external_id and a unique index on (account_id, platform,
-- external_id) are all already there, waiting for something to write rows.
--
-- One column is the whole per-clinic half of it. The API key is the
-- platform's, in runtime config beside the other service keys, because it is
-- QuiroFlow calling Google on every clinic's behalf -- not something a clinic
-- should have to obtain, and not something worth storing once per account.
--
-- Deliberately the Places API rather than the Business Profile API. Places
-- needs only a key and answers today; Business Profile needs per-clinic OAuth
-- AND an access request Google reviews by hand over days. The cost is that
-- Places returns at most five reviews and cannot post a reply -- so this
-- shows a rating and recent reviews, and replying stays where it already is:
-- drafted here, posted by a person on Google. That is the honest version of
-- the feature available now, rather than nothing until an approval lands.

alter table accounts add column google_place_id text;

comment on column accounts.google_place_id is
  'The clinic''s Google Places id, used to read its rating and recent reviews. Null means Google reviews are not connected, which the reputation screen states rather than showing a zero.';
