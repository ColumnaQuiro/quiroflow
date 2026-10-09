-- The patient app's daily "¿Has hecho tus ejercicios hoy?" push, which the
-- patient switches on and times themselves on their Ejercicios screen. Sent
-- from the same-day cron (server/utils/exerciseReminders.ts) in the hour
-- they chose, in their clinic's time zone, once a day, and only while
-- something assigned is still undone today.
--
--   exercise_reminder_hour   0-23, or null for off (the default)
--   exercise_reminded_on     the clinic day it last went out, so the cron's
--                            15-minute ticks inside that hour send it once
alter table public.patients
  add column if not exists exercise_reminder_hour smallint check (exercise_reminder_hour is null or exercise_reminder_hour between 0 and 23),
  add column if not exists exercise_reminded_on date;

-- The patient's own switch, on every record of theirs (a person can be a
-- patient at more than one clinic). Patients have no write on patients.
create or replace function public.set_my_exercise_reminder(p_hour integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.mfa_satisfied() then
    raise exception 'Two-factor authentication required';
  end if;
  if p_hour is not null and (p_hour < 0 or p_hour > 23) then
    raise exception 'Hour must be between 0 and 23';
  end if;
  update public.patients set exercise_reminder_hour = p_hour where user_id = auth.uid();
  return found;
end;
$$;

revoke all on function public.set_my_exercise_reminder(integer) from public, anon;
grant execute on function public.set_my_exercise_reminder(integer) to authenticated;
