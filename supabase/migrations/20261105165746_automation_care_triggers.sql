-- Two more triggers (utils/automationCatalog.ts), both found by the
-- 15-minute lead-sequence tick (server/utils/automationTriggers.ts) -- no new
-- cron to schedule:
--
--   care_plan.milestone  a completed visit that is the one before a re-exam on
--                        the patient's care plan, its last visit, or visit N;
--                        claimed once per (rule, visit) in automation_rule_sends.
--   bono.running_low     a session used that leaves a bono with N or fewer;
--                        claimed once per (rule, bono) in automation_bono_sends.
--
-- The list restates 20261105162852_automation_event_triggers's, plus these two.

alter table public.automation_rules drop constraint automation_rules_trigger_event_check;
alter table public.automation_rules add constraint automation_rules_trigger_event_check
  check (trigger_event = any (array[
    'appointment.checked_in', 'appointment.booked', 'appointment.completed', 'appointment.cancelled',
    'appointment.no_show', 'appointment.rescheduled', 'appointment.same_day', 'appointment.hours_before',
    'invoice.paid', 'invoice.overdue', 'patient.birthday', 'membership.new_member', 'membership.removed',
    'membership.payment_processed', 'patient.referred', 'appointment.review_request', 'appointment.satisfaction',
    'lead.created', 'waitlist.slot_offered', 'segment',
    'satisfaction.answered', 'patient.tag_added', 'patient.tag_removed', 'doc.completed', 'lead.stage_changed',
    'care_plan.milestone', 'bono.running_low'
  ]));

create table public.automation_bono_sends (
  rule_id uuid not null references public.automation_rules(id) on delete cascade,
  purchase_id uuid not null references public.package_purchases(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  sent_at timestamptz not null default now(),
  primary key (rule_id, purchase_id)
);
create index automation_bono_sends_purchase_idx on public.automation_bono_sends (purchase_id);
create index automation_bono_sends_account_idx on public.automation_bono_sends (account_id);

-- RLS with no policy for staff: the service role is the only reader and writer.
alter table public.automation_bono_sends enable row level security;
select public.require_two_factor_on('public.automation_bono_sends');
select public.grant_data_api('public.automation_bono_sends');
