-- The staff "new online booking" WhatsApp ping (0108_online_booking_notifications.sql)
-- only ever sent free-form text, which WhatsApp silently drops once the
-- notify number hasn't messaged the clinic's business number in 24h. An
-- optional approved template lets it send outside that window too, same as
-- the patient-facing confirmation/reminder templates already do.
alter table accounts add column online_booking_notify_whatsapp_template_name text;
alter table accounts add column online_booking_notify_whatsapp_template_language text not null default 'es';
