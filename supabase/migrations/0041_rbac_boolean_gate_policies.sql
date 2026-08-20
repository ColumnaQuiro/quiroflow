alter policy "staff manage account_invites" on account_invites
  using (is_account_member(account_id) and has_permission(account_id, 'team_admin'))
  with check (is_account_member(account_id) and has_permission(account_id, 'team_admin'));

alter policy "staff manage webhooks" on webhooks
  using (is_account_member(account_id) and has_permission(account_id, 'data_admin'))
  with check (is_account_member(account_id) and has_permission(account_id, 'data_admin'));

alter policy "staff read webhook_deliveries" on webhook_deliveries
  using (is_account_member(account_id) and has_permission(account_id, 'data_admin'));

alter policy "staff manage doc_templates" on doc_templates
  using (is_account_member(account_id) and has_permission(account_id, 'communication_config'))
  with check (is_account_member(account_id) and has_permission(account_id, 'communication_config'));

alter policy "staff manage custom_reports" on custom_reports
  using (is_account_member(account_id) and has_permission(account_id, 'reports_access'))
  with check (is_account_member(account_id) and has_permission(account_id, 'reports_access'));

alter policy "staff manage appointment_types" on appointment_types
  using (is_account_member(account_id) and has_permission(account_id, 'clinic_config'))
  with check (is_account_member(account_id) and has_permission(account_id, 'clinic_config'));

alter policy "staff manage calendar_resources" on calendar_resources
  using (is_account_member(account_id) and has_permission(account_id, 'clinic_config'))
  with check (is_account_member(account_id) and has_permission(account_id, 'clinic_config'));

alter policy "staff manage clinics" on clinics
  using (is_account_member(account_id) and has_permission(account_id, 'clinic_config'))
  with check (is_account_member(account_id) and has_permission(account_id, 'clinic_config'));

alter policy "staff manage services_products" on services_products
  using (is_account_member(account_id) and has_permission(account_id, 'billing_config'))
  with check (is_account_member(account_id) and has_permission(account_id, 'billing_config'));

alter policy "staff manage packages" on packages
  using (is_account_member(account_id) and has_permission(account_id, 'billing_config'))
  with check (is_account_member(account_id) and has_permission(account_id, 'billing_config'));

alter policy "staff manage package_purchases" on package_purchases
  using (is_account_member(account_id) and has_permission(account_id, 'billing_config'))
  with check (is_account_member(account_id) and has_permission(account_id, 'billing_config'));

alter policy "staff manage memberships" on memberships
  using (is_account_member(account_id) and has_permission(account_id, 'billing_config'))
  with check (is_account_member(account_id) and has_permission(account_id, 'billing_config'));

alter policy "staff manage patient_memberships" on patient_memberships
  using (is_account_member(account_id) and has_permission(account_id, 'billing_config'))
  with check (is_account_member(account_id) and has_permission(account_id, 'billing_config'));

alter policy "staff manage membership_payments" on membership_payments
  using (is_account_member(account_id) and has_permission(account_id, 'billing_config'))
  with check (is_account_member(account_id) and has_permission(account_id, 'billing_config'));

alter policy "staff manage patient_stripe_customers" on patient_stripe_customers
  using (is_account_member(account_id) and has_permission(account_id, 'billing_config'))
  with check (is_account_member(account_id) and has_permission(account_id, 'billing_config'));

alter policy "staff manage payment_schedules" on payment_schedules
  using (is_account_member(account_id) and has_permission(account_id, 'billing_config'))
  with check (is_account_member(account_id) and has_permission(account_id, 'billing_config'));

alter policy "staff manage contact_log" on contact_log
  using (is_account_member(account_id) and has_permission(account_id, 'recalls_access'))
  with check (is_account_member(account_id) and has_permission(account_id, 'recalls_access'));
