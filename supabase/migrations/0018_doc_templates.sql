-- Reusable document templates (per account) with {{field}} placeholders,
-- so staff write something once (e.g. a data-protection consent form)
-- and generate a filled-in copy for each patient instead of retyping it.

create table doc_templates (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  title text not null default 'Untitled template',
  content jsonb not null default '{}'::jsonb,
  created_by uuid references team_members(id) on delete set null,
  updated_by uuid references team_members(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index doc_templates_account_idx on doc_templates (account_id, updated_at desc);

alter table doc_templates enable row level security;
create policy "staff manage doc_templates" on doc_templates
  for all using (is_account_member(account_id)) with check (is_account_member(account_id));
