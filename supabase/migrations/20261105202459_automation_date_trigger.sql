-- "A date on the record" (patient.date, utils/automationCatalog.ts): N days
-- before or after the last visit, a membership's start, a care plan's start,
-- or a custom date field. Found each clinic day from 09:00 by the 15-minute
-- tick (enrolDateTriggers, server/utils/automationTriggers.ts) -- already
-- scheduled, no new cron.
--
-- The list restates 20261105200149_automation_audience_trigger's, plus this one.

alter table public.automation_rules drop constraint automation_rules_trigger_event_check;
alter table public.automation_rules add constraint automation_rules_trigger_event_check
  check (trigger_event = any (array[
    'appointment.checked_in', 'appointment.booked', 'appointment.completed', 'appointment.cancelled',
    'appointment.no_show', 'appointment.rescheduled', 'appointment.same_day', 'appointment.hours_before',
    'invoice.paid', 'invoice.overdue', 'patient.birthday', 'membership.new_member', 'membership.removed',
    'membership.payment_processed', 'patient.referred', 'appointment.review_request', 'appointment.satisfaction',
    'lead.created', 'waitlist.slot_offered', 'segment',
    'satisfaction.answered', 'patient.tag_added', 'patient.tag_removed', 'doc.completed', 'lead.stage_changed',
    'care_plan.milestone', 'bono.running_low',
    'audience.entered',
    'patient.date'
  ]));

-- One row per (automation, source row, clinic day) started. The source is
-- the visit, membership, care plan or custom-field answer the date came
-- from, deliberately not the patient: the table holds nothing personal, so
-- merge_patients and anonymize_patient have nothing to move or remove here,
-- and no foreign key, since the source can be any of four tables.
-- Written only by the tick (service role).
create table public.automation_date_sends (
  rule_id uuid not null references public.automation_rules(id) on delete cascade,
  source_id uuid not null,
  on_date date not null,
  account_id uuid not null references public.accounts(id) on delete cascade,
  sent_at timestamptz not null default now(),
  primary key (rule_id, source_id, on_date)
);
create index automation_date_sends_account_idx on public.automation_date_sends (account_id);

alter table public.automation_date_sends enable row level security;
select public.require_two_factor_on('public.automation_date_sends');
select public.grant_data_api('public.automation_date_sends');
