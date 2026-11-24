-- An import job no longer writes one audit row per record it imports.
--
-- fn_audit_log copies every created row into audit_logs.snapshot. For an
-- import that is the whole history of a clinic, written twice: on 24 Nov 2026
-- one Quirocitas import (12,236 patients, 104,503 appointments) added 116,590
-- audit rows in three hours, and audit_logs reached 559 MB of a 1,091 MB
-- database. The doubled writes and WAL are what the Micro instance could not
-- keep up with: queries timed out across every clinic, and once the database
-- stopped answering at all for fifteen minutes.
--
-- Those rows record nothing a person did. The import keeps its own copy of
-- what it read (import_snapshots), every imported row carries its
-- external_reference, and the job itself now writes ONE audit row per step it
-- finishes (entity_type 'import_job', server/utils/importJobs.ts): who ran it,
-- from where, what was written.
--
-- How the trigger tells: slices run with a service-role client carrying an
-- `x-audit-import` header (server/api/import/jobs/[id]/slice.post.ts). As
-- with x-audit-actor (audit_actor), the header is believed only on a
-- service_role request, which a browser cannot make. Anything a person does
-- through the app -- including editing an imported record afterwards -- is
-- audited exactly as before.
--
-- The body below is 20261008070424_audit_trail.sql's, unchanged, except that
-- the check runs first and the row copies it guards are taken after it, so a
-- skipped write costs no jsonb conversion.

create or replace function public.audit_import_write()
returns boolean
language plpgsql
stable
set search_path = ''
as $$
declare
  v_claims jsonb;
begin
  begin
    v_claims := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
    return coalesce(v_claims ->> 'role', '') = 'service_role'
      and (nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-audit-import') is not null;
  exception when others then
    return false;
  end;
end;
$$;
revoke execute on function public.audit_import_write() from public, anon, authenticated;

create or replace function public.fn_audit_log()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entity_type text := TG_ARGV[0];
  v_ignore text[] := array['created_at', 'updated_at']
    || coalesce(string_to_array(nullif(TG_ARGV[1], ''), ','), '{}'::text[]);
  v_old jsonb;
  v_new jsonb;
  v_row jsonb;
  v_account_id uuid;
  v_entity_id uuid;
  v_patient_id uuid;
  v_action text;
  v_summary text;
  v_changes jsonb;
  v_snapshot jsonb;
  v_actor record;
begin
  if public.audit_import_write() then
    return null;
  end if;

  v_old := case when TG_OP in ('UPDATE', 'DELETE') then to_jsonb(OLD) end;
  v_new := case when TG_OP in ('INSERT', 'UPDATE') then to_jsonb(NEW) end;
  v_row := coalesce(v_new, v_old);

  v_account_id := case when TG_TABLE_NAME = 'accounts' then (v_row ->> 'id')::uuid else (v_row ->> 'account_id')::uuid end;
  -- team_member_clinics has no account_id of its own.
  if v_account_id is null and v_row ? 'team_member_id' then
    select tm.account_id into v_account_id from public.team_members tm where tm.id = (v_row ->> 'team_member_id')::uuid;
  end if;
  if v_account_id is null then
    return null;
  end if;

  -- The whole account is being deleted and this row is going with it. Its
  -- audit_logs rows are going too (account_id cascades), and inserting one
  -- now would fail its foreign key and refuse the account delete outright.
  if TG_OP = 'DELETE' and not exists (select 1 from public.accounts a where a.id = v_account_id) then
    return null;
  end if;

  v_entity_id := coalesce((v_row ->> 'id')::uuid, (v_row ->> 'team_member_id')::uuid, v_account_id);

  if TG_OP = 'INSERT' then
    v_action := 'created';
    v_summary := 'Created';
  elsif TG_OP = 'DELETE' then
    v_action := 'deleted';
    v_summary := 'Deleted';
  else
    v_action := 'updated';
  end if;

  if TG_OP = 'UPDATE' and v_entity_type = 'appointment' then
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
    -- A soft delete. Worded as the 0058 hard delete was, which the panel
    -- already reads.
    if OLD.deleted_at is null and NEW.deleted_at is not null then
      v_summary := 'Deleted';
      v_action := 'deleted';
    end if;
    if v_summary is null then
      return null;
    end if;
    v_changes := public.audit_diff(
      v_old - array(select k from jsonb_object_keys(v_old) k where k not in ('status', 'starts_at', 'ends_at', 'practitioner_id', 'room_id', 'appointment_type_id', 'deleted_at')),
      v_new,
      '{}'::text[]
    );
  elsif TG_OP = 'UPDATE' then
    v_changes := public.audit_diff(v_old, v_new, v_ignore);
    if v_changes is null then
      return null;
    end if;
    v_summary := 'Updated: ' || (select string_agg(k, ', ' order by k) from jsonb_object_keys(v_changes) k);
  end if;

  if TG_OP in ('INSERT', 'DELETE') then
    v_snapshot := public.audit_redact(v_row);
  end if;

  if v_entity_type = 'patient' then
    v_patient_id := v_entity_id;
  elsif v_row ? 'patient_id' then
    v_patient_id := (v_row ->> 'patient_id')::uuid;
  elsif v_entity_type = 'visit_note' then
    select a.patient_id into v_patient_id from public.appointments a where a.id = (v_row ->> 'appointment_id')::uuid;
  end if;

  select * into v_actor from public.audit_actor(v_account_id);

  insert into public.audit_logs (
    account_id, entity_type, entity_id, action, summary, team_member_id,
    actor, actor_detail, actor_name, changes, snapshot, patient_id
  ) values (
    v_account_id, v_entity_type, v_entity_id, v_action, v_summary, v_actor.team_member_id,
    v_actor.actor, v_actor.actor_detail, v_actor.actor_name, v_changes, v_snapshot, v_patient_id
  );

  return null;
end;
$$;
revoke execute on function public.fn_audit_log() from public, anon, authenticated;

-- The one row each finished import step writes instead. Appended to whatever
-- the constraint allows when this runs rather than restated.
do $$
declare
  v_types text[];
begin
  select array_agg(distinct m[1]) into v_types
  from pg_constraint c, regexp_matches(pg_get_constraintdef(c.oid), '([a-z][a-z_]*)', 'g') m
  where c.conname = 'audit_logs_entity_type_check' and c.conrelid = 'public.audit_logs'::regclass
    and m[1] not in ('entity_type', 'text');
  v_types := array(select distinct x from unnest(coalesce(v_types, '{}') || array['import_job']) x order by 1);

  alter table public.audit_logs drop constraint audit_logs_entity_type_check;
  execute format('alter table public.audit_logs add constraint audit_logs_entity_type_check check (entity_type = any (%L::text[]))', v_types);
end;
$$;
