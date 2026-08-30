-- Lets a clinic get pinged (email and/or WhatsApp) whenever a patient books
-- online, instead of relying on an external workflow (e.g. n8n polling/
-- webhooking the inbox) to notice a new booking.
alter table accounts add column online_booking_notify_email text;
alter table accounts add column online_booking_notify_whatsapp text;
