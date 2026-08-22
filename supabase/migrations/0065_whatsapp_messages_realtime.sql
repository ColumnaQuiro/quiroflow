-- The Inbox subscribes to whatsapp_messages inserts/updates for live
-- delivery of new messages and status changes -- Supabase Realtime only
-- streams tables explicitly added to this publication.
alter publication supabase_realtime add table whatsapp_messages;
