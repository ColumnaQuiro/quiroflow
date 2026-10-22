-- Which appointment type the AI receptionist offers someone coming back after
-- a long break (utils/patientReplyPrompt.ts, returningPatientSection).
--
-- From the daily review of 21 Oct 2026: a patient last seen a year ago,
-- answering the six-month reactivation recall ("tenemos la visita de
-- reactivación con chequeo postural incluido"), was offered a report visit --
-- the type of their last visit, which is what the prompt says "otra cita"
-- means. Nothing told it which type is the reactivation: Columnaquiro's
-- "Reactivación paciente" has the stage 'revision', like two other types,
-- and the stage also drives the Statistics report, so it cannot be
-- repurposed for this. The clinic names it here instead, in Growth >
-- Receptionist > Booking rules.
--
-- Null, as every clinic starts: nothing changes for them.
--
-- No foreign key, deliberately. receptionist_config already points at
-- accounts, and a second key to appointment_types would make it a link table
-- between the two to PostgREST, which then refuses embeds it used to resolve
-- (check:migration-compatibility lists forty). The id is checked against the
-- account's active types when it is saved (config.put.ts), and read only
-- when it is among the types the receptionist offers -- an archived or
-- deleted type is ignored, as if unset.

alter table public.receptionist_config
  add column reactivation_appointment_type_id uuid;
