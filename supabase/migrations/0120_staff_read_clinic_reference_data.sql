-- migration 0041 gated clinics/appointment_types/calendar_resources entirely behind the
-- clinic_config permission (owner-only by default), including SELECT. Any non-owner staff
-- member (e.g. a Front Desk or Practitioner role) can then read zero rows from these tables,
-- which breaks the Calendar and Dashboard for them (no clinics -> no currentClinicId -> "No
-- practitioners are assigned to this clinic yet" and stuck loading states) even though they
-- were never trying to edit clinic settings, just use the calendar. Add permissive read-only
-- policies scoped to plain account membership; the existing policies still gate writes.

create policy "staff read clinics" on clinics
  for select using (is_account_member(account_id));

create policy "staff read appointment_types" on appointment_types
  for select using (is_account_member(account_id));

create policy "staff read calendar_resources" on calendar_resources
  for select using (is_account_member(account_id));
