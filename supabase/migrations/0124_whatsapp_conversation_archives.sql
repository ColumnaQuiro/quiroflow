-- Per-user archive: hides a conversation from one staff member's inbox view
-- without affecting anyone else's -- same "private per team member"
-- reasoning as whatsapp_conversation_labels (0123), and the same deliberate
-- departure from whatsapp_conversation_reads' (0083) shared-by-design
-- model. A row's mere existence means "archived by this team member" --
-- there's no status column because there's nothing else to store;
-- un-archiving is just deleting the row. A new inbound message does NOT
-- auto-unarchive (archived means "done with this for now", matching
-- Gmail/WhatsApp convention, not "hide until the next event") -- the
-- unread dot must still be visible from the archived view so a new message
-- never goes unnoticed there.
create table whatsapp_conversation_archives (
  account_id uuid not null references accounts(id) on delete cascade,
  team_member_id uuid not null references team_members(id) on delete cascade,
  conversation_key text not null,
  archived_at timestamptz not null default now(),
  primary key (team_member_id, conversation_key)
);

create index whatsapp_conversation_archives_lookup_idx
  on whatsapp_conversation_archives (account_id, team_member_id);

alter table whatsapp_conversation_archives enable row level security;

create policy "staff manage own whatsapp_conversation_archives" on whatsapp_conversation_archives
  for all using (
    is_account_member(account_id)
    and has_permission(account_id, 'inbox_access')
    and team_member_id = current_team_member_id(account_id)
  )
  with check (
    is_account_member(account_id)
    and has_permission(account_id, 'inbox_access')
    and team_member_id = current_team_member_id(account_id)
  );
