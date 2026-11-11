-- WhatsApp "Coexistence": a clinic connects the number it already uses in the
-- WhatsApp Business app, and keeps using the app. Meta's Embedded Signup
-- converts the number so the Cloud API can send and receive on it while the
-- phone carries on as before, instead of the number leaving the app for good.
--
-- Two things follow from that, and each needs somewhere to live.

-- 1. Whether this clinic's number is shared with the app, and since when.
--    Null for a number that is API-only (connected the standard way, or by
--    hand). Written by /api/meta/connect/callback with the service role, from
--    Meta's own answer (is_on_biz_app) rather than from what the browser
--    asked for; nobody edits it in Settings, so accounts_settings_permission
--    does not list it and only an owner could change it through the API.
alter table public.accounts
  add column whatsapp_business_app_since timestamptz;

comment on column public.accounts.whatsapp_business_app_since is
  'When this clinic''s WhatsApp number was connected while staying on the WhatsApp Business app (Meta Coexistence). Null when the number is API-only.';

-- 2. Where a message came from, when it was not QuiroFlow.
--
--    'business_app' -- sent by the clinic from the WhatsApp Business app on
--      the phone, and reported to us by Meta's smb_message_echoes webhook.
--      Stored as an ordinary outbound message by a person, so the Inbox shows
--      both halves of the conversation and the receptionist sees that
--      somebody answered (it does not draft after the clinic's own reply).
--    'history' -- imported from the 180 days of chats Meta shares once, on
--      onboarding. Never acted on: no push, no automation, no receptionist.
--
--    Null for everything QuiroFlow sent or received itself, which is every
--    row that exists today.
alter table public.whatsapp_messages
  add column origin text
  constraint whatsapp_messages_origin_check check (origin is null or origin in ('business_app', 'history'));

comment on column public.whatsapp_messages.origin is
  'Null for messages QuiroFlow sent or received. business_app = sent from the WhatsApp Business app (Coexistence echo); history = imported chat history.';
