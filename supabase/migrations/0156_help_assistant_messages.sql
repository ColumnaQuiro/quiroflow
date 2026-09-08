-- Persists the in-app help widget's "Assistant" tab (server/api/support/
-- ask.post.ts), which until now only lived in a component-local ref: closing
-- the widget was fine (it stays mounted across navigation), but a page
-- reload or re-login silently wiped the whole conversation.
--
-- Scoped per team member, not per account: unlike support_conversations
-- (the "QuiroFlow team" escalation tab, deliberately shared across a
-- clinic's staff -- see that table's own comment), asking the assistant "how
-- do I do X" is a private question-and-answer log, not a thread with anyone
-- else. Two colleagues opening the widget should each see their own history,
-- not a merged one.
create table if not exists help_assistant_messages (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  team_member_id uuid not null references team_members(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  body text not null,
  -- Populated on assistant rows only: help-centre article URLs the answer
  -- cited, and whether that answer admitted it couldn't help (offers the
  -- "Ask a real person" button when reloaded, same as it did live).
  sources text[],
  offer_human boolean not null default false,
  created_at timestamptz not null default now()
);

create index help_assistant_messages_team_member_idx on help_assistant_messages (team_member_id, created_at);

alter table help_assistant_messages enable row level security;

create policy "staff read own help_assistant_messages" on help_assistant_messages
  for select using (team_member_id in (select id from team_members where user_id = auth.uid()));

-- account_id is denormalized from team_members purely so every other query
-- here doesn't need a join to scope by account -- checked against the
-- caller's own team_members row so it can't be spoofed to file a message
-- under a different account than the one they actually belong to.
create policy "staff write own help_assistant_messages" on help_assistant_messages
  for insert with check (
    team_member_id in (select id from team_members where user_id = auth.uid())
    and account_id = (select account_id from team_members where id = team_member_id)
  );
