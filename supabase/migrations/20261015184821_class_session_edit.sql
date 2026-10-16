-- Editing a group class after it is on the calendar (follow-up to
-- 20261015161028_group_classes.sql): its day and time, room, who gives it,
-- and its places.
--
-- A class's places are appointments that keep their session's time,
-- practitioner and room (appointments_class_place). So when the session
-- changes, every live place has to change with it, including places in a
-- practitioner's diary the editor cannot themselves write to -- hence a
-- trigger, security definer, rather than the page updating each place.
--
-- A change of time is a reschedule like any other: each place is marked
-- rescheduled and gets an appointment_reschedules row (the calendar's
-- "moved" marker, the visit's history), and resetting its reminders is
-- reset_reminders_on_reschedule's job as it is for any visit. Telling the
-- patients is the page's, firing appointment.rescheduled per place, as the
-- calendar does when it moves a visit.
--
-- And the places cannot go below the people already in it.

create or replace function public.class_sessions_guard_capacity()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_taken int;
begin
  if new.capacity < old.capacity then
    select count(*) into v_taken from appointments
    where class_session_id = new.id and status <> 'cancelled' and deleted_at is null;
    if new.capacity < v_taken then
      raise exception '% people already have a place in this class', v_taken using errcode = '22023';
    end if;
  end if;
  return new;
end;
$$;
create trigger class_sessions_guard_capacity before update of capacity on public.class_sessions
  for each row execute function public.class_sessions_guard_capacity();

create or replace function public.class_sessions_move_places()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_member uuid;
begin
  if (new.starts_at, new.ends_at, new.practitioner_id, new.room_id) is not distinct from (old.starts_at, old.ends_at, old.practitioner_id, old.room_id) then
    return new;
  end if;
  select tm.id into v_member from team_members tm
  where tm.account_id = new.account_id and tm.user_id = auth.uid() and tm.deleted_at is null;

  if new.starts_at is distinct from old.starts_at then
    insert into appointment_reschedules (account_id, appointment_id, from_starts_at, to_starts_at, created_by)
    select a.account_id, a.id, old.starts_at, new.starts_at, v_member
    from appointments a
    where a.class_session_id = new.id and a.status = 'booked' and a.deleted_at is null;
  end if;

  -- The values themselves come from the session (appointments_class_place);
  -- writing them here is what makes that trigger run.
  update appointments a
  set starts_at = new.starts_at,
      ends_at = new.ends_at,
      practitioner_id = new.practitioner_id,
      room_id = new.room_id,
      rescheduled = a.rescheduled or new.starts_at is distinct from old.starts_at
  where a.class_session_id = new.id and a.status <> 'cancelled' and a.deleted_at is null;
  return new;
end;
$$;
create trigger class_sessions_move_places after update of starts_at, ends_at, practitioner_id, room_id on public.class_sessions
  for each row execute function public.class_sessions_move_places();
