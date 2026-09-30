-- The WhatsApp, Instagram and Meta Ads access tokens move to account_secrets,
-- beside the Stripe and PracticeHub keys. On accounts, every member of the
-- clinic could read them through the REST API -- and Settings > WhatsApp
-- loaded the Instagram and Meta Ads ones into the page in plain text. The
-- WhatsApp token sends messages as the clinic.
--
-- Copied, not moved: the code live until the next release reads the columns
-- (appointment reminders, lead alerts, the Inbox). The released code reads
-- account_secrets first (withMessagingTokens) and falls back to the column,
-- and a follow-up migration empties the columns once it is live.
insert into public.account_secrets (account_id, name, value)
select id, 'whatsapp_access_token', whatsapp_access_token from public.accounts where whatsapp_access_token is not null
union all
select id, 'instagram_access_token', instagram_access_token from public.accounts where instagram_access_token is not null
union all
select id, 'meta_ads_access_token', meta_ads_access_token from public.accounts where meta_ads_access_token is not null
on conflict (account_id, name) do update set value = excluded.value, updated_at = now();
