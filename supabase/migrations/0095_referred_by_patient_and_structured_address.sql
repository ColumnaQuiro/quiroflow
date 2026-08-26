-- "Referred by a patient" -- same self-referencing shape as tutor_patient_id
-- (0063_patient_status_minor_tutor_dnc.sql), so the referrer's profile can
-- show a reverse "Referred patients" list.
alter table patients add column referred_by_patient_id uuid references patients(id) on delete set null;
create index patients_referred_by_idx on patients (referred_by_patient_id) where referred_by_patient_id is not null;

-- Seeds the "Patient" referral source option for every existing account --
-- the UI shows the referrer-search field specifically when this option is
-- selected, so it needs to exist rather than requiring staff to add it
-- manually via Settings -> Referral Sources first.
insert into referral_sources (account_id, name)
select id, 'Patient' from accounts
on conflict (account_id, name) do nothing;

-- Structured address fields, added alongside (not replacing) the existing
-- free-text `address` column -- existing patient data in that column can't
-- be safely auto-split into street/city/postal without risking misplaced
-- data, so it stays as the "street address" line and these are new.
alter table patients add column postal_code text;
alter table patients add column city text;
alter table patients add column country text;
