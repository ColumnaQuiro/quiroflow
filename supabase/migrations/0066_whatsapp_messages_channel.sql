-- Divides inbox messages by channel. Only 'whatsapp' exists today, but the
-- Inbox is meant to also carry native-app messages once that channel exists
-- (see the original Inbox request) -- this column lets that land later
-- without a schema change or a data migration.
alter table whatsapp_messages add column channel text not null default 'whatsapp';
alter table whatsapp_messages add constraint whatsapp_messages_channel_check check (channel in ('whatsapp'));
