-- Who has applied which label to which conversation is PRIVATE per staff
-- member, unlike whatsapp_conversation_reads (0083) which is deliberately
-- shared account-wide ("no per-user filtering anywhere in the Inbox", per
-- that migration's own comment). This is the first genuinely per-user table
-- in the Inbox area: one practitioner's own triage labeling shouldn't force
-- itself onto a colleague's view of the same shared conversation, and one
-- person's labeling scheme (e.g. "Follow up Monday") is meaningless noise
-- to anyone else's workflow. The label *definitions* in whatsapp_labels
-- stay shared so the whole team draws from one consistent color/name
-- vocabulary instead of each person inventing their own -- this table only
-- records the individual act of applying one.
create table whatsapp_conversation_labels (
  account_id uuid not null references accounts(id) on delete cascade,
  team_member_id uuid not null references team_members(id) on delete cascade,
  conversation_key text not null,
  label_id uuid not null references whatsapp_labels(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (team_member_id, conversation_key, label_id)
);

create index whatsapp_conversation_labels_lookup_idx
  on whatsapp_conversation_labels (account_id, team_member_id, conversation_key);

alter table whatsapp_conversation_labels enable row level security;

-- Scoped to the caller's own team_member_id on every clause (not just
-- is_account_member) -- this is what actually makes assignment private: a
-- teammate can never see or delete another teammate's label assignments,
-- even though they can all see and reuse the same whatsapp_labels rows.
-- Deleting a whatsapp_labels row cascades here too, silently removing it
-- from everyone's conversations who'd applied it -- the web label manager
-- should warn about that before a delete.
create policy "staff manage own whatsapp_conversation_labels" on whatsapp_conversation_labels
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
