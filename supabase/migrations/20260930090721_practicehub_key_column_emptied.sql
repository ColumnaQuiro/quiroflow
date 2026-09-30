-- Second half of 20260930080701: the PracticeHub API key now lives in
-- account_secrets, and the code reading it there is released. Emptying the
-- column every member can read closes the exposure.
--
-- Merge only AFTER the release that shipped 20260930080701's code: until
-- then the live lead drip still reads the column, and an empty one would
-- make it treat PracticeHub as not configured.
--
-- Copied again first, in case the key was re-saved through the old page
-- after the first migration ran.
insert into public.account_secrets (account_id, name, value)
select id, 'practicehub_api_key', practicehub_api_key
from public.accounts
where practicehub_api_key is not null
on conflict (account_id, name) do update set value = excluded.value, updated_at = now();

update public.accounts set practicehub_api_key = null where practicehub_api_key is not null;

-- The WhatsApp, Instagram and Meta Ads access tokens, the same way: they moved
-- to account_secrets in 20260930100540 (#517); copied again here in case one
-- was re-saved through the old page since, then emptied.
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
