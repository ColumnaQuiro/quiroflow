-- Bulk edits from the Patients list: archive or reactivate, set the
-- practitioner, add or remove a tag -- on the ticked rows, or on everyone the
-- filters match ("all N that match"), resolved by bulk_patient_ids exactly
-- as the patient-type and exercise bulk actions are.
--
-- Security invoker, on purpose. The update runs under the patients RLS
-- policies as the caller, so a row outside their scope is not changed (and
-- counted as skipped, not as done); the two-factor restrictive policy still
-- applies; the tag trigger still demands patients_tags_remove before any
-- tag goes; and the patients audit trigger records each row.
--
-- p_changes holds exactly one of:
--   {"status": "active" | "inactive"}
--   {"practitioner_id": "<team member id>" | null}   -- null clears it
--   {"add_tag": "<tag>"}
--   {"remove_tag": "<tag>"}
--
-- Returns {matched, changed, skipped}: matched is everyone selected,
-- changed the rows actually written, skipped the ones that needed the change
-- but the caller could not write. matched - changed - skipped already were
-- that way.
create or replace function public.bulk_update_patients(
  p_account_id uuid,
  p_patient_ids uuid[],
  p_filters jsonb,
  p_clinic_id uuid,
  p_changes jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_ids uuid[];
  v_status text := p_changes->>'status';
  v_set_practitioner boolean := coalesce(p_changes ? 'practitioner_id', false);
  v_practitioner uuid := nullif(p_changes->>'practitioner_id', '')::uuid;
  v_add_tag text := nullif(btrim(p_changes->>'add_tag'), '');
  v_remove_tag text := nullif(btrim(p_changes->>'remove_tag'), '');
  v_matched integer;
  v_targets uuid[];
  v_changed integer;
begin
  if (select auth.uid()) is not null and not public.has_permission(p_account_id, 'patients_edit') then
    raise exception 'Your role cannot edit patients' using errcode = '42501';
  end if;
  if (v_status is not null)::int + v_set_practitioner::int + (v_add_tag is not null)::int + (v_remove_tag is not null)::int <> 1 then
    raise exception 'One change at a time';
  end if;
  if v_status is not null and v_status not in ('active', 'inactive') then
    raise exception 'Unknown status %', v_status;
  end if;
  if v_practitioner is not null and not exists (
    select 1 from public.team_members tm
    where tm.id = v_practitioner and tm.account_id = p_account_id and tm.deleted_at is null
  ) then
    raise exception 'Practitioner not found';
  end if;

  v_ids := public.bulk_patient_ids(p_patient_ids, p_filters, p_clinic_id);
  select coalesce(array_agg(p.id), '{}') into v_ids
  from public.patients p where p.id = any (v_ids) and p.account_id = p_account_id;
  v_matched := cardinality(v_ids);

  -- The ones the change would actually alter. Read under the select policy,
  -- so it is what the caller sees; the update below may write fewer.
  select coalesce(array_agg(p.id), '{}') into v_targets
  from public.patients p
  where p.id = any (v_ids)
    and case
      when v_status is not null then p.status is distinct from v_status
      when v_set_practitioner then p.default_practitioner_id is distinct from v_practitioner
      when v_add_tag is not null then not exists (
        select 1 from unnest(coalesce(p.tags, '{}'::text[])) t where lower(btrim(t)) = lower(v_add_tag))
      else exists (
        select 1 from unnest(coalesce(p.tags, '{}'::text[])) t where lower(btrim(t)) = lower(v_remove_tag))
    end;

  if v_status is not null then
    update public.patients p set status = v_status
    where p.id = any (v_targets);
  elsif v_set_practitioner then
    update public.patients p set default_practitioner_id = v_practitioner
    where p.id = any (v_targets);
  elsif v_add_tag is not null then
    update public.patients p set tags = coalesce(p.tags, '{}'::text[]) || v_add_tag
    where p.id = any (v_targets);
  else
    update public.patients p
    set tags = array(select t from unnest(coalesce(p.tags, '{}'::text[])) t where lower(btrim(t)) <> lower(v_remove_tag))
    where p.id = any (v_targets);
  end if;
  get diagnostics v_changed = row_count;

  return jsonb_build_object('matched', v_matched, 'changed', v_changed, 'skipped', cardinality(v_targets) - v_changed);
end;
$function$;

revoke all on function public.bulk_update_patients(uuid, uuid[], jsonb, uuid, jsonb) from public, anon;
grant execute on function public.bulk_update_patients(uuid, uuid[], jsonb, uuid, jsonb) to authenticated, service_role;
