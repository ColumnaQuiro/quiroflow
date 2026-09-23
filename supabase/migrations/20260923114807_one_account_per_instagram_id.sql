-- One Instagram account belongs to one clinic -- the same rule, for the same
-- reason, as accounts_whatsapp_phone_number_id_key
-- (20260921091355_one_account_per_whatsapp_number.sql). Instagram was added
-- without it.
--
-- server/utils/instagramWebhook.ts found the clinic for a DM with
--
--   .eq('instagram_user_id', igUserId).maybeSingle()
--
-- and maybeSingle() returns NULL when more than one row matches. So two
-- accounts holding the same Instagram id took the handler's
-- `if (!account) continue` branch and dropped every DM for that Instagram
-- account, for BOTH clinics, with nothing logged -- the exact failure the
-- WhatsApp index was written to close. The id is typed into
-- Settings > WhatsApp by hand, so one clinic pasting another's id (or the
-- same clinic connecting from a second QuiroFlow account) is all it takes.
--
-- It was not hypothetical in the suite: cypress/e2e/inbox/instagram-dms.cy.ts
-- seeded ids that repeated within a second, and the specs that collided
-- failed exactly this way until the ids were made unique.
--
-- Partial, because NULL is the normal state: most accounts have not connected
-- Instagram.
--
-- Verified clean against production before writing this (2026-09-23): one
-- account holds an Instagram id, so the index builds.
create unique index if not exists accounts_instagram_user_id_key
  on public.accounts (instagram_user_id)
  where instagram_user_id is not null;

comment on index public.accounts_instagram_user_id_key is
  'An Instagram account id routes DMs to exactly one account. Two accounts sharing one silently drops DMs for both -- see this index''s migration.';
