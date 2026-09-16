-- Tell the clinic when a lead comes in.
--
-- n8n has been posting every Facebook lead to Slack since December, and that
-- Slack post is the only thing that makes a new enquiry interrupt somebody's
-- day. Retiring n8n takes it away, and a lead nobody notices for four hours
-- is the specific failure this whole tier exists to prevent -- the leads
-- board shows them, but only to whoever happens to be looking at it.
--
-- Not a Slack integration. That would mean an OAuth app, a token per
-- account and a channel picker, all so one clinic can keep the notification
-- shape it happens to have today. Email and WhatsApp already reach them,
-- already have credentials, and work for every account rather than the ones
-- on Slack.
--
-- Deliberately the same four columns, with the same names and the same
-- meanings, as online_booking_notify_* (0143). It is the same problem --
-- "something arrived, tell a human" -- and notifyStaffOfOnlineBooking is the
-- code this is modelled on, so a reader who knows one knows the other.

alter table accounts
  add column new_lead_notify_email text,
  add column new_lead_notify_whatsapp text,
  add column new_lead_notify_whatsapp_template_name text,
  add column new_lead_notify_whatsapp_template_language text;

comment on column accounts.new_lead_notify_email is
  'Where to email the clinic when a lead arrives. Null disables it.';

comment on column accounts.new_lead_notify_whatsapp is
  'Where to WhatsApp the clinic when a lead arrives. Null disables it.';

-- Why a template is offered at all, rather than just sending text: WhatsApp
-- only allows free-form messages within 24h of that number last messaging
-- the business number. A clinic that does not message itself daily would
-- get nothing, silently, and would have no way to tell that from "no leads".
-- Same reasoning as online_booking_notify_whatsapp_template_name.
comment on column accounts.new_lead_notify_whatsapp_template_name is
  'Optional approved template for the WhatsApp notification, so it delivers outside the 24h free-form window.';
