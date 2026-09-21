-- One WhatsApp number belongs to one clinic. Nothing enforced that, and the
-- failure it allowed is the quietest kind there is.
--
-- server/api/whatsapp/webhook.post.ts finds the clinic by
--
--   .eq('whatsapp_phone_number_id', phoneNumberId).maybeSingle()
--
-- and maybeSingle() returns NULL when more than one row matches -- not an
-- error, not the first row. So the handler takes its `if (!account) continue`
-- branch and drops every inbound message for that number, for BOTH accounts,
-- while each one's Settings > WhatsApp page still shows its configuration as
-- correct. There is no symptom anywhere: no failed request, no error, no
-- unread badge that never arrives being attributable to anything.
--
-- It was a latent hazard while phone number ids were pasted in by hand (the
-- comment at the top of cypress/e2e/inbox/whatsapp-reply-intent.cy.ts has
-- worked around it since, by seeding a fresh id per test). It became
-- reachable on 2026-09-21, when QuiroFlow became a WhatsApp Tech Provider:
-- /api/meta/connect/callback writes whatever phone number id the granted WABA
-- carries onto whichever account is signed in, so a second clinic connecting
-- to a WABA another one already uses produces exactly this collision through
-- the UI, with no hand-editing involved.
--
-- Partial, because NULL is the normal state -- most accounts have never
-- connected WhatsApp, and a unique index over NULLs would be fine in Postgres
-- but the partial form says outright that unconnected accounts are not in
-- scope and keeps the index to the handful of rows that are.
--
-- Verified clean against production before writing this: two accounts hold a
-- phone number id and the two ids differ, so the index builds.
create unique index if not exists accounts_whatsapp_phone_number_id_key
  on public.accounts (whatsapp_phone_number_id)
  where whatsapp_phone_number_id is not null;

comment on index public.accounts_whatsapp_phone_number_id_key is
  'A WhatsApp phone number id routes inbound messages to exactly one account. Two accounts sharing one silently drops inbound for both -- see this index''s migration.';
