-- Lets a patient read their own care plan and billing data -- needed for
-- the mobile app's patient home screen (bono balance, care-plan progress).
-- Same pattern as the existing "patients view own appointments"/"invoices"
-- policies in 0001_init_schema.sql; staff access is untouched.
create policy "patients view own care_plans" on care_plans
  for select using (patient_id in (select id from patients where user_id = auth.uid()));

create policy "patients view own package_purchases" on package_purchases
  for select using (patient_id in (select id from patients where user_id = auth.uid()));

create policy "patients view own patient_memberships" on patient_memberships
  for select using (patient_id in (select id from patients where user_id = auth.uid()));

create policy "patients view own account_credits" on account_credits
  for select using (patient_id in (select id from patients where user_id = auth.uid()));
