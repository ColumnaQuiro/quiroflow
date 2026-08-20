create or replace function can_access_patient(target_account_id uuid, target_patient_id uuid)
returns boolean
language sql
security definer
stable
set search_path to 'public'
as $$
  select case permission_scope(target_account_id, 'patients_scope')
    when 'all' then true
    when 'own' then (
      exists (
        select 1 from appointments a
        where a.patient_id = target_patient_id and a.practitioner_id = current_team_member_id(target_account_id)
      )
      or exists (
        select 1 from patients p
        where p.id = target_patient_id and p.default_practitioner_id = current_team_member_id(target_account_id)
      )
    )
    else false
  end;
$$;
