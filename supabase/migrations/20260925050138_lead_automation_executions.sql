-- Executions: what a lead automation actually did, step by step.
--
-- automation_sequence_runs knows where a lead has got to in a drip, and
-- nothing else. When a step went wrong there was no trace of it anywhere a
-- person could look: a WhatsApp send Meta refused was written to
-- whatsapp_messages as 'failed' and the drip carried on as if it had gone
-- out; a webhook that errored was dropped with `.catch(() => null)`; a run
-- could end 'done' having delivered nothing. The only way to find out was the
-- server log. n8n, which this replaces, has an Executions tab for exactly
-- this, and moving the drip in-app lost it.
--
-- Two changes:
--
-- 1. automation_run_events -- an append-only history per run. One row per
--    thing that happened: a step sent, skipped (and why), failed (and the
--    error), a wait started, the run deferred, stopped, finished, or retried
--    by a person. The Executions tab is a read of this table.
--
-- 2. A run can now FAIL. A step that errors is retried automatically on the
--    next ticks (the cron runs every 15 minutes) up to a small limit, and
--    after that the run parks as 'failed' at the step that failed, instead of
--    silently moving past it. A person sees it, fixes the cause, and presses
--    Retry, which resumes from that same step -- never from the beginning, so
--    nothing already delivered is sent twice.

alter table automation_sequence_runs drop constraint automation_sequence_runs_status_check;
alter table automation_sequence_runs add constraint automation_sequence_runs_status_check
  check (status in ('running', 'done', 'cancelled', 'failed'));

-- Consecutive failures of the step at next_position. Reset when a step gets
-- through, and by a manual retry.
alter table automation_sequence_runs add column if not exists attempts integer not null default 0;
-- The most recent error or deferral, in words, so the list can say why a run
-- is stuck without opening it.
alter table automation_sequence_runs add column if not exists last_error text;

create index if not exists automation_sequence_runs_failed_idx
  on automation_sequence_runs (account_id) where status = 'failed';

create table if not exists automation_run_events (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  run_id uuid not null references automation_sequence_runs(id) on delete cascade,

  -- The step this is about, by automation_actions.position. Null for events
  -- about the run as a whole (started, stopped, finished, retried).
  position integer,
  -- Copied rather than joined: the rule can be edited or a step deleted
  -- after the fact, and the history has to keep saying what actually ran.
  action_type text,
  step_label text,

  outcome text not null check (outcome in (
    'started',   -- the run began
    'sent',      -- a step delivered
    'dry_run',   -- a step rehearsed under a test-run rule; nothing left
    'skipped',   -- a step deliberately not delivered (no consent, no phone, channel not connected)
    'failed',    -- a step errored; detail says how
    'waiting',   -- a delay started; detail says until when
    'deferred',  -- the run could not decide yet (PracticeHub unreachable)
    'stopped',   -- the run ended early; detail is the reason
    'finished',  -- the run reached its last step
    'retried'    -- a person resumed a failed run
  )),
  detail text,
  -- Who pressed Retry. Null for everything the cron does on its own.
  actor_team_member_id uuid,

  created_at timestamptz not null default now()
);

create index if not exists automation_run_events_run_idx
  on automation_run_events (run_id, created_at);
create index if not exists automation_run_events_account_idx
  on automation_run_events (account_id, created_at desc);

alter table automation_run_events enable row level security;

-- Read-only to staff, like the runs themselves: written by the server under
-- the service role, and a history anyone could edit would not be one.
create policy "staff read automation_run_events" on automation_run_events
  for select using (is_account_member(account_id));

select public.require_two_factor_on('public.automation_run_events');

comment on table automation_run_events is
  'Append-only history of each lead automation run: every step sent, skipped or failed, waits, deferrals, stops and manual retries. Backs Growth > Automations > Executions.';

-- Runs that existed before this have no history. Give each a single line so
-- the Executions tab does not show them as having done nothing at all --
-- honest about the gap rather than pretending to a past it did not record.
insert into automation_run_events (account_id, run_id, outcome, detail, created_at)
select r.account_id, r.id, 'started', 'Started before execution history was recorded; earlier steps are not listed.', r.started_at
from automation_sequence_runs r
where not exists (select 1 from automation_run_events e where e.run_id = r.id);
