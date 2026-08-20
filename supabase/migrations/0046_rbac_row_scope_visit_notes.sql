drop policy "staff manage visit_notes" on visit_notes;

create policy "staff select visit_notes" on visit_notes
  for select using (is_account_member(account_id) and has_permission(account_id, 'visit_notes_access'));

create policy "staff insert visit_notes" on visit_notes
  for insert with check (is_account_member(account_id) and has_permission(account_id, 'visit_notes_access'));

create policy "staff update visit_notes" on visit_notes
  for update using (
    is_account_member(account_id) and has_permission(account_id, 'visit_notes_edit')
    and (permission_scope(account_id, 'visit_notes_scope') = 'all' or created_by = current_team_member_id(account_id))
  )
  with check (
    is_account_member(account_id) and has_permission(account_id, 'visit_notes_edit')
    and (permission_scope(account_id, 'visit_notes_scope') = 'all' or created_by = current_team_member_id(account_id))
  );

create policy "staff delete visit_notes" on visit_notes
  for delete using (
    is_account_member(account_id) and has_permission(account_id, 'visit_notes_delete')
    and (permission_scope(account_id, 'visit_notes_scope') = 'all' or created_by = current_team_member_id(account_id))
  );
