-- A patient's answer to a reminder is for the time they were asked about.
--
-- appointments.confirmation_status holds it: 'confirmed' from the reminder's
-- Confirmar button (or staff, or the patient app), 'reschedule_requested'
-- when they asked to change it. Nothing cleared it when the visit then moved,
-- so a visit confirmed for Tuesday and moved to Thursday still read as
-- confirmed -- for a Thursday nobody had confirmed -- and one the patient
-- asked to change kept asking to be changed after the clinic had changed it.
--
-- That mattered little while it was only a badge. Reminder automations now
-- pass over a visit whose patient already answered (hours-before-cron), so a
-- stale answer would silence the reminders for the new time. Moving a visit
-- therefore clears its answer, unless the same update sets one -- a patient
-- rebooking themselves and confirming in one step keeps theirs.

create or replace function public.appointments_answer_is_for_its_time()
returns trigger
language plpgsql
as $function$
begin
  if new.starts_at is distinct from old.starts_at
     and new.confirmation_status is not distinct from old.confirmation_status then
    new.confirmation_status := null;
  end if;
  return new;
end;
$function$;

create trigger appointments_answer_is_for_its_time
  before update of starts_at on public.appointments
  for each row execute function public.appointments_answer_is_for_its_time();
