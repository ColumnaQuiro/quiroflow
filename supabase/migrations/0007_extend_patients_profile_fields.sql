-- Replaces the single `phone` scalar with patient_contact_numbers (multi,
-- with country code + WhatsApp flag), and adds the rest of the patient
-- profile fields: occupation, emergency contact, referral source,
-- preferred language, default practitioner, and communication channel
-- preferences (SMS/email/WhatsApp/none/other).

alter table patients drop column if exists phone;

alter table patients
  add column occupation text,
  add column emergency_contact text,
  add column referral_source text,
  add column preferred_language text not null default 'es',
  add column default_practitioner_id uuid references team_members(id) on delete set null,
  add column invoice_email_enabled boolean not null default false,
  add column reminder_channel text not null default 'sms'
    check (reminder_channel in ('sms', 'email', 'whatsapp', 'none')),
  add column confirmation_channel text not null default 'sms'
    check (confirmation_channel in ('sms', 'email', 'whatsapp', 'none')),
  add column marketing_channels text[] not null default '{}';
