-- Five indexes the Supabase performance advisor listed as unused on 17 Oct
-- 2026, with zero scans since the statistics were reset on 24 Jul 2026.
--
-- The advisor listed 92. An index can be unused and still be required, so
-- each one was checked against four conditions and is dropped only when it
-- passes all of them: it is not unique or a primary key; it is not the only
-- index covering a foreign-key column (dropping that would hand the column
-- straight back to the unindexed-foreign-keys list, and make every parent
-- delete scan the table); its table sees real traffic, so "unused" means
-- something; and no migration created it within the last three weeks, when
-- it simply has not had time to be used. 87 fail at least one of those and
-- stay -- most of them because they are the only index on a foreign key, and
-- many of those sit on tables that are still empty.
--
-- The five that pass:
--
-- * patient_app_messages_account_id_idx (account_id) is a prefix of
--   patient_app_messages_account_created_idx (account_id, created_at desc),
--   which covers the foreign key and everything else the single column could.
-- * payment_methods_account_id_idx (account_id) is a prefix of the unique
--   payment_methods_account_key_uniq (account_id, key). Same reasoning.
-- * support_conversations_admin_queue_idx (admin_unread, last_message_at)
--   backs no query: admin_unread is written by support/message.post.ts and
--   read by nothing, in the app or in any SQL function.
-- * leads_account_phone_idx and leads_account_email_idx were created for
--   "is this person already a lead?" on an inbound message. That lookup is
--   not an equality on the column: findLeadIdByPhone loads the account's
--   newest 500 leads (served by leads_account_created_idx) and matches the
--   digits in JS, because a number typed at the desk and one Meta sends back
--   do not compare equal as text. Nothing selects leads by email. Both were
--   partial, so neither covered the accounts foreign key; the unique
--   leads_account_reference_idx does.

drop index if exists public.patient_app_messages_account_id_idx;
drop index if exists public.payment_methods_account_id_idx;
drop index if exists public.support_conversations_admin_queue_idx;
drop index if exists public.leads_account_phone_idx;
drop index if exists public.leads_account_email_idx;
