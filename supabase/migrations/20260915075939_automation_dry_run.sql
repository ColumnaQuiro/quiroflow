-- A rule that runs without sending.
--
-- The welcome drip is the first automation whose audience is strangers
-- rather than the clinic's own patients, and the first that sends five
-- messages off one trigger. Switching it on is therefore a decision nobody
-- can undo: a wrong template, a wrong variable count or a stop condition
-- that does not fire reaches real people immediately, and the only evidence
-- afterwards is somebody's WhatsApp.
--
-- With dry_run on, the rule does everything it would normally do -- picks the
-- recipient, resolves the template, honours consent, advances the sequence,
-- stops when it should -- and writes the message it *would* have sent
-- instead of calling Meta. A week of that against real leads answers "is
-- this right" with real data and no risk, which no amount of staging does.
alter table automation_rules add column dry_run boolean not null default false;

comment on column automation_rules.dry_run is
  'Run the rule but record messages instead of sending them. The safe way to switch on anything that messages strangers.';

-- 'would_send' joins the message statuses so a dry run is visible in the same
-- place real messages are, rather than a separate log nobody opens. It reads
-- as what it is in the Inbox: this is what would have gone out.
alter table whatsapp_messages drop constraint whatsapp_messages_status_check;
alter table whatsapp_messages add constraint whatsapp_messages_status_check
  check (status in ('sent', 'delivered', 'read', 'failed', 'received', 'would_send'));
