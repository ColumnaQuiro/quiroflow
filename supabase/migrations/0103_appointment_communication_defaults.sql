-- Settings for automatic appointment confirmation/reminder sends -- extends
-- the existing whatsapp_confirmation_template_name/whatsapp_recall_template_name
-- pattern with a third (reminder) template pair, plus account-level on/off +
-- channel + timing config surfaced on the new Settings > Communication >
-- General page. confirmation_sent_at/reminder_sent_at on appointments are
-- pure idempotency guards -- distinct from confirmation_status, which
-- reflects the patient's own reply, not whether we've sent anything.
alter table accounts
  add column whatsapp_reminder_template_name text,
  add column whatsapp_reminder_template_language text default 'es',
  add column appointment_confirmation_enabled boolean not null default true,
  add column appointment_confirmation_channels text[] not null default '{whatsapp}',
  add column appointment_reminder_enabled boolean not null default true,
  add column appointment_reminder_channels text[] not null default '{whatsapp}',
  add column appointment_reminder_hours_before int not null default 24,
  add column email_confirmation_subject text,
  add column email_confirmation_body text,
  add column email_reminder_subject text,
  add column email_reminder_body text;

alter table appointments
  add column confirmation_sent_at timestamptz,
  add column reminder_sent_at timestamptz;
