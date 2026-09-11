-- A patient's appointment could not tell them what it was for, or who with.
--
-- appointments has had "patients view own appointments" since 0162, but the
-- two things the row points at -- its appointment_type and its practitioner
-- -- are staff-only, so the join in every patient-facing appointment list
-- came back null and the UI fell back to the word "Appointment". On
-- production that is 1,284 of 1,292 recent appointments showing as an
-- unnamed "Cita", with no practitioner, in both the portal and the app.
--
-- Both policies are scoped through the patient's OWN appointments, so this
-- exposes a clinic's service catalogue and staff list one row at a time,
-- and only for a visit that patient actually has. Neither table holds
-- contact details (team_members is name/role/colour/hours/photo), and a
-- practitioner's name and photo are already public on the booking page via
-- get_public_booking_info.

create policy "patients read types of own appointments" on appointment_types
for select to authenticated
using (
  exists (
    select 1 from appointments a
    join patients p on p.id = a.patient_id
    where a.appointment_type_id = appointment_types.id
      and p.user_id = auth.uid()
  )
);

create policy "patients read practitioners of own appointments" on team_members
for select to authenticated
using (
  exists (
    select 1 from appointments a
    join patients p on p.id = a.patient_id
    where a.practitioner_id = team_members.id
      and p.user_id = auth.uid()
  )
);
