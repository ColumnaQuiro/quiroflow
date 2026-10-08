-- The time zone of every clinic a patient may have a visit at.
--
-- The patient app and the portal show a visit at its clinic's hour, not the
-- phone's, and patients cannot read the clinics table -- so the zones came
-- from get_patient_booking_info(), which lists only the clinics taking online
-- bookings. A visit at any other clinic of the account fell back to
-- Europe/Madrid: an hour wrong for a clinic in the Canaries, and the same for
-- a clinic that later stopped taking online bookings, or was archived, with
-- visits still on the patient's history.
--
-- Only the id and the zone, for the accounts the patient belongs to.
create or replace function public.get_my_clinic_timezones()
returns table (clinic_id uuid, timezone text)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, c.timezone
  from public.clinics c
  where c.account_id in (select p.account_id from public.patients p where p.user_id = auth.uid())
    and nullif(c.timezone, '') is not null
    and public.mfa_satisfied()
$$;

revoke all on function public.get_my_clinic_timezones() from public, anon;
grant execute on function public.get_my_clinic_timezones() to authenticated;
