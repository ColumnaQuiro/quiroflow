-- The clinic's "new online booking" alert is claimed once, on its own.
--
-- It used to ride on auto_confirmation_claimed_at, the claim for the
-- PATIENT's confirmation, and the first claim was made by a second request
-- the booking page fired after the booking, on its way to a thank-you
-- redirect. The navigation cancelled that request whenever it had not left
-- yet: six of Columnaquiro's sixteen online bookings between 21 and 28 Sep
-- 2026 alerted nobody, and since 30 Sep the reminders cron has caught them up
-- to fifteen minutes late.
--
-- The booking is now made through /api/public-booking/book, which alerts the
-- clinic before it answers. The confirmation endpoint and the cron's
-- catch-up still try, for the patient app's bookings and anything booked
-- around the page, and this column is what keeps the three from alerting
-- twice:
--
--   update appointments set staff_alert_claimed_at = now()
--   where id = $1 and staff_alert_claimed_at is null
--
-- No backfill. The cron only offers the alert for a booking whose patient
-- confirmation it is itself claiming, so a booking the previous code already
-- handled (auto_confirmation_claimed_at set) is never alerted again.
alter table public.appointments add column staff_alert_claimed_at timestamptz;

comment on column public.appointments.staff_alert_claimed_at is
  'When the clinic''s "new online booking" alert for this appointment was claimed. Set once; a second claim finds it set and alerts nobody.';
