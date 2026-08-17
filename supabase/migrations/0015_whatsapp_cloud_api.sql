-- Switch from webhook-based WhatsApp sending to a direct integration with
-- Meta's WhatsApp Business Cloud API. Free-form message templates don't
-- apply anymore -- Meta only allows pre-approved template messages for
-- business-initiated contact (recalls, confirmations), filled in via
-- numbered {{1}}, {{2}}... variable slots, so the old text-template
-- columns are no longer meaningful.

alter table accounts drop column whatsapp_webhook_url;
alter table accounts drop column recall_whatsapp_template;
alter table accounts drop column confirmation_whatsapp_template;

alter table accounts add column whatsapp_phone_number_id text;
alter table accounts add column whatsapp_business_account_id text;
alter table accounts add column whatsapp_access_token text;
alter table accounts add column whatsapp_confirmation_template_name text;
alter table accounts add column whatsapp_confirmation_template_language text not null default 'es';
