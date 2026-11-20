-- create_public_booking timed out once on 19 Nov 2026 (JAVASCRIPT-NUXT-19:
-- 57014, "canceling statement due to statement timeout"). It runs as anon,
-- whose statement_timeout is 3 s, and on its way to the insert it does one
-- piece of work that grows with the clinic's whole history rather than with
-- the booking:
--
-- appointments_online_booking_ceiling (20261017165330) counts the clinic's
-- online bookings from the last ten minutes before every online insert:
--
--   select count(*) from appointments
--   where account_id = $1 and source = 'online'
--     and created_at > now() - interval '10 minutes';
--
-- No index leads with account_id and covers created_at, so that count visits
-- every appointment the account has ever had -- every visit imported from
-- PracticeHub included -- to find the few made in the last ten minutes. Warm,
-- that is milliseconds; on a cold cache it is a read of the table's heap
-- inside a 3 s budget. This index makes it a range scan over a handful of
-- rows. It is partial, so only online bookings carry its cost.
--
-- Not proven to be the whole cause from a single event (the per-practitioner
-- advisory lock is the other candidate, and it only waits on another
-- booking for the same practitioner, which then has to be slow itself).
-- It is the one part of the function that scales with history.
create index if not exists appointments_online_created_idx
  on public.appointments (account_id, created_at)
  where source = 'online';
