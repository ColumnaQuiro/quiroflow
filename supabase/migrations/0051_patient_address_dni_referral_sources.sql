alter table patients add column address text;
alter table patients add column national_id text;

-- A configurable list (Facebook, Instagram, Organic, ...) so
-- patients.referral_source is picked from a dropdown instead of freeform
-- text, and so referral performance can be reported on consistently.
create table referral_sources (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  unique (account_id, name)
);

alter table referral_sources enable row level security;

create policy "staff select referral sources"
on referral_sources for select
using (is_account_member(account_id));

create policy "staff manage referral sources"
on referral_sources for all
using (is_account_member(account_id) and has_permission(account_id, 'settings_access'))
with check (is_account_member(account_id) and has_permission(account_id, 'settings_access'));
