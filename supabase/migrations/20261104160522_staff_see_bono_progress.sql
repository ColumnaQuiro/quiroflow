-- Every member of the clinic may READ a patient's bonos and memberships, the
-- same way they read the patient's invoices and bono sessions; changing them
-- still needs billing_config or packages_edit.
--
-- 20260925074722 gave "staff manage package_purchases" (FOR ALL) those two
-- permissions, which narrowed reading along with writing. A practitioner
-- holds neither, so every select of a bono came back empty -- not an error --
-- while package_sessions (readable by patient scope since 0155) still said
-- the visit had been drawn from one. The calendar then read the missing bono
-- as zero: "Bono 0/0" on the block, "quedan 0 de 0" in the visit panel, "un
-- bono que ya no existe" on the care plan. The practitioner cannot tell
-- whether the patient has sessions left, which is the thing they asked to
-- follow.
--
-- A second, SELECT-only policy rather than loosening the FOR ALL one:
-- permissive policies OR together for reading, while insert, update and
-- delete still go through "staff manage ..." alone and keep its permissions.
--
-- Scoped like "staff select invoices" (0143) and "staff select
-- package_sessions" (0155): all patients for an all-scope role, otherwise
-- the patients they treat. A shared bono belongs to the purchaser, so for an
-- own-scope role it is also visible through a beneficiary they treat --
-- that is whose visits draw from it. The price comes with the row; invoices,
-- readable under the same scope, already say what was charged.
--
-- The restrictive "two factor when required" policy (20260923174910) already
-- covers both tables and applies to this policy like any other.

create policy "staff view package_purchases" on public.package_purchases
for select using (
  account_id in (select public.my_member_account_ids())
  and (
    account_id in (select public.my_all_patient_scope_accounts())
    or (account_id, patient_id) in (select * from public.my_own_patient_access())
    or id in (
      select s.package_purchase_id from public.package_purchase_shares s
      where (s.account_id, s.patient_id) in (select * from public.my_own_patient_access())
    )
  )
);

create policy "staff view patient_memberships" on public.patient_memberships
for select using (
  account_id in (select public.my_member_account_ids())
  and (
    account_id in (select public.my_all_patient_scope_accounts())
    or (account_id, patient_id) in (select * from public.my_own_patient_access())
  )
);
