-- The PracticeHub importers (Payments, Packages/Bonos, ...) each require the
-- clinic's PracticeHub URL + API key to be re-typed by hand every time,
-- since the in-memory usePracticeHubConnection() composable is cleared on
-- every page reload. Saving it once on the account, the same way the
-- WhatsApp Cloud API credentials already live on accounts.whatsapp_access_token
-- (0015_whatsapp_cloud_api.sql), lets every importer tab auto-connect
-- instead of asking again.
alter table accounts add column practicehub_base_url text;
alter table accounts add column practicehub_api_key text;
alter table accounts add column practicehub_contact_email text;
