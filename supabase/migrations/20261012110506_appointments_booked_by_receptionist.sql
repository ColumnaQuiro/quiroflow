-- A visit the AI receptionist booked or moved on its own
-- (server/utils/receptionistBooking.ts), told apart from the booking page
-- ('online'), the API, the waitlist and staff -- so reports can count them,
-- and the clinic can find them.
alter table public.appointments drop constraint if exists appointments_source_check;
alter table public.appointments add constraint appointments_source_check
  check (source in ('staff', 'online', 'api', 'waitlist', 'receptionist'));
