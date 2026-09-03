-- Shared, account-wide catalog of label names+colors staff can tag WhatsApp
-- conversations with. Modeled on saved_replies (0071_saved_replies.sql): a
-- lightweight shared library, not a heavyweight admin-only settings object.
-- Mutation (insert/update/delete) is gated only by inbox_access rather than
-- communication_config -- labels are meant to be as frictionless as
-- creating a tag on the fly while triaging (any staff member with inbox
-- access can define "Needs X-ray" without waiting on an admin), whereas
-- saved replies are curated canned-response copy that benefits from being
-- admin-reviewed. If labels turn out to need more governance later (label
-- sprawl), tightening these policies to require communication_config
-- instead is a one-line change per policy.
create table whatsapp_labels (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  name text not null,
  color text not null default '#4C6FEB',
  created_by uuid references team_members(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (account_id, name)
);

create index whatsapp_labels_account_idx on whatsapp_labels (account_id, name);

alter table whatsapp_labels enable row level security;

create policy "staff view whatsapp_labels" on whatsapp_labels
  for select using (is_account_member(account_id) and has_permission(account_id, 'inbox_access'));

create policy "staff insert whatsapp_labels" on whatsapp_labels
  for insert with check (is_account_member(account_id) and has_permission(account_id, 'inbox_access'));

create policy "staff update whatsapp_labels" on whatsapp_labels
  for update using (is_account_member(account_id) and has_permission(account_id, 'inbox_access'))
  with check (is_account_member(account_id) and has_permission(account_id, 'inbox_access'));

create policy "staff delete whatsapp_labels" on whatsapp_labels
  for delete using (is_account_member(account_id) and has_permission(account_id, 'inbox_access'));
