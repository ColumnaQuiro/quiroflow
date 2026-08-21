-- Automations: "when X happens, do Y" rules, mirroring PracticeHub's
-- Connect feature. A rule has one trigger event and an ordered list of
-- actions (WhatsApp template, email, or an ad-hoc webhook). Firing happens
-- from a Nuxt server route (server/api/automations/fire.post.ts), not a
-- Postgres trigger like the existing webhooks system -- WhatsApp/email
-- sending needs secrets (Resend API key, Meta access token) that live in
-- server config/the accounts table, and calling external HTTP APIs with
-- those from a DB trigger would mean duplicating that logic in SQL instead
-- of reusing the Nuxt server code that already does it.
create table automation_rules (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  name text not null default 'Automation',
  trigger_event text not null check (trigger_event in (
    'appointment.checked_in',
    'appointment.booked',
    'appointment.completed',
    'appointment.cancelled',
    'appointment.no_show',
    'invoice.paid'
  )),
  enabled boolean not null default true,
  created_by uuid references team_members(id) on delete set null,
  created_at timestamptz not null default now()
);

create index automation_rules_account_trigger_idx on automation_rules (account_id, trigger_event) where enabled;

create table automation_actions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  rule_id uuid not null references automation_rules(id) on delete cascade,
  action_type text not null check (action_type in ('whatsapp_template', 'email', 'webhook')),
  position integer not null default 0,
  -- whatsapp_template: { template_name, template_language, doc_template_id? }
  -- email: { subject, body } -- body supports {{first_name}} etc merge tokens
  -- webhook: { url, secret? } -- secret, if set, signs the payload the same
  --   way as the webhooks table (HMAC-SHA256, hex, X-QuiroFlow-Signature)
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index automation_actions_rule_idx on automation_actions (rule_id, position);

alter table automation_rules enable row level security;
alter table automation_actions enable row level security;

create policy "staff manage automation_rules" on automation_rules
  for all using (is_account_member(account_id)) with check (is_account_member(account_id));
create policy "staff manage automation_actions" on automation_actions
  for all using (is_account_member(account_id)) with check (is_account_member(account_id));
