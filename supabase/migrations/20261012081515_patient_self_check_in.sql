-- "Ya estoy aquí": a patient checks themselves in on arrival, from the app or
-- the web portal (a QR code at the desk opens /portal/check-in).
--
-- Sets appointments.checked_in_at, the same column the desk's "Mark as
-- arrived" sets, so My Day, the calendar and the flow tracker show it without
-- knowing who did it. Run as the patient: their own visit only, still booked,
-- not deleted, and only around it -- from 90 minutes before the start until
-- it ends -- so it cannot be pressed from home the night before. Twice is
-- harmless: an arrival already recorded is kept, not moved.
--
-- Returns the arrival time, or null when there is nothing to check in to.
-- The push to the practitioner and the appointment.checked_in automations run
-- after it, on the server (/api/portal/appointments/check-in).
create or replace function public.check_in_my_appointment(p_appointment_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_at timestamptz;
begin
  if not public.mfa_satisfied() then
    raise exception 'Two-factor authentication required';
  end if;
  update public.appointments a
  set checked_in_at = coalesce(a.checked_in_at, now())
  from public.patients p
  where a.id = p_appointment_id
    and p.id = a.patient_id
    and p.user_id = auth.uid()
    and a.status = 'booked'
    and a.deleted_at is null
    and now() >= a.starts_at - interval '90 minutes'
    and now() <= a.ends_at
  returning a.checked_in_at into v_at;
  return v_at;
end;
$$;

revoke all on function public.check_in_my_appointment(uuid) from public, anon;
grant execute on function public.check_in_my_appointment(uuid) to authenticated;
