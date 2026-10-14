-- A task for the front desk when a patient asks to change a visit, closed by
-- the calendar itself once the visit moves.
--
-- A patient tapped "Cambiar cita" on her reminder, a person agreed a new day
-- with her in the chat, and nobody moved the visit: the reminders kept coming
-- for the old day, and it was marked a no-show. The request was on record
-- (confirmation_status = 'reschedule_requested') and showed as a flag on the
-- calendar, which is easy to read past. A task in Mi día is not: it stays
-- there until the visit is moved, cancelled or done.

-- Not a foreign key, on purpose. staff_tasks already has one to the patient,
-- so a second one to the visit would make PostgREST read staff_tasks as a
-- junction between the two -- and every existing patients <->
-- appointments embed (useAppointmentFacts, the invoice pages) would fail with
-- PGRST201 "more than one relationship" the moment this applied.
-- Appointments are soft-deleted, and the trigger below closes the task then.
alter table public.staff_tasks
  add column if not exists appointment_id uuid;

create index if not exists staff_tasks_open_appointment_idx
  on public.staff_tasks (appointment_id) where appointment_id is not null and done_at is null;

comment on column public.staff_tasks.appointment_id is
  'The visit the task is about; the task closes itself when that visit is moved, cancelled or otherwise leaves "booked"';

-- Who answers patients: the role with Inbox access whose people are not the
-- account's administrators (Front Desk), or failing that any role with Inbox
-- access that has someone in it (the owner, in a one-person clinic).
create or replace function public.inbox_task_role_id(p_account_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select r.id
    from account_roles r
   where r.account_id = p_account_id
     and coalesce((r.permissions ->> 'inbox_access')::boolean, false)
     and exists (select 1 from team_members tm where tm.role_id = r.id and tm.deleted_at is null)
   order by coalesce((r.permissions ->> 'team_admin')::boolean, false), r.created_at
   limit 1
$$;

revoke execute on function public.inbox_task_role_id(uuid) from public, anon, authenticated;
grant execute on function public.inbox_task_role_id(uuid) to service_role;

-- The task's wording: "Cambiar la cita del 13/10 a las 17:45 (lo pidió el paciente)".
create or replace function public.change_request_task_title(p_starts_at timestamptz, p_clinic_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select 'Cambiar la cita del '
    || to_char(p_starts_at at time zone coalesce((select c.timezone from clinics c where c.id = p_clinic_id), 'Europe/Madrid'), 'DD/MM "a las" HH24:MI')
    || ' (lo pidió el paciente)'
$$;

revoke execute on function public.change_request_task_title(timestamptz, uuid) from public, anon, authenticated;

-- Definer: whoever moves the visit (an owner, the receptionist, the booking
-- page) may not be the task's assignee, and RLS would quietly refuse them the
-- update; and nobody has an insert policy on staff_tasks at all.
create or replace function public.appointment_change_request_task()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role uuid;
begin
  if tg_op = 'UPDATE'
     and (new.starts_at is distinct from old.starts_at
          or new.status is distinct from old.status
          or new.deleted_at is distinct from old.deleted_at) then
    update staff_tasks set done_at = now() where appointment_id = new.id and done_at is null;
  end if;

  if new.confirmation_status = 'reschedule_requested'
     and (tg_op = 'INSERT' or old.confirmation_status is distinct from 'reschedule_requested')
     and new.status = 'booked'
     and new.deleted_at is null
     and new.starts_at > now()
     and not exists (select 1 from staff_tasks t where t.appointment_id = new.id and t.done_at is null) then
    v_role := inbox_task_role_id(new.account_id);
    if v_role is not null then
      insert into staff_tasks (account_id, role_id, patient_id, appointment_id, title, due_at)
      values (new.account_id, v_role, new.patient_id, new.id,
              change_request_task_title(new.starts_at, new.clinic_id),
              least(new.starts_at, now() + interval '4 hours'));
    end if;
  end if;
  return new;
end;
$$;

revoke execute on function public.appointment_change_request_task() from public, anon, authenticated;

drop trigger if exists appointments_change_request_task on public.appointments;
create trigger appointments_change_request_task
  after insert or update of confirmation_status, starts_at, status, deleted_at on public.appointments
  for each row execute function public.appointment_change_request_task();

-- The requests already waiting.
insert into staff_tasks (account_id, role_id, patient_id, appointment_id, title, due_at)
select a.account_id, inbox_task_role_id(a.account_id), a.patient_id, a.id,
       change_request_task_title(a.starts_at, a.clinic_id),
       least(a.starts_at, now() + interval '4 hours')
  from appointments a
 where a.confirmation_status = 'reschedule_requested'
   and a.status = 'booked'
   and a.deleted_at is null
   and a.starts_at > now()
   and inbox_task_role_id(a.account_id) is not null
   and not exists (select 1 from staff_tasks t where t.appointment_id = a.id and t.done_at is null);
