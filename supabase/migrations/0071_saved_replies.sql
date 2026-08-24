-- Shared, account-wide library of pre-written WhatsApp replies practitioners
-- can insert into the Inbox composer instead of retyping common answers.
-- Modeled on doc_templates (0018_doc_templates.sql), but read access only
-- requires inbox_access (not communication_config) since any practitioner
-- who can use the Inbox should be able to use these -- only managing the
-- library itself needs communication_config.

create table saved_replies (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  title text not null default 'Untitled reply',
  body text not null default '',
  created_by uuid references team_members(id) on delete set null,
  updated_by uuid references team_members(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index saved_replies_account_idx on saved_replies (account_id, title);

alter table saved_replies enable row level security;

create policy "staff view saved_replies" on saved_replies
  for select using (is_account_member(account_id) and has_permission(account_id, 'inbox_access'));

create policy "staff insert saved_replies" on saved_replies
  for insert with check (is_account_member(account_id) and has_permission(account_id, 'communication_config'));

create policy "staff update saved_replies" on saved_replies
  for update using (is_account_member(account_id) and has_permission(account_id, 'communication_config'))
  with check (is_account_member(account_id) and has_permission(account_id, 'communication_config'));

create policy "staff delete saved_replies" on saved_replies
  for delete using (is_account_member(account_id) and has_permission(account_id, 'communication_config'));
