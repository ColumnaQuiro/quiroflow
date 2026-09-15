-- Sequences: an automation that waits.
--
-- Every rule so far fires and runs to completion in one pass, so nothing is
-- ever "in flight" and there is no state to keep. A welcome drip is the first
-- rule that spans days: three messages now, one tomorrow, one the day after,
-- and it stops the moment the person books. That needs three new things.

-- 1. A trigger for a lead arriving.
alter table automation_rules drop constraint automation_rules_trigger_event_check;
alter table automation_rules add constraint automation_rules_trigger_event_check
  check (trigger_event = any (array[
    'appointment.checked_in', 'appointment.booked', 'appointment.completed',
    'appointment.cancelled', 'appointment.no_show', 'appointment.rescheduled',
    'appointment.same_day', 'appointment.hours_before',
    'invoice.paid', 'patient.birthday',
    'membership.new_member', 'membership.removed', 'membership.payment_processed',
    'patient.referred', 'appointment.review_request',
    'lead.created'
  ]));

-- 2. A delay between actions.
--
-- config: { "delay_minutes": 1440 }. Minutes rather than days because the
-- same mechanism should express "20 minutes after they enquire" without a
-- second unit, and the cron ticks every 15 so that is the floor -- a shorter
-- delay is honoured as "next tick", not as the number asked for. Anything
-- needing true sub-minute spacing belongs inside one step, sent back to
-- back, not as a delay node.
alter table automation_actions drop constraint automation_actions_action_type_check;
alter table automation_actions add constraint automation_actions_action_type_check
  check (action_type in ('whatsapp_template', 'email', 'webhook', 'delay'));

-- 3. Where a lead has got to in a sequence.
--
-- One row per (rule, lead), created when the sequence starts and carrying
-- the position of the next action plus when to run it. The cron picks up
-- whatever is due. Leads only for now: patients have no multi-day rule yet,
-- and a nullable target column with a check constraint would be speculative
-- generality for a case that does not exist.
create table automation_sequence_runs (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  rule_id uuid not null references automation_rules(id) on delete cascade,
  lead_id uuid not null references leads(id) on delete cascade,

  -- The next action to run, by automation_actions.position.
  next_position integer not null default 0,
  resume_at timestamptz not null default now(),

  status text not null default 'running'
    check (status in ('running', 'done', 'cancelled')),
  -- Why it stopped early, in words, so the drawer can say "stopped: became a
  -- patient" rather than leaving someone to guess why four messages became
  -- one.
  stopped_reason text,

  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One run per lead per rule, ever. Re-triggering cannot restart a drip
-- somebody already received, which is the failure that would look worst from
-- the patient's side.
create unique index automation_sequence_runs_rule_lead_idx
  on automation_sequence_runs (rule_id, lead_id);
create index automation_sequence_runs_due_idx
  on automation_sequence_runs (resume_at) where status = 'running';
create index automation_sequence_runs_account_idx
  on automation_sequence_runs (account_id);

alter table automation_sequence_runs enable row level security;

-- Read-only to staff: these rows are written by the cron under the service
-- role, and nothing a person does should edit where someone is in a drip.
create policy "staff read automation_sequence_runs" on automation_sequence_runs
  for select using (is_account_member(account_id));

create or replace function automation_sequence_runs_touch_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger automation_sequence_runs_touch_updated_at
  before update on automation_sequence_runs
  for each row
  execute function automation_sequence_runs_touch_updated_at();
