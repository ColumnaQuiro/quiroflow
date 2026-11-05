-- Saved email templates: an email built from blocks (utils/emailDesign.ts)
-- that a clinic keeps to start later emails from. "Save as template" in the
-- email editor writes one; "Templates" in the same editor lists them beside
-- QuiroFlow's starters.
--
-- A template is COPIED into an email when picked, never linked: editing a
-- template later changes no email already written with it, so tidying one up
-- cannot alter what a live automation sends. That is why nothing points back
-- here from automation_actions.
--
-- Same access as the automations themselves (20260926090000): every member
-- can read them, and writing needs communication_config.

create table public.email_templates (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 120),
  subject text not null default '',
  design jsonb not null check (jsonb_typeof(design) = 'object' and design ? 'blocks'),
  created_by uuid references public.team_members(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index email_templates_account_idx on public.email_templates (account_id, updated_at desc);
create index email_templates_created_by_idx on public.email_templates (created_by);

alter table public.email_templates enable row level security;

create policy "staff read email_templates" on public.email_templates
  for select using (is_account_member(account_id));
create policy "config writers insert email_templates" on public.email_templates
  for insert with check (is_account_member(account_id) and has_permission(account_id, 'communication_config'));
create policy "config writers update email_templates" on public.email_templates
  for update using (is_account_member(account_id) and has_permission(account_id, 'communication_config'))
  with check (is_account_member(account_id) and has_permission(account_id, 'communication_config'));
create policy "config writers delete email_templates" on public.email_templates
  for delete using (is_account_member(account_id) and has_permission(account_id, 'communication_config'));

select public.require_two_factor_on('public.email_templates');
select public.grant_data_api('public.email_templates');

-- The audit trail (CLAUDE.md), appended to whatever the constraint allows
-- when this runs rather than restated -- the block 20261023053614 uses.
do $$
declare
  v_types text[];
begin
  select array_agg(distinct m[1]) into v_types
  from pg_constraint c, regexp_matches(pg_get_constraintdef(c.oid), '([a-z][a-z_]*)', 'g') m
  where c.conname = 'audit_logs_entity_type_check' and c.conrelid = 'public.audit_logs'::regclass
    and m[1] not in ('entity_type', 'text');
  v_types := array(select distinct x from unnest(coalesce(v_types, '{}') || array['email_template']) x order by 1);

  alter table public.audit_logs drop constraint audit_logs_entity_type_check;
  execute format('alter table public.audit_logs add constraint audit_logs_entity_type_check check (entity_type = any (%L::text[]))', v_types);
end;
$$;
create trigger trg_audit_email_templates after insert or update or delete on public.email_templates
  for each row execute function public.fn_audit_log('email_template', 'updated_at');
