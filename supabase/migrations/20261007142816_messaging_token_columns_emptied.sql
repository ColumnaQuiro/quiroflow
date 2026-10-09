-- Second half of 20260930100540 (#517): the WhatsApp, Instagram and Meta Ads
-- access tokens live in account_secrets, and the code reading them there has
-- been released since v1.55.0 (every reader overlays them with
-- withMessagingTokens). Emptying the columns every member of the clinic can
-- read closes the exposure.
--
-- Copied again first, in case one was re-saved through an old page since. On
-- 7 Oct 2026 every value still in a column had an identical secret, so this
-- copy changes nothing there.
--
-- The PracticeHub key is deliberately left on accounts for now.
insert into public.account_secrets (account_id, name, value)
select id, 'whatsapp_access_token', whatsapp_access_token from public.accounts where whatsapp_access_token is not null
union all
select id, 'instagram_access_token', instagram_access_token from public.accounts where instagram_access_token is not null
union all
select id, 'meta_ads_access_token', meta_ads_access_token from public.accounts where meta_ads_access_token is not null
on conflict (account_id, name) do update set value = excluded.value, updated_at = now();

update public.accounts
set whatsapp_access_token = null, instagram_access_token = null, meta_ads_access_token = null
where whatsapp_access_token is not null or instagram_access_token is not null or meta_ads_access_token is not null;
