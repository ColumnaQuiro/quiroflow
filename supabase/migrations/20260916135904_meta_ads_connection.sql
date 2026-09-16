-- Where a clinic's Meta ad spend is read from.
--
-- channel_spend has allowed source = 'meta_ads' since it was created, next to
-- 'manual' and 'google_ads'. Only 'manual' has ever been written: the comment
-- on channel-spend.put.ts says importing "needs an OAuth integration per
-- platform that does not exist yet", so an owner types what they spent and
-- three dashboard numbers -- cost per lead, cost per new patient, ROAS --
-- come back.
--
-- Typing it once a month is not much work, but it is work that gets skipped,
-- and skipped means those three numbers quietly go missing rather than going
-- wrong. Reading them is better.
--
-- A pasted token rather than OAuth, deliberately. Meta's ads_read requires
-- App Review for an integration that serves other people's ad accounts --
-- days of waiting -- while a clinic reading its OWN account needs nothing but
-- a token it can generate today. It is also the pattern this app already asks
-- for one screen over: whatsapp_access_token is pasted the same way, for the
-- same reason.

alter table accounts
  add column meta_ads_account_id text,
  add column meta_ads_access_token text;

comment on column accounts.meta_ads_account_id is
  'Meta ad account id (act_… without the prefix). Null means ad spend is not connected and stays hand-entered.';

comment on column accounts.meta_ads_access_token is
  'Long-lived token with ads_read for that ad account. Reading only -- nothing in this app writes to Meta Ads.';
