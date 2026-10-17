-- Every foreign key the Supabase performance advisor listed as unindexed on
-- 17 Oct 2026 gets a btree index.
--
-- Postgres indexes the referenced side of a foreign key (the primary key) and
-- never the referencing side. So deleting a patient, a team member or an
-- automation rule makes every child table without an index scan itself in
-- full, once per parent row, inside the delete's transaction. patients is the
-- hub of twenty-three foreign keys, nineteen of them on delete cascade, and
-- merge_patients ends by deleting a row (see CLAUDE.md), so each unindexed
-- child adds a sequential scan to every merge.
--
-- Named <table>_<column>_idx. A nullable column that is mostly null gets a
-- partial index (where <column> is not null), as payments_package_purchase_idx
-- does: the foreign-key check only ever looks up a non-null value, the index
-- stays a fraction of the size, and inserts that leave the column null do not
-- touch it. Null fractions were measured on production before choosing; the
-- empty tables (new features) are decided by what the column means.
--
-- Advisor entries skipped on purpose: none. Six of the columns do appear in
-- an existing index, but never as its leading column (facturas_patient_idx is
-- (account_id, patient_id), whatsapp_messages_rule_idx is (account_id,
-- rule_id, created_at) ...), and a foreign-key lookup on the second column of
-- a composite index is still a scan of the whole index.
--
-- Plain create index, not concurrently: migrate.yml applies each migration in
-- one transaction (psql -1), and the largest of these tables has 6.4k rows.

-- accounts (5 rows): both nullable and all but one row null.
create index accounts_lead_convert_appointment_type_id_idx
  on public.accounts (lead_convert_appointment_type_id)
  where lead_convert_appointment_type_id is not null;
create index accounts_referred_by_account_id_idx
  on public.accounts (referred_by_account_id)
  where referred_by_account_id is not null;

-- automation_birthday_sends (0 rows)
create index automation_birthday_sends_account_id_idx
  on public.automation_birthday_sends (account_id);

-- automation_sequence_runs (246 rows): lead_id is set on every row today;
-- the existing unique (rule_id, lead_id) does not lead with it.
create index automation_sequence_runs_lead_id_idx
  on public.automation_sequence_runs (lead_id);

-- class_sessions (0 rows): account_id and appointment_type_id are not null;
-- created_by is a staff member or nobody (system-generated series), room_id
-- is optional.
create index class_sessions_account_id_idx
  on public.class_sessions (account_id);
create index class_sessions_appointment_type_id_idx
  on public.class_sessions (appointment_type_id);
create index class_sessions_created_by_idx
  on public.class_sessions (created_by)
  where created_by is not null;
create index class_sessions_room_id_idx
  on public.class_sessions (room_id)
  where room_id is not null;

-- email_messages (719 rows): both nullable, neither null on any row.
create index email_messages_patient_id_idx
  on public.email_messages (patient_id);
create index email_messages_rule_id_idx
  on public.email_messages (rule_id);

-- facturas (175 rows): patient_id is not null and ON DELETE RESTRICT, so
-- every patient delete has to prove there is no factura; created_by is null
-- on 13% of rows (imported ones).
create index facturas_patient_id_idx
  on public.facturas (patient_id);
create index facturas_created_by_idx
  on public.facturas (created_by);

-- help_assistant_messages (0 rows)
create index help_assistant_messages_account_id_idx
  on public.help_assistant_messages (account_id);

-- inbox_assignments (3 rows, assigned_by set on all), inbox_notes (19 rows,
-- author_id null on all: notes written by automations).
create index inbox_assignments_assigned_by_idx
  on public.inbox_assignments (assigned_by);
create index inbox_notes_author_id_idx
  on public.inbox_notes (author_id)
  where author_id is not null;

-- lead_ad_page_tokens (1 row), lead_ad_pages (1 row, connected_by set)
create index lead_ad_page_tokens_account_id_idx
  on public.lead_ad_page_tokens (account_id);
create index lead_ad_pages_connected_by_idx
  on public.lead_ad_pages (connected_by);

-- leads (263 rows): patient_id is null until conversion (89% null), clinic_id
-- on all but one row, owner_team_member_id and ai_taken_over_by on every row.
create index leads_ai_taken_over_by_idx
  on public.leads (ai_taken_over_by)
  where ai_taken_over_by is not null;
create index leads_clinic_id_idx
  on public.leads (clinic_id)
  where clinic_id is not null;
create index leads_owner_team_member_id_idx
  on public.leads (owner_team_member_id)
  where owner_team_member_id is not null;
create index leads_patient_id_idx
  on public.leads (patient_id)
  where patient_id is not null;

-- patient_push_broadcasts (0 rows): sent_by is the staff member, if any.
create index patient_push_broadcasts_sent_by_idx
  on public.patient_push_broadcasts (sent_by)
  where sent_by is not null;

-- pay_plans (0 rows): updated_by is set on edit only.
create index pay_plans_updated_by_idx
  on public.pay_plans (updated_by)
  where updated_by is not null;

-- payments (3,455 rows): created_by is null on 96% of rows (imports and
-- online payments). The method foreign key is composite, (account_id, method)
-- -> payment_methods (account_id, key); payments_account_id_idx leads with
-- account_id but a delete or key change on payment_methods still has to walk
-- every payment of the account, so the index matches the whole key.
create index payments_created_by_idx
  on public.payments (created_by)
  where created_by is not null;
create index payments_account_id_method_idx
  on public.payments (account_id, method);

-- product_stock_movements (0 rows): created_by is null for movements a sale
-- or a return produces.
create index product_stock_movements_created_by_idx
  on public.product_stock_movements (created_by)
  where created_by is not null;

-- report_pages (1 row, created_by set)
create index report_pages_created_by_idx
  on public.report_pages (created_by);

-- review_requests (0 rows): a request is about a patient's appointment, so
-- those two are expected on every row; review_id only once a review arrives.
create index review_requests_appointment_id_idx
  on public.review_requests (appointment_id);
create index review_requests_patient_id_idx
  on public.review_requests (patient_id);
create index review_requests_review_id_idx
  on public.review_requests (review_id)
  where review_id is not null;

-- reviews (0 rows): clinic_id only for multi-clinic accounts, reply_by only
-- once someone has replied.
create index reviews_clinic_id_idx
  on public.reviews (clinic_id)
  where clinic_id is not null;
create index reviews_reply_by_team_member_id_idx
  on public.reviews (reply_by_team_member_id)
  where reply_by_team_member_id is not null;

-- shift_days (0 rows), staff_leave_allowances (0 rows), staff_absences
-- (0 rows, decided_by set once approved or refused)
create index shift_days_account_id_idx
  on public.shift_days (account_id);
create index staff_leave_allowances_account_id_idx
  on public.staff_leave_allowances (account_id);
create index staff_absences_decided_by_idx
  on public.staff_absences (decided_by)
  where decided_by is not null;

-- staff_tasks (6 rows): done_by once done, lead_id / rule_id / run_id only on
-- tasks an automation created (none so far).
create index staff_tasks_done_by_idx
  on public.staff_tasks (done_by)
  where done_by is not null;
create index staff_tasks_lead_id_idx
  on public.staff_tasks (lead_id)
  where lead_id is not null;
create index staff_tasks_rule_id_idx
  on public.staff_tasks (rule_id)
  where rule_id is not null;
create index staff_tasks_run_id_idx
  on public.staff_tasks (run_id)
  where run_id is not null;

-- support_conversations (0 rows), support_messages (0 rows): account_id is
-- not null; the team-member columns are null for messages the platform
-- writes.
create index support_conversations_opened_by_team_member_id_idx
  on public.support_conversations (opened_by_team_member_id)
  where opened_by_team_member_id is not null;
create index support_messages_account_id_idx
  on public.support_messages (account_id);
create index support_messages_author_team_member_id_idx
  on public.support_messages (author_team_member_id)
  where author_team_member_id is not null;

-- time_clock_exemptions (0 rows), time_clock_reminders (0 rows)
create index time_clock_exemptions_account_id_idx
  on public.time_clock_exemptions (account_id);
create index time_clock_reminders_account_id_idx
  on public.time_clock_reminders (account_id);

-- time_corrections (0 rows), time_entries (0 rows): all four are set only
-- when a correction is decided or replaces an entry.
create index time_corrections_decided_by_idx
  on public.time_corrections (decided_by)
  where decided_by is not null;
create index time_corrections_replaces_entry_id_idx
  on public.time_corrections (replaces_entry_id)
  where replaces_entry_id is not null;
create index time_entries_correction_id_idx
  on public.time_entries (correction_id)
  where correction_id is not null;
create index time_entries_superseded_by_idx
  on public.time_entries (superseded_by)
  where superseded_by is not null;

-- verifactu_delegations (0 rows): both reference auth.users and are set as
-- the delegation moves through its states. verifactu_platform (1 row).
create index verifactu_delegations_accepted_by_idx
  on public.verifactu_delegations (accepted_by)
  where accepted_by is not null;
create index verifactu_delegations_requested_by_idx
  on public.verifactu_delegations (requested_by)
  where requested_by is not null;
create index verifactu_platform_account_id_idx
  on public.verifactu_platform (account_id);

-- whatsapp_messages (6,416 rows): rule_id is null on 79% of rows (inbound and
-- hand-written messages); whatsapp_messages_rule_idx leads with account_id.
create index whatsapp_messages_rule_id_idx
  on public.whatsapp_messages (rule_id)
  where rule_id is not null;

-- whatsapp_pending_statuses (1 row)
create index whatsapp_pending_statuses_account_id_idx
  on public.whatsapp_pending_statuses (account_id);
