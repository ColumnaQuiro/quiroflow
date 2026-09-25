-- A dry-run email, recorded where real ones are.
--
-- 20260915075939_automation_dry_run.sql promised that a rule in test mode
-- "writes the message it *would* have sent instead of calling Meta". That was
-- only ever true of WhatsApp. runForRecipient passed dryRun to the WhatsApp
-- action and not to the email one, so a test-mode rule with an email step
-- sent a real email through Resend -- to strangers, for a lead drip, which is
-- the exact thing test mode exists to prevent.
--
-- The email path now stops short of Resend under dry run, and records the
-- message here instead, so it shows up in the patient's thread the way a
-- would_send WhatsApp does. Two changes make that row possible:
--
-- * provider_message_id becomes nullable. Nothing was handed to Resend, so
--   there is no Resend id, and a fabricated one would sit in a column whose
--   only purpose is matching webhook events. The check below keeps it
--   required for every real send.
-- * dry_run marks the row, so the campaign metrics (pages/campaigns) can leave
--   it out -- a test run is not a send, and counting it would put emails that
--   never went anywhere into the "sent" figure and the open-rate divisor.
alter table email_messages alter column provider_message_id drop not null;
alter table email_messages add column dry_run boolean not null default false;
alter table email_messages add constraint email_messages_provider_id_unless_dry_run
  check (dry_run or provider_message_id is not null);

comment on column email_messages.dry_run is
  'Recorded by a rule in test mode instead of being sent. No provider id, never delivered; excluded from campaign metrics.';
