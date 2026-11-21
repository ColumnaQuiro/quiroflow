-- What QuiroFlow puts in a WhatsApp template's blanks on each send, for a
-- template made in QuiroFlow's template creator.
--
-- Meta stores the template and nothing about what fills it. A template can
-- now have a heading with {{1}}, a map pin at the top, a link that ends in
-- {{1}}, a code to copy and quick replies -- and Meta refuses the whole send
-- when any part that takes a value goes without one. So what the clinic chose
-- when it made the template (the heading takes the first name; the link ends
-- in the phone; this is the place; this is the code) is kept here, and every
-- send reads it back: automations, reminders, the Inbox, the staff alerts.
--
-- Shape (utils/whatsappTemplateDraft.ts, TemplateSendValues):
--   { "header": { "source": "first_name" },
--     "location": { "latitude": 40.4, "longitude": -3.7, "name": "...", "address": "..." },
--     "buttons": [ null, { "suffix": { "source": "phone" } }, { "code": "BIENVENIDA" }, { "payload": "Sí" } ] }
-- `buttons` is indexed the way Meta numbers them.
--
-- Keyed as whatsapp_template_forms is: name and language within the clinic.
-- Read by every member; written only by the template endpoints, through the
-- service role after their communication_config guard.

create table public.whatsapp_template_send_values (
  account_id uuid not null references public.accounts(id) on delete cascade,
  template_name text not null check (template_name ~ '^[a-z0-9_]+$'),
  template_language text not null check (length(template_language) between 2 and 10),
  send_values jsonb not null check (jsonb_typeof(send_values) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (account_id, template_name, template_language)
);

alter table public.whatsapp_template_send_values enable row level security;

create policy "staff read whatsapp_template_send_values" on public.whatsapp_template_send_values
  for select using (is_account_member(account_id));

select public.require_two_factor_on('public.whatsapp_template_send_values');
select public.grant_data_api('public.whatsapp_template_send_values');

-- The audit trail (CLAUDE.md), appended to whatever the constraint allows
-- when this runs rather than restated -- as 20261120101500 does.
do $$
declare
  v_types text[];
begin
  select array_agg(distinct m[1]) into v_types
  from pg_constraint c, regexp_matches(pg_get_constraintdef(c.oid), '([a-z][a-z_]*)', 'g') m
  where c.conname = 'audit_logs_entity_type_check' and c.conrelid = 'public.audit_logs'::regclass
    and m[1] not in ('entity_type', 'text');
  v_types := array(select distinct x from unnest(coalesce(v_types, '{}') || array['whatsapp_template_send_values']) x order by 1);

  alter table public.audit_logs drop constraint audit_logs_entity_type_check;
  execute format('alter table public.audit_logs add constraint audit_logs_entity_type_check check (entity_type = any (%L::text[]))', v_types);
end;
$$;
create trigger trg_audit_whatsapp_template_send_values after insert or update or delete on public.whatsapp_template_send_values
  for each row execute function public.fn_audit_log('whatsapp_template_send_values', 'updated_at');
