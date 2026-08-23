-- usePatientFinancialSummary() also reads payments (via invoice_id) to
-- compute the patient's balance -- same join-through-invoices pattern
-- already used for "patients view own invoice_line_items" in 0001_init_schema.sql.
create policy "patients view own payments" on payments
  for select using (
    invoice_id in (
      select i.id from invoices i
      join patients p on p.id = i.patient_id
      where p.user_id = auth.uid()
    )
  );
