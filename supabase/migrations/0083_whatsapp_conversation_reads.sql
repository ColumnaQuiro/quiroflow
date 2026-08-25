-- Tracks when staff last opened each WhatsApp conversation, so the Inbox's
-- unread indicator actually clears on open instead of just reflecting
-- "most recent message is inbound" forever (the bug: it never went away
-- even after reading the thread, because nothing recorded that it had been
-- read). Shared per-account, not per-team-member -- this is a small-team
-- shared inbox, same as the rest of the account's data; once anyone on the
-- team opens a conversation it's read for the team, matching how the
-- existing conversation list/thread views already work (no per-user
-- filtering anywhere else in the Inbox).
create table whatsapp_conversation_reads (
  account_id uuid not null references accounts(id) on delete cascade,
  -- Matches the client's conversation grouping key exactly: a patient's id
  -- when the message is linked to one, otherwise the raw phone number.
  conversation_key text not null,
  last_read_at timestamptz not null default now(),
  primary key (account_id, conversation_key)
);

alter table whatsapp_conversation_reads enable row level security;

create policy "staff manage whatsapp_conversation_reads" on whatsapp_conversation_reads
  for all using (is_account_member(account_id)) with check (is_account_member(account_id));
