-- A WhatsApp reaction shown on the message it reacts to, as WhatsApp itself
-- shows it, rather than as a message of its own.
--
-- The webhook used to store "Ha reaccionado con 👍" as a new inbound row and
-- drop which message it was about (reaction.message_id), so the Inbox drew a
-- bubble that said a reaction happened but not to what. Now the reaction is
-- written onto the reacted-to row (matched on its wamid): a new emoji
-- replaces the old one and an empty one -- the patient taking it back --
-- clears it, exactly as on the patient's phone. A reaction to a message
-- QuiroFlow does not have still falls back to the old line, so nothing is
-- lost (utils/whatsappInbound.ts, server/api/whatsapp/webhook.post.ts).
--
-- Only the contact's reaction: the clinic does not react from QuiroFlow.
-- No new table, no patient_id.
alter table public.whatsapp_messages add column if not exists contact_reaction text;
comment on column public.whatsapp_messages.contact_reaction is
  'The emoji the patient or lead reacted to this message with on WhatsApp; null when none, or taken back.';
