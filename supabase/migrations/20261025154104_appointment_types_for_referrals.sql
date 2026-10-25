-- A first visit only for someone a patient referred (Columnaquiro's
-- "Primera Visita Referido"). The AI receptionist never offers it on its own:
-- only to someone who names the patient who referred them, or to someone new
-- the person writing brings, who is referred by them -- and it records the
-- referral on the new patient's record (referral_source 'Patient',
-- referred_by_patient_id), as the desk does by hand.
alter table appointment_types add column for_referrals boolean not null default false;

comment on column appointment_types.for_referrals is 'Only for someone a patient referred. The AI receptionist offers it only once the referring patient is named, and records the referral.';
