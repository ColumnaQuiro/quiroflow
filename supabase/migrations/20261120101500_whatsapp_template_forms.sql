-- Which QuiroFlow form a WhatsApp template's "fill in the form" button opens.
--
-- A template made in QuiroFlow can carry one URL button whose link is
-- `<app>/doc/{{1}}`: each send creates the patient's own copy of a form and
-- puts that copy's token in the {{1}}. Meta stores only the link, so which
-- form it is has to live here -- chosen once, in the template creator, rather
-- than again in every automation step and every hand-sent message.
--
-- Keyed the way Meta knows a template: its name and language within the
-- clinic. Deleting the form takes the row with it; the button then has no
-- form, and the send says so instead of sending a dead link.
--
-- Read by every member (the template pickers show which form goes out);
-- written only by the template endpoints, through the service role after
-- their communication_config guard.

create table public.whatsapp_template_forms (
  account_id uuid not null references public.accounts(id) on delete cascade,
  template_name text not null check (template_name ~ '^[a-z0-9_]+$'),
  template_language text not null check (length(template_language) between 2 and 10),
  doc_template_id uuid not null references public.doc_templates(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (account_id, template_name, template_language)
);

create index whatsapp_template_forms_doc_template_idx on public.whatsapp_template_forms (doc_template_id);

alter table public.whatsapp_template_forms enable row level security;

create policy "staff read whatsapp_template_forms" on public.whatsapp_template_forms
  for select using (is_account_member(account_id));

select public.require_two_factor_on('public.whatsapp_template_forms');
select public.grant_data_api('public.whatsapp_template_forms');

-- The audit trail (CLAUDE.md), appended to whatever the constraint allows
-- when this runs rather than restated -- as 20261105161255 does.
do $$
declare
  v_types text[];
begin
  select array_agg(distinct m[1]) into v_types
  from pg_constraint c, regexp_matches(pg_get_constraintdef(c.oid), '([a-z][a-z_]*)', 'g') m
  where c.conname = 'audit_logs_entity_type_check' and c.conrelid = 'public.audit_logs'::regclass
    and m[1] not in ('entity_type', 'text');
  v_types := array(select distinct x from unnest(coalesce(v_types, '{}') || array['whatsapp_template_form']) x order by 1);

  alter table public.audit_logs drop constraint audit_logs_entity_type_check;
  execute format('alter table public.audit_logs add constraint audit_logs_entity_type_check check (entity_type = any (%L::text[]))', v_types);
end;
$$;
create trigger trg_audit_whatsapp_template_forms after insert or update or delete on public.whatsapp_template_forms
  for each row execute function public.fn_audit_log('whatsapp_template_form');
