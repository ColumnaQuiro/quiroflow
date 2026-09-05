-- appointmentNotifications.ts has always passed purpose='reminder' when
-- logging the built-in appointment reminder, but this CHECK only allowed
-- confirmation/recall/other. So that insert failed the constraint every
-- time and -- because supabase-js returns the error rather than throwing,
-- and the call sits inside a Promise.all whose result is discarded -- the
-- message was simply never logged. The WhatsApp still went out; only our
-- record of it was lost, which is why whatsapp_messages had zero rows with
-- purpose='reminder' despite reminders demonstrably being sent.
--
-- Widening the constraint rather than remapping 'reminder' onto an existing
-- value: a reminder is genuinely a distinct purpose from a confirmation, and
-- the inbox and reporting reads on this column should be able to tell them
-- apart. Purely permissive -- no existing row can violate the wider set.
alter table whatsapp_messages drop constraint if exists whatsapp_messages_purpose_check;

alter table whatsapp_messages
  add constraint whatsapp_messages_purpose_check
  check (purpose is null or purpose = any (array['confirmation', 'reminder', 'recall', 'other']));
