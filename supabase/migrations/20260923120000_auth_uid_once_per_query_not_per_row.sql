-- auth.uid() once per query, not once per row.
--
-- Twenty policies call auth.uid() bare inside their USING or WITH CHECK
-- expression. Postgres treats that as correlated with the row and
-- re-evaluates it for EVERY row the policy is tested against -- 1,577 times
-- to answer "which patient record is mine", and once per payment on a table
-- already past 3,300 rows that only grows.
--
-- Wrapping it in a scalar subquery lets the planner hoist it into an
-- InitPlan: evaluated once, before the scan, and compared as a constant.
-- This is Supabase's own documented fix for the lint
-- (database-linter?lint=0003_auth_rls_initplan) and it changes no semantics
-- whatsoever -- auth.uid() reads a per-SESSION setting, so a value that
-- varied from row to row was never possible in the first place.
--
-- Every one of these guards a patient reading their OWN data through the
-- patient app: their record, appointments, invoices, payments, facturas,
-- files, messages. They are the boundary around 1,577 people's medical and
-- billing history, so nothing here was retyped. Each statement was generated
-- from pg_get_expr() on the live policy with the single token auth.uid()
-- substituted, then applied in a rolled-back transaction and compared back
-- against the original with the wrapper normalised away. The only difference
-- in any of the twenty is the wrapper.
--
-- ALTER POLICY rather than drop-and-recreate, so the roles, the command and
-- the PERMISSIVE/RESTRICTIVE setting are never in play and only the
-- expression moves. A dropped policy is also a window in which the table is
-- readable by whatever the remaining policies allow, which on these tables
-- is not a window worth opening to save a line of SQL.

alter policy "patients view own account_credits" on public.account_credits
  using ((patient_id IN ( SELECT patients.id FROM patients WHERE (patients.user_id = ( select auth.uid() )))));

alter policy "patients read types of own appointments" on public.appointment_types
  using ((EXISTS ( SELECT 1 FROM (appointments a JOIN patients p ON ((p.id = a.patient_id))) WHERE ((a.appointment_type_id = appointment_types.id) AND (p.user_id = ( select auth.uid() ))))));

alter policy "patients view own appointments" on public.appointments
  using ((patient_id IN ( SELECT patients.id FROM patients WHERE (patients.user_id = ( select auth.uid() )))));

alter policy "patients view own care_plans" on public.care_plans
  using ((patient_id IN ( SELECT patients.id FROM patients WHERE (patients.user_id = ( select auth.uid() )))));

alter policy "users manage own device_push_tokens" on public.device_push_tokens
  using ((user_id = ( select auth.uid() )))
  with check ((user_id = ( select auth.uid() )));

alter policy "patients view own facturas" on public.facturas
  using ((patient_id IN ( SELECT p.id FROM patients p WHERE (p.user_id = ( select auth.uid() )))));

alter policy "staff read own help_assistant_messages" on public.help_assistant_messages
  using ((team_member_id IN ( SELECT team_members.id FROM team_members WHERE (team_members.user_id = ( select auth.uid() )))));

alter policy "staff write own help_assistant_messages" on public.help_assistant_messages
  with check (((team_member_id IN ( SELECT team_members.id FROM team_members WHERE (team_members.user_id = ( select auth.uid() )))) AND (account_id = ( SELECT team_members.account_id FROM team_members WHERE (team_members.id = help_assistant_messages.team_member_id)))));

alter policy "patients view own invoice_line_items" on public.invoice_line_items
  using ((invoice_id IN ( SELECT i.id FROM (invoices i JOIN patients p ON ((p.id = i.patient_id))) WHERE (p.user_id = ( select auth.uid() )))));

alter policy "patients view own invoices" on public.invoices
  using ((patient_id IN ( SELECT patients.id FROM patients WHERE (patients.user_id = ( select auth.uid() )))));

alter policy "patients view own package_purchases" on public.package_purchases
  using ((patient_id IN ( SELECT patients.id FROM patients WHERE (patients.user_id = ( select auth.uid() )))));

alter policy "patients view own package_sessions" on public.package_sessions
  using ((patient_id IN ( SELECT p.id FROM patients p WHERE (p.user_id = ( select auth.uid() )))));

alter policy "patient insert own patient_app_messages" on public.patient_app_messages
  with check (((direction = 'inbound'::text) AND (patient_id IN ( SELECT patients.id FROM patients WHERE (patients.user_id = ( select auth.uid() ))))));

alter policy "patient select own patient_app_messages" on public.patient_app_messages
  using ((patient_id IN ( SELECT patients.id FROM patients WHERE (patients.user_id = ( select auth.uid() )))));

alter policy "patients view own contact numbers" on public.patient_contact_numbers
  using ((patient_id IN ( SELECT patients.id FROM patients WHERE (patients.user_id = ( select auth.uid() )))));

alter policy "patients view own custom patient_files" on public.patient_files
  using (((visibility = 'custom'::text) AND (storage_path IS NOT NULL) AND (patient_id IN ( SELECT p.id FROM patients p WHERE (p.user_id = ( select auth.uid() ))))));

alter policy "patients view own patient_memberships" on public.patient_memberships
  using ((patient_id IN ( SELECT patients.id FROM patients WHERE (patients.user_id = ( select auth.uid() )))));

alter policy "patients view own record" on public.patients
  using ((user_id = ( select auth.uid() )));

alter policy "patients view own payments" on public.payments
  using ((patient_id IN ( SELECT p.id FROM patients p WHERE (p.user_id = ( select auth.uid() )))));

alter policy "patients read practitioners of own appointments" on public.team_members
  using ((EXISTS ( SELECT 1 FROM (appointments a JOIN patients p ON ((p.id = a.patient_id))) WHERE ((a.practitioner_id = team_members.id) AND (p.user_id = ( select auth.uid() ))))));

-- The staff-side policies are NOT here, and that is not an oversight. They go
-- through is_account_member() / has_permission() / my_patients_scope(), which
-- are STABLE SECURITY DEFINER functions -- already hoisted, and the reason
-- the linter never flagged them. Wrapping those would change nothing.
