drop policy "staff manage invoices" on invoices;

create policy "staff select invoices" on invoices
  for select using (is_account_member(account_id) and can_access_patient(account_id, patient_id));

create policy "staff insert invoices" on invoices
  for insert with check (
    is_account_member(account_id) and can_access_patient(account_id, patient_id) and has_permission(account_id, 'billing_access')
  );

create policy "staff update invoices" on invoices
  for update using (
    is_account_member(account_id) and can_access_patient(account_id, patient_id)
    and (has_permission(account_id, 'financials_edit_all') or (has_permission(account_id, 'financials_edit_same_day_only') and created_at::date = current_date))
  )
  with check (
    is_account_member(account_id) and can_access_patient(account_id, patient_id)
    and (has_permission(account_id, 'financials_edit_all') or (has_permission(account_id, 'financials_edit_same_day_only') and created_at::date = current_date))
  );

create policy "staff delete invoices" on invoices
  for delete using (is_account_member(account_id) and can_access_patient(account_id, patient_id) and has_permission(account_id, 'financials_edit_all'));

drop policy "staff manage invoice_line_items" on invoice_line_items;

create policy "staff select invoice_line_items" on invoice_line_items
  for select using (
    is_account_member(account_id)
    and exists (select 1 from invoices i where i.id = invoice_line_items.invoice_id and can_access_patient(account_id, i.patient_id))
  );

create policy "staff write invoice_line_items" on invoice_line_items
  for all using (
    is_account_member(account_id)
    and exists (
      select 1 from invoices i where i.id = invoice_line_items.invoice_id and can_access_patient(account_id, i.patient_id)
      and (has_permission(account_id, 'financials_edit_all') or (has_permission(account_id, 'financials_edit_same_day_only') and i.created_at::date = current_date))
    )
  )
  with check (
    is_account_member(account_id)
    and exists (
      select 1 from invoices i where i.id = invoice_line_items.invoice_id and can_access_patient(account_id, i.patient_id)
      and (has_permission(account_id, 'financials_edit_all') or (has_permission(account_id, 'financials_edit_same_day_only') and i.created_at::date = current_date))
    )
  );

drop policy "staff manage payments" on payments;

create policy "staff select payments" on payments
  for select using (
    is_account_member(account_id)
    and exists (select 1 from invoices i where i.id = payments.invoice_id and can_access_patient(account_id, i.patient_id))
  );

create policy "staff write payments" on payments
  for all using (
    is_account_member(account_id) and has_permission(account_id, 'payments_allocate')
    and exists (select 1 from invoices i where i.id = payments.invoice_id and can_access_patient(account_id, i.patient_id))
  )
  with check (
    is_account_member(account_id) and has_permission(account_id, 'payments_allocate')
    and exists (select 1 from invoices i where i.id = payments.invoice_id and can_access_patient(account_id, i.patient_id))
  );

drop policy "staff manage patient_docs" on patient_docs;

create policy "staff select patient_docs" on patient_docs
  for select using (is_account_member(account_id) and can_access_patient(account_id, patient_id));

create policy "staff insert patient_docs" on patient_docs
  for insert with check (is_account_member(account_id) and can_access_patient(account_id, patient_id));

create policy "staff update patient_docs" on patient_docs
  for update using (is_account_member(account_id) and can_access_patient(account_id, patient_id))
  with check (is_account_member(account_id) and can_access_patient(account_id, patient_id));

create policy "staff delete patient_docs" on patient_docs
  for delete using (is_account_member(account_id) and can_access_patient(account_id, patient_id) and has_permission(account_id, 'patient_docs_delete'));

drop policy "staff manage patient_files" on patient_files;

create policy "staff select patient_files" on patient_files
  for select using (is_account_member(account_id) and can_access_patient(account_id, patient_id));

create policy "staff insert patient_files" on patient_files
  for insert with check (is_account_member(account_id) and can_access_patient(account_id, patient_id));

create policy "staff update patient_files" on patient_files
  for update using (is_account_member(account_id) and can_access_patient(account_id, patient_id))
  with check (is_account_member(account_id) and can_access_patient(account_id, patient_id));

create policy "staff delete patient_files" on patient_files
  for delete using (is_account_member(account_id) and can_access_patient(account_id, patient_id) and has_permission(account_id, 'patient_files_delete'));
