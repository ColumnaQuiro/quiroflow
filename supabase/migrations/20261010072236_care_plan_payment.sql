-- How a care plan is paid, linked to what the clinic already sells rather
-- than a new way of charging (PracticeHub's "How they pay"): visit by visit
-- at the normal prices, from a bono, or under a membership. The bono or
-- membership is the patient's own existing one; its money -- invoices,
-- payments, what is owed -- stays exactly where it is, and nothing reads a
-- balance from here. The plan only says which one pays for it, so the plan
-- card can show it and whether the bono covers the visits left.
--
-- Plain ids, deliberately NOT foreign keys. care_plans already references
-- patients; a foreign key to package_purchases (or patient_memberships) as
-- well would make PostgREST read care_plans as a link table between patients
-- and those, and every existing embed of a bono's patient -- or a patient's
-- bonos -- would turn ambiguous (PGRST201) the moment this applied, against
-- the release already live. The plan card says so plainly when the bono or
-- membership it names no longer exists.
--
-- Additive. Every existing plan is 'per_visit', which is what it was.
alter table public.care_plans
  add column payment_kind text not null default 'per_visit' check (payment_kind in ('per_visit', 'bono', 'membership')),
  add column package_purchase_id uuid,
  add column patient_membership_id uuid;
