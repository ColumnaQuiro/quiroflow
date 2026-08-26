-- patient_app_messages was never added to the realtime publication, so
-- postgres_changes subscriptions on it (pages/inbox.vue,
-- PractitionerInbox.vue) never fired -- new in-app messages only ever
-- showed up after a full remount forced a fresh load(). whatsapp_messages
-- is already in the publication.
alter publication supabase_realtime add table patient_app_messages;
