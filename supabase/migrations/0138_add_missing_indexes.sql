-- Performance: index every unindexed foreign key the Supabase performance
-- advisor flagged (99 of them, across nearly every table), plus trigram
-- indexes for the two leading-wildcard ILIKE searches the app runs (patient
-- name and phone number search). Every one of these queries currently falls
-- back to a sequential scan.
--
-- Foreign key columns matter beyond the joins they name: this app scopes
-- almost every query by account_id (directly or via RLS), and patient_id is
-- the next most common filter (the patient Billing tab, Appointments tab,
-- Docs tab, etc. all query "everything for this one patient"). Without an
-- index each of those is a full table scan, which only gets slower as a
-- clinic's history grows.
--
-- Plain (non-concurrent) CREATE INDEX is deliberate here, not an oversight --
-- CREATE INDEX CONCURRENTLY cannot run inside a transaction block, which is
-- how migrations get applied, and at this data volume (thousands of rows,
-- not millions) a regular index build takes milliseconds and briefly locks
-- writes on that one table, not reads.

create extension if not exists pg_trgm;

-- Powers pages/patients/index.vue's `search_name.ilike.%term%` and
-- components/patients search, and the phone-number search in the same
-- pages/patients/index.vue flow -- leading-wildcard ILIKE can never use a
-- plain btree index, only a trigram one.
create index if not exists patients_search_name_trgm_idx on public.patients using gin (search_name gin_trgm_ops);
create index if not exists patient_contact_numbers_number_trgm_idx on public.patient_contact_numbers using gin (number gin_trgm_ops);

create index if not exists account_credits_created_by_idx on public.account_credits (created_by);
create index if not exists account_credits_invoice_id_idx on public.account_credits (invoice_id);
create index if not exists account_invites_account_id_idx on public.account_invites (account_id);
create index if not exists account_invites_role_id_idx on public.account_invites (role_id);
create index if not exists api_tokens_created_by_idx on public.api_tokens (created_by);
create index if not exists appointment_reschedules_appointment_id_idx on public.appointment_reschedules (appointment_id);
create index if not exists appointment_reschedules_created_by_idx on public.appointment_reschedules (created_by);
create index if not exists appointment_reschedules_reason_id_idx on public.appointment_reschedules (reason_id);
create index if not exists appointment_type_overrides_team_member_id_idx on public.appointment_type_overrides (team_member_id);
create index if not exists appointment_types_account_id_idx on public.appointment_types (account_id);
create index if not exists appointments_appointment_type_id_idx on public.appointments (appointment_type_id);
create index if not exists appointments_practitioner_id_idx on public.appointments (practitioner_id);
create index if not exists appointments_room_id_idx on public.appointments (room_id);
create index if not exists audit_logs_team_member_id_idx on public.audit_logs (team_member_id);
create index if not exists automation_actions_account_id_idx on public.automation_actions (account_id);
create index if not exists automation_rule_sends_appointment_id_idx on public.automation_rule_sends (appointment_id);
create index if not exists automation_rules_created_by_idx on public.automation_rules (created_by);
create index if not exists availability_blocks_account_id_idx on public.availability_blocks (account_id);
create index if not exists availability_blocks_created_by_idx on public.availability_blocks (created_by);
create index if not exists availability_blocks_practitioner_id_idx on public.availability_blocks (practitioner_id);
create index if not exists availability_blocks_room_id_idx on public.availability_blocks (room_id);
create index if not exists calendar_resources_account_id_idx on public.calendar_resources (account_id);
create index if not exists calendar_resources_clinic_id_idx on public.calendar_resources (clinic_id);
create index if not exists care_plans_created_by_idx on public.care_plans (created_by);
create index if not exists care_plans_patient_id_idx on public.care_plans (patient_id);
create index if not exists cash_movements_clinic_id_idx on public.cash_movements (clinic_id);
create index if not exists cash_movements_team_member_id_idx on public.cash_movements (team_member_id);
create index if not exists cash_shifts_closed_by_idx on public.cash_shifts (closed_by);
create index if not exists cash_shifts_opened_by_idx on public.cash_shifts (opened_by);
create index if not exists clinics_account_id_idx on public.clinics (account_id);
create index if not exists contact_log_appointment_id_idx on public.contact_log (appointment_id);
create index if not exists contact_log_created_by_idx on public.contact_log (created_by);
create index if not exists contact_log_patient_id_idx on public.contact_log (patient_id);
create index if not exists custom_reports_account_id_idx on public.custom_reports (account_id);
create index if not exists custom_reports_created_by_idx on public.custom_reports (created_by);
create index if not exists doc_templates_created_by_idx on public.doc_templates (created_by);
create index if not exists doc_templates_updated_by_idx on public.doc_templates (updated_by);
create index if not exists invoice_line_items_account_id_idx on public.invoice_line_items (account_id);
create index if not exists invoice_line_items_service_id_idx on public.invoice_line_items (service_id);
create index if not exists invoices_account_id_idx on public.invoices (account_id);
create index if not exists invoices_appointment_id_idx on public.invoices (appointment_id);
create index if not exists invoices_refunds_invoice_id_idx on public.invoices (refunds_invoice_id);
create index if not exists membership_payments_account_id_idx on public.membership_payments (account_id);
create index if not exists memberships_account_id_idx on public.memberships (account_id);
create index if not exists modalities_account_id_idx on public.modalities (account_id);
create index if not exists package_purchase_shares_patient_id_idx on public.package_purchase_shares (patient_id);
create index if not exists package_purchases_created_by_idx on public.package_purchases (created_by);
create index if not exists package_purchases_invoice_id_idx on public.package_purchases (invoice_id);
create index if not exists package_purchases_package_id_idx on public.package_purchases (package_id);
create index if not exists package_purchases_patient_id_idx on public.package_purchases (patient_id);
create index if not exists packages_account_id_idx on public.packages (account_id);
create index if not exists patient_app_messages_account_id_idx on public.patient_app_messages (account_id);
create index if not exists patient_contact_numbers_account_id_idx on public.patient_contact_numbers (account_id);
create index if not exists patient_docs_created_by_idx on public.patient_docs (created_by);
create index if not exists patient_docs_patient_id_idx on public.patient_docs (patient_id);
create index if not exists patient_docs_template_id_idx on public.patient_docs (template_id);
create index if not exists patient_docs_updated_by_idx on public.patient_docs (updated_by);
create index if not exists patient_files_patient_id_idx on public.patient_files (patient_id);
create index if not exists patient_files_uploaded_by_idx on public.patient_files (uploaded_by);
create index if not exists patient_memberships_created_by_idx on public.patient_memberships (created_by);
create index if not exists patient_memberships_membership_id_idx on public.patient_memberships (membership_id);
create index if not exists patient_memberships_patient_id_idx on public.patient_memberships (patient_id);
create index if not exists patient_stripe_customers_patient_id_idx on public.patient_stripe_customers (patient_id);
create index if not exists patients_clinic_id_idx on public.patients (clinic_id);
create index if not exists patients_default_practitioner_id_idx on public.patients (default_practitioner_id);
create index if not exists patients_user_id_idx on public.patients (user_id);
create index if not exists payment_methods_account_id_idx on public.payment_methods (account_id);
create index if not exists payment_schedules_package_purchase_id_idx on public.payment_schedules (package_purchase_id);
create index if not exists payment_schedules_patient_id_idx on public.payment_schedules (patient_id);
create index if not exists payment_schedules_patient_membership_id_idx on public.payment_schedules (patient_membership_id);
create index if not exists payments_account_id_idx on public.payments (account_id);
create index if not exists photo_upload_tokens_account_id_idx on public.photo_upload_tokens (account_id);
create index if not exists reschedule_reasons_account_id_idx on public.reschedule_reasons (account_id);
create index if not exists saved_replies_created_by_idx on public.saved_replies (created_by);
create index if not exists saved_replies_updated_by_idx on public.saved_replies (updated_by);
create index if not exists services_products_account_id_idx on public.services_products (account_id);
create index if not exists stripe_payment_events_account_id_idx on public.stripe_payment_events (account_id);
create index if not exists subscriptions_plan_id_idx on public.subscriptions (plan_id);
create index if not exists team_member_clinics_clinic_id_idx on public.team_member_clinics (clinic_id);
create index if not exists team_members_role_id_idx on public.team_members (role_id);
create index if not exists team_members_user_id_idx on public.team_members (user_id);
create index if not exists visit_notes_account_id_idx on public.visit_notes (account_id);
create index if not exists visit_notes_appointment_id_idx on public.visit_notes (appointment_id);
create index if not exists visit_notes_created_by_idx on public.visit_notes (created_by);
create index if not exists waitlist_entries_appointment_type_id_idx on public.waitlist_entries (appointment_type_id);
create index if not exists waitlist_entries_booked_appointment_id_idx on public.waitlist_entries (booked_appointment_id);
create index if not exists waitlist_entries_clinic_id_idx on public.waitlist_entries (clinic_id);
create index if not exists waitlist_entries_created_by_idx on public.waitlist_entries (created_by);
create index if not exists waitlist_entries_offered_appointment_type_id_idx on public.waitlist_entries (offered_appointment_type_id);
create index if not exists waitlist_entries_offered_practitioner_id_idx on public.waitlist_entries (offered_practitioner_id);
create index if not exists waitlist_entries_offered_room_id_idx on public.waitlist_entries (offered_room_id);
create index if not exists waitlist_entries_patient_id_idx on public.waitlist_entries (patient_id);
create index if not exists waitlist_entries_practitioner_id_idx on public.waitlist_entries (practitioner_id);
create index if not exists webhook_deliveries_account_id_idx on public.webhook_deliveries (account_id);
create index if not exists webhooks_account_id_idx on public.webhooks (account_id);
create index if not exists webhooks_created_by_idx on public.webhooks (created_by);
create index if not exists whatsapp_conversation_labels_label_id_idx on public.whatsapp_conversation_labels (label_id);
create index if not exists whatsapp_labels_created_by_idx on public.whatsapp_labels (created_by);
create index if not exists whatsapp_messages_appointment_id_idx on public.whatsapp_messages (appointment_id);
