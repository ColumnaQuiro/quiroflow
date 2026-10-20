-- How long before a visit a patient's reminder goes out, per patient.
--
-- Clinics set one number for everyone (Settings > Messages, 1-168 hours).
-- Patients do not all want the same: some want it two hours before, some the
-- day before, and the front desk ends up phoning the first kind by hand.
--
--   patients.appointment_reminder_hours_before   1-168, or null for the
--                                                clinic's own setting
--
-- On patients itself, so merge_patients has nothing to move: the survivor
-- keeps its own choice.
alter table public.patients
  add column if not exists appointment_reminder_hours_before smallint
    check (appointment_reminder_hours_before is null or appointment_reminder_hours_before between 1 and 168);

-- Once the number can differ per patient, and change under an appointment
-- that is already booked, "is this appointment passing through its reminder
-- window right now" stops being a safe test. Lower it after the reminder went
-- out and the appointment passes through a second window; raise it and the
-- new window is already behind it. The cron now reminds from N hours before
-- onwards, once per appointment time, and this is what says "once":
--
--   appointments.reminder_claimed_at   the cron has dealt with this
--                                      appointment's reminder (sent it, or
--                                      decided not to) for the time it is at
--
-- reminder_sent_at cannot do that job. It is kept when an appointment moves,
-- because the panel's History tab is built from it
-- (20260928110512_reset_reminders_on_reschedule.sql), so it can belong to a
-- time the appointment has left. The claim can be cleared on a move, and is.
alter table public.appointments
  add column if not exists reminder_claimed_at timestamptz;

create or replace function public.appointment_reminder_claim_follows_time()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Moved: the reminder for the old time said nothing about the new one.
  if tg_op = 'UPDATE' and new.starts_at is distinct from old.starts_at then
    new.reminder_claimed_at := null;
  end if;
  -- A reminder recorded by anything that does not claim first: the cron as
  -- deployed until the release that ships this (it runs against this schema
  -- from the moment the migration applies), the importer, test seeds. Without
  -- this, every appointment reminded in that gap would read as unreminded to
  -- the new cron and be reminded again.
  if new.reminder_sent_at is not null
     and new.reminder_claimed_at is null
     and (tg_op = 'INSERT' or new.reminder_sent_at is distinct from old.reminder_sent_at) then
    new.reminder_claimed_at := new.reminder_sent_at;
  end if;
  return new;
end;
$$;

revoke all on function public.appointment_reminder_claim_follows_time() from public, anon, authenticated;

drop trigger if exists appointment_reminder_claim_follows_time on public.appointments;
create trigger appointment_reminder_claim_follows_time
  before insert or update of starts_at, reminder_sent_at on public.appointments
  for each row execute function public.appointment_reminder_claim_follows_time();

-- Upcoming appointments already reminded for the time they are at: the
-- reminder went out no earlier than the clinic's lead before it (plus an hour
-- of slack for the old window, which sent up to twenty minutes early). One
-- sent earlier than that was for an earlier time the appointment has since
-- been moved from, and stays unclaimed, so the new time is reminded.
-- Past appointments are left alone; the cron never looks at them.
update public.appointments a
   set reminder_claimed_at = a.reminder_sent_at
  from public.accounts acc
 where acc.id = a.account_id
   and a.reminder_claimed_at is null
   and a.reminder_sent_at is not null
   and a.starts_at > now()
   and a.reminder_sent_at >= a.starts_at - make_interval(hours => acc.appointment_reminder_hours_before) - interval '1 hour';
