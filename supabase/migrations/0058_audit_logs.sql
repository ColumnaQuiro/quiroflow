-- Changelog: who changed/created/deleted an appointment or patient, and
-- what changed. Feeds both the "Logs" ask directly and the Calendar hover
-- dialog's Changelog section. auth.uid() is available inside a security
-- definer trigger the same way it already is inside has_permission() /
-- is_account_member() elsewhere -- it's a session-level GUC, not affected
-- by the function's security context.
create table audit_logs (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  entity_type text not null check (entity_type in ('appointment', 'patient')),
  entity_id uuid not null,
  action text not null check (action in ('created', 'updated', 'deleted')),
  summary text not null,
  team_member_id uuid references team_members(id) on delete set null,
  created_at timestamptz not null default now()
);

create index audit_logs_entity_idx on audit_logs (entity_type, entity_id, created_at desc);
create index audit_logs_account_idx on audit_logs (account_id, created_at desc);

alter table audit_logs enable row level security;
-- Read-only for staff -- rows are only ever written by the trigger function
-- below (security definer), never directly by a client.
create policy "staff read audit_logs" on audit_logs
  for select using (is_account_member(account_id));

-- Appointment changes are only logged for the fields staff actually care
-- about seeing in a changelog (status, time, practitioner, room, type) --
-- skips the high-frequency fields already visible elsewhere on the
-- calendar (checked_in_at, flow_*_at, confirmation_status) so the log
-- doesn't fill up with noise. Patient changes log which fields changed,
-- generically, via a jsonb diff.
create or replace function fn_audit_log()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_entity_type text := TG_ARGV[0];
  v_entity_id uuid;
  v_action text;
  v_summary text;
  v_team_member_id uuid;
  v_changed text[];
begin
  if TG_OP = 'DELETE' then
    v_account_id := (OLD).account_id;
    v_entity_id := (OLD).id;
    v_action := 'deleted';
  else
    v_account_id := (NEW).account_id;
    v_entity_id := (NEW).id;
    v_action := case when TG_OP = 'INSERT' then 'created' else 'updated' end;
  end if;

  select tm.id into v_team_member_id
  from team_members tm
  where tm.account_id = v_account_id and tm.user_id = auth.uid();

  if TG_OP = 'UPDATE' then
    if v_entity_type = 'appointment' then
      if OLD.status is distinct from NEW.status then
        v_summary := coalesce(v_summary || '; ', '') || 'Status changed from ' || OLD.status || ' to ' || NEW.status;
      end if;
      if OLD.starts_at is distinct from NEW.starts_at then
        v_summary := coalesce(v_summary || '; ', '') || 'Rescheduled to ' || to_char(NEW.starts_at, 'DD Mon HH24:MI');
      end if;
      if OLD.practitioner_id is distinct from NEW.practitioner_id then
        v_summary := coalesce(v_summary || '; ', '') || 'Practitioner changed';
      end if;
      if OLD.room_id is distinct from NEW.room_id then
        v_summary := coalesce(v_summary || '; ', '') || 'Room changed';
      end if;
      if OLD.appointment_type_id is distinct from NEW.appointment_type_id then
        v_summary := coalesce(v_summary || '; ', '') || 'Type changed';
      end if;
      if v_summary is null then
        return NEW;
      end if;
    else
      select array_agg(key) into v_changed
      from jsonb_each(to_jsonb(NEW)) n
      join jsonb_each(to_jsonb(OLD)) o using (key)
      where n.value is distinct from o.value and key not in ('id', 'account_id', 'created_at', 'updated_at', 'balance_cents');
      if v_changed is null or array_length(v_changed, 1) = 0 then
        return NEW;
      end if;
      v_summary := 'Updated: ' || array_to_string(v_changed, ', ');
    end if;
  elsif TG_OP = 'INSERT' then
    v_summary := 'Created';
  elsif TG_OP = 'DELETE' then
    v_summary := 'Deleted';
  end if;

  insert into audit_logs (account_id, entity_type, entity_id, action, summary, team_member_id)
  values (v_account_id, v_entity_type, v_entity_id, v_action, v_summary, v_team_member_id);

  if TG_OP = 'DELETE' then
    return OLD;
  end if;
  return NEW;
end;
$$;

create trigger trg_audit_appointments
  after insert or update or delete on appointments
  for each row execute function fn_audit_log('appointment');

create trigger trg_audit_patients
  after insert or update or delete on patients
  for each row execute function fn_audit_log('patient');
