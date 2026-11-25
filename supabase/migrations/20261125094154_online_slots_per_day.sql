-- How many times a type shows per day on the booking page.
--
-- A clinic coming from another booking tool had first visits set to "3
-- available slots per day": of every free time, the page showed three, so
-- the diary looks in demand rather than empty. Nothing here could say that.
-- online_booking_windows (20261122184746) narrows WHEN a type is offered; this
-- narrows HOW MANY of the free times within that are shown.
--
-- appointment_types.online_slots_per_day: null, the default and every row
-- today, shows every free time as before. Otherwise the booking page shows
-- that many per day, spread across it (utils/bookingSlots.ts,
-- spreadDaySlots). Once one is booked the next free time takes its place, so
-- it limits what is SHOWN, not how many are booked.
--
-- NOT ENFORCED BY THE DATABASE, deliberately. Every time the page leaves out
-- is a free, valid time the clinic works; booking one directly through the
-- RPC harms nothing, and refusing it would need the same "which N" choice
-- restated in SQL, where the two could drift. Staff, the API, the waitlist,
-- the AI receptionist and the patient app are not affected.
--
-- No new table and no patient_id; trg_audit_appointment_types records the
-- change like any other column of the type.

alter table public.appointment_types
  add column if not exists online_slots_per_day integer;

alter table public.appointment_types
  drop constraint if exists appointment_types_online_slots_per_day_check;
alter table public.appointment_types
  add constraint appointment_types_online_slots_per_day_check
  check (online_slots_per_day is null or online_slots_per_day between 1 and 24);

-- What the booking page reads beside get_appointment_type_booking_windows,
-- rather than by restating that function (the patient app calls it too) or
-- get_public_booking_info. Anon's, like the booking page: one number per
-- type that is offered online and has one.
create or replace function public.get_appointment_type_slots_per_day(p_type_ids uuid[])
returns table(appointment_type_id uuid, online_slots_per_day integer)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select t.id, t.online_slots_per_day
  from appointment_types t
  where t.id = any(p_type_ids)
    and t.online_booking_enabled
    and t.archived_at is null
    and t.online_slots_per_day is not null;
$function$;

revoke all on function public.get_appointment_type_slots_per_day(uuid[]) from public;
grant execute on function public.get_appointment_type_slots_per_day(uuid[]) to anon, authenticated, service_role;
