-- When the patient answered, so a reminder knows whether the answer was to a
-- reminder.
--
-- Reminder automations pass over a visit the patient has already answered
-- (confirmed, or asked to change: 20261013153850_appointments_answer_is_for_its_time),
-- so a 24-hour reminder does not ask again what the 3-day one got an answer
-- to. But the message sent when a visit is BOOKED carries the same Confirmar
-- button, and a patient who taps it then was never reminded at all -- of a
-- visit two or three weeks away. 47 confirmed visits went unreminded between
-- 19 and 22 Oct 2026, and six of those patients did not come.
--
--   appointments.confirmation_answered_at   when confirmation_status last
--                                           became an answer; null when it
--                                           is not one
--
-- The crons compare it with the reminders already sent for the visit: an
-- answer given after one of them was an answer to a reminder; one given
-- before any was not, and the reminders go out.

alter table public.appointments
  add column if not exists confirmation_answered_at timestamptz;

create or replace function public.appointments_confirmation_answered_at()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if tg_op = 'INSERT' or new.confirmation_status is distinct from old.confirmation_status then
    new.confirmation_answered_at := case
      when new.confirmation_status in ('confirmed', 'reschedule_requested') then now()
      else null
    end;
  end if;
  return new;
end;
$function$;

revoke all on function public.appointments_confirmation_answered_at() from public, anon, authenticated;

-- No column list: appointments_answer_is_for_its_time clears the status on a
-- move from its own BEFORE trigger, which an "update of confirmation_status"
-- trigger would not see. Trigger names fire in alphabetical order, so this one
-- ("..._confirmation_...") runs after that one ("..._answer_...") and reads the
-- cleared status.
drop trigger if exists appointments_confirmation_answered_at on public.appointments;
create trigger appointments_confirmation_answered_at
  before insert or update on public.appointments
  for each row execute function public.appointments_confirmation_answered_at();

-- Upcoming visits already answered. Nothing recorded the time until now (the
-- audit trail leaves confirmation_status out), so it is read from WhatsApp:
-- the first message the patient sent after the visit's first reminder, which
-- is the Confirmar tap or the request to change it. With no reminder before
-- the answer it stays null, and those visits are reminded as they should
-- have been.
update public.appointments a
   set confirmation_answered_at = answered.at
  from (
    select ap.id,
           (select min(i.created_at)
              from public.whatsapp_messages i
             where i.patient_id = ap.patient_id
               and i.direction = 'inbound'
               and i.created_at > r.first_reminder) as at
      from public.appointments ap
      join lateral (
        select min(m.created_at) as first_reminder
          from public.whatsapp_messages m
         where m.appointment_id = ap.id
           and m.direction = 'outbound'
           and m.purpose = 'reminder'
      ) r on r.first_reminder is not null
     where ap.starts_at > now()
       and ap.status = 'booked'
       and ap.confirmation_status in ('confirmed', 'reschedule_requested')
  ) answered
 where a.id = answered.id
   and answered.at is not null;
