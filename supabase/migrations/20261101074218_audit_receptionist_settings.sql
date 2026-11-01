-- The AI receptionist's settings go on the audit trail.
--
-- Four of Columnaquiro's knowledge cards were gone from receptionist_config
-- by 31 Oct 2026 with nothing to say who removed them or when: the settings
-- screen saves the whole list of cards, so a save from a screen opened
-- before the cards were added writes the old list back, and the table had no
-- trigger. Now every change keeps the values before and after, so a card that
-- disappears can be seen going, and put back from the row that removed it.
do $$
declare
  v_types text[];
begin
  select array_agg(distinct m[1]) into v_types
  from pg_constraint c, regexp_matches(pg_get_constraintdef(c.oid), '([a-z][a-z_]*)', 'g') m
  where c.conname = 'audit_logs_entity_type_check' and c.conrelid = 'public.audit_logs'::regclass
    and m[1] not in ('entity_type', 'text');
  v_types := array(select distinct x from unnest(coalesce(v_types, '{}') || array['receptionist_settings']) x order by 1);

  alter table public.audit_logs drop constraint audit_logs_entity_type_check;
  execute format('alter table public.audit_logs add constraint audit_logs_entity_type_check check (entity_type = any (%L::text[]))', v_types);
end;
$$;

create trigger trg_audit_receptionist_config after insert or update or delete on public.receptionist_config
  for each row execute function public.fn_audit_log('receptionist_settings', 'updated_at');
