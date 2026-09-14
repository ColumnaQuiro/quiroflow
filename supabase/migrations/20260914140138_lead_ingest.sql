-- What a lead needs before an ad platform can post one in.
--
-- Two additions, both about the same thing: the sender is a webhook, and a
-- webhook is not a person clicking Save once.

-- 1. external_id
--
-- Meta redelivers a leadgen webhook when it does not get a clean 200 -- on a
-- timeout, on a deploy, on its own retry schedule -- and the redelivery is
-- byte-identical. Without a key to recognise it by, the same person becomes
-- two leads, gets two welcome messages, and is counted twice in the funnel
-- the tier is sold on.
--
-- Same shape as reviews.external_id: the platform's own id, unique per
-- account and per source, null for a lead entered by hand.
alter table leads add column external_id text;
alter table leads add column external_source text;

create unique index leads_account_external_idx
  on leads (account_id, external_source, external_id)
  where external_id is not null;

-- 2. 'facebook' as a channel
--
-- A Meta lead-ad form is not 'web' and not 'instagram'. Folding it into
-- either would misreport the dashboard's channel table, which is one of the
-- few screens a clinic owner reads to decide where the next euro goes --
-- the one place a tidy-looking approximation does real damage.
alter table leads drop constraint leads_channel_check;
alter table leads add constraint leads_channel_check
  check (channel in ('whatsapp', 'sms', 'phone', 'web', 'instagram', 'facebook', 'walk_in'));
