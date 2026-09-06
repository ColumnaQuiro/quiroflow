-- Support threads between a clinic and the QuiroFlow team, behind the in-app
-- help widget: the assistant answers from the help centre first, and when it
-- can't, the question becomes one of these for a real person to answer from
-- the admin panel (quiroflow-admin).
--
-- Deliberately its own pair of tables rather than anything reusing the
-- whatsapp_* inbox: that inbox is a clinic talking to *its patients* and is
-- scoped by patient_id, while this is a clinic talking to *us*. Sharing the
-- shape would mean every RLS policy and every inbox query had to start
-- distinguishing the two audiences.
create table if not exists support_conversations (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  -- Who asked, for the admin panel's benefit. Nullable and null-on-delete:
  -- a thread outlives the team member who opened it.
  opened_by_team_member_id uuid references team_members(id) on delete set null,
  subject text not null,
  status text not null default 'open' check (status in ('open', 'answered', 'closed')),
  -- Which side has something new to look at. Two flags rather than one
  -- "unread" so a reply from either side doesn't clear the other's badge.
  clinic_unread boolean not null default false,
  admin_unread boolean not null default true,
  created_at timestamptz not null default now(),
  last_message_at timestamptz not null default now()
);

create table if not exists support_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references support_conversations(id) on delete cascade,
  -- Denormalized from the conversation purely so RLS can check a clinic's
  -- access without a join on every row read.
  account_id uuid not null references accounts(id) on delete cascade,
  direction text not null check (direction in ('from_clinic', 'from_support')),
  body text not null,
  author_team_member_id uuid references team_members(id) on delete set null,
  -- For 'from_support' only: which of us replied. An email rather than a
  -- foreign key because admins are an ADMIN_ALLOWED_EMAILS allowlist in the
  -- admin panel, not rows in any table here.
  author_email text,
  created_at timestamptz not null default now()
);

create index if not exists support_conversations_account_idx on support_conversations (account_id, last_message_at desc);
-- The admin panel's queue: everything still needing an answer, newest first.
create index if not exists support_conversations_admin_queue_idx on support_conversations (admin_unread, last_message_at desc);
create index if not exists support_messages_conversation_idx on support_messages (conversation_id, created_at);

alter table support_conversations enable row level security;
alter table support_messages enable row level security;

-- Clinic side: staff see and start threads for their own account, nothing
-- else. The admin panel reads across all accounts with a service-role client
-- (gated on its own email allowlist -- see quiroflow-admin's
-- server/utils/adminAuth.ts), which bypasses RLS entirely, so there is
-- deliberately no cross-account policy here to get wrong.
create policy "staff read own support_conversations" on support_conversations
  for select using (is_account_member(account_id));

create policy "staff open support_conversations" on support_conversations
  for insert with check (is_account_member(account_id));

-- Clearing the clinic's own unread badge is the only update they need. RLS
-- can only say *which rows* may be updated, never which columns -- so the
-- column list is enforced with a grant instead. Without it this policy would
-- also let a clinic set admin_unread = false or status = 'closed' on its own
-- thread, i.e. quietly remove itself from our support queue while still
-- waiting on an answer.
create policy "staff mark own support_conversations read" on support_conversations
  for update using (is_account_member(account_id))
  with check (is_account_member(account_id));

revoke update on support_conversations from authenticated;
grant update (clinic_unread) on support_conversations to authenticated;

create policy "staff read own support_messages" on support_messages
  for select using (is_account_member(account_id));

-- Only ever their own side of the conversation: without the direction check
-- a clinic could write a 'from_support' message and appear to have been
-- answered by us.
create policy "staff write own support_messages" on support_messages
  for insert with check (is_account_member(account_id) and direction = 'from_clinic');
