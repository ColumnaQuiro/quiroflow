-- A reminder when a handover sits unanswered. The receptionist already pushes
-- the team and leaves a task in Mi día, due two hours later, when it passes a
-- conversation to a person (server/utils/receptionistSend.ts). A push is gone
-- once it is swiped away and a task is only seen by whoever opens Mi día, so
-- a patient told "mi compañera te comentará en breve" could still be waiting
-- at closing time. handover-reminder-cron pushes once more when the task is
-- overdue and nobody has written in the conversation since.
--
-- Additive only: two columns on staff_tasks, no new patient_id (so nothing to
-- add to merge_patients) and no new table (so no RLS or two-factor line).

alter table public.staff_tasks
  add column if not exists receptionist_handover boolean not null default false,
  add column if not exists reminded_at timestamptz;

comment on column public.staff_tasks.receptionist_handover is
  'Written by the AI receptionist when it handed the conversation to a person (handoverTask).';
comment on column public.staff_tasks.reminded_at is
  'When handover-reminder-cron last dealt with it: reminded the team, or found a person had already replied.';

-- The handover tasks written before this column existed, so the ones still
-- open get their reminder too. Only handoverTask writes this title with no
-- rule or run behind it.
update public.staff_tasks
   set receptionist_handover = true
 where rule_id is null
   and run_id is null
   and title like 'Responder a %';

-- What the cron reads: open handover tasks it has not dealt with yet.
create index if not exists staff_tasks_handover_due_idx
  on public.staff_tasks (due_at)
  where receptionist_handover and done_at is null and reminded_at is null;
