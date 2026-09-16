-- Instagram DMs, in the same Inbox as everything else.
--
-- The table is called whatsapp_messages and holds a `channel` column that
-- has only ever been allowed one value. That is the shape of something built
-- for one channel and left ready for more: direction, status, body_preview,
-- media and threading are all channel-agnostic already, and the Inbox row
-- even renders the channel as a chip.
--
-- Not renamed to `messages`. The rename is right eventually, but it touches
-- every query, task and spec in the app, and doing it in the same change that
-- adds a channel would make both impossible to review. The name is wrong for
-- a while; the data is not.

alter table whatsapp_messages drop constraint if exists whatsapp_messages_channel_check;
alter table whatsapp_messages add constraint whatsapp_messages_channel_check
  check (channel in ('whatsapp', 'instagram'));

-- Who the message is with, when that is not a phone number.
--
-- Threads are keyed `patient_id ?? phone_number ?? 'unknown'`. An Instagram
-- sender has no phone, so without this every Instagram conversation in the
-- clinic collapses into one thread called "unknown" -- all of them, from
-- different people, interleaved. That is the actual blocker to putting the
-- channel in this Inbox at all.
--
-- Instagram calls it an IGSID: stable per (person, Instagram account), and
-- deliberately not a username, which people change.
alter table whatsapp_messages add column external_contact_id text;

comment on column whatsapp_messages.external_contact_id is
  'Who the conversation is with on a channel that has no phone number -- an Instagram IGSID. Threading falls back to this, so messages from different people do not collapse into one thread.';

create index whatsapp_messages_external_contact_idx
  on whatsapp_messages (account_id, external_contact_id, created_at desc)
  where external_contact_id is not null;

-- The Instagram account to receive as and send as.
--
-- Same shape as the WhatsApp credentials already on this table: pasted in
-- settings rather than obtained through OAuth, because that is what a single
-- clinic connecting its own account needs and it is the pattern this app
-- already asks people to follow. The webhook signature is verified with the
-- Meta App Secret in whatsapp_app_secrets -- one app, one secret, both
-- channels -- so nothing new is needed for that.
alter table accounts
  add column instagram_user_id text,
  add column instagram_access_token text;

comment on column accounts.instagram_user_id is
  'The clinic''s Instagram professional account id. Messages addressed to it are accepted; replies are sent as it.';

comment on column accounts.instagram_access_token is
  'Page access token with instagram_manage_messages. Null means Instagram is not connected, which Settings > WhatsApp states.';
