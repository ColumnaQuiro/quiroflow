-- The least notice a patient must give to book online.
--
-- Online booking offers every free slot from the next minute on, so a
-- patient can take 9:30 at 9:25 and the clinic only finds out when they walk
-- in. A clinic coming from PracticeHub had "no online bookings less than 24 h
-- ahead"; nothing here could say that. The furthest ahead
-- (online_booking_max_days_ahead) has always been settable, the nearest not.
--
-- accounts.online_booking_min_notice_hours is that, in hours. 0, the default
-- and every row today, changes nothing.
--
-- WHERE IT IS ENFORCED. The pages stop offering the slots (utils/
-- bookingSlots.ts's notBefore, on the booking page and in the patient app),
-- and the database refuses them, in the same place and for the same callers
-- as the type windows of 20261122184746: assert_booking_slot_open notes the
-- slot an online booking (create_public_booking, create_patient_booking,
-- reschedule_patient_appointment) is about to write, and the trigger below
-- checks that row. Staff bookings, imports, the API, the waitlist and the AI
-- receptionist (which has its own "never before N minutes" rule) never set
-- the note and are not held to it.
--
-- The column is online_booking_%, so accounts_settings_permission already
-- puts it under the Online booking page's permission. No new table, no
-- patient_id; trg_audit_accounts records the change.

alter table public.accounts
  add column if not exists online_booking_min_notice_hours integer not null default 0;

alter table public.accounts
  drop constraint if exists accounts_online_booking_min_notice_hours_check;
alter table public.accounts
  add constraint accounts_online_booking_min_notice_hours_check
  check (online_booking_min_notice_hours between 0 and 720);

-- 20261122184746's trigger, now also holding the slot to the notice. The
-- notice is checked first and for every online booking, with or without a
-- type; the type windows only when there is a type, as before.
create or replace function public.appointments_obey_type_booking_windows()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_notice_hours integer;
begin
  if coalesce(current_setting('quiroflow.online_booking_slot', true), '') = ''
     or current_setting('quiroflow.online_booking_slot', true) <> online_booking_slot_key(new.practitioner_id, new.starts_at) then
    return new;
  end if;

  select a.online_booking_min_notice_hours into v_notice_hours
  from accounts a
  where a.id = new.account_id;
  if coalesce(v_notice_hours, 0) > 0 and new.starts_at < now() + make_interval(hours => v_notice_hours) then
    raise exception 'That time is too soon to book online';
  end if;

  if new.appointment_type_id is not null then
    perform assert_booking_type_window(new.appointment_type_id, new.clinic_id, new.practitioner_id, new.starts_at, new.ends_at);
  end if;
  return new;
end;
$function$;

-- What the booking page and the patient app read, beside the booking info
-- rather than by restating get_public_booking_info / get_patient_booking_info
-- (the reason 20261122184746 gives). Anon's, like the booking page: one
-- number about a clinic's own public booking rules.
create or replace function public.get_online_booking_min_notice(p_clinic_id uuid)
returns integer
language sql
stable
security definer
set search_path to 'public'
as $function$
  select a.online_booking_min_notice_hours
  from clinics c
  join accounts a on a.id = c.account_id
  where c.id = p_clinic_id;
$function$;

revoke all on function public.get_online_booking_min_notice(uuid) from public;
grant execute on function public.get_online_booking_min_notice(uuid) to anon, authenticated;
