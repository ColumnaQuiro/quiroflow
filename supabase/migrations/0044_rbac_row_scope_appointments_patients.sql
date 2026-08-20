drop policy "staff manage appointments" on appointments;

create policy "staff select appointments" on appointments
  for select using (
    is_account_member(account_id)
    and (permission_scope(account_id, 'calendar_scope') = 'all' or practitioner_id = current_team_member_id(account_id))
  );

create policy "staff insert appointments" on appointments
  for insert with check (
    is_account_member(account_id)
    and permission_scope(account_id, 'calendar_scope') != 'none'
    and not has_permission(account_id, 'calendar_read_only')
  );

create policy "staff update appointments" on appointments
  for update using (
    is_account_member(account_id)
    and (permission_scope(account_id, 'calendar_scope') = 'all' or practitioner_id = current_team_member_id(account_id))
    and not has_permission(account_id, 'calendar_read_only')
  )
  with check (
    is_account_member(account_id)
    and (permission_scope(account_id, 'calendar_scope') = 'all' or practitioner_id = current_team_member_id(account_id))
    and not has_permission(account_id, 'calendar_read_only')
  );

create policy "staff delete appointments" on appointments
  for delete using (
    is_account_member(account_id)
    and (permission_scope(account_id, 'calendar_scope') = 'all' or practitioner_id = current_team_member_id(account_id))
    and has_permission(account_id, 'appointments_delete')
  );

drop policy "staff manage patients" on patients;

create policy "staff select patients" on patients
  for select using (is_account_member(account_id) and can_access_patient(account_id, id));

create policy "staff insert patients" on patients
  for insert with check (
    is_account_member(account_id) and permission_scope(account_id, 'patients_scope') != 'none'
  );

create policy "staff update patients" on patients
  for update using (is_account_member(account_id) and can_access_patient(account_id, id) and has_permission(account_id, 'patients_edit'))
  with check (is_account_member(account_id) and can_access_patient(account_id, id) and has_permission(account_id, 'patients_edit'));

create policy "staff delete patients" on patients
  for delete using (is_account_member(account_id) and has_permission(account_id, 'patients_delete_merge'));
